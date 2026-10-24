import {
  AgXToneMapping, BufferGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { doorSound, loadMuted, saveMuted, StepTimer } from './audio';
import { CONFIG } from './config';
import { Interactions, promptFor } from './interactions';
import { LIGHT_SPILL } from './lightmaps';
import { loadAssets, type LoadedAssets, type LoadedMap } from './loader';
import { addMirrors } from './mirrors';
import { lightmapTextures, UploadQueue, warmUpShaders } from './warmup';
import { applyMovable } from './movables';
import { Player, screenFov, vfovFromHfov } from './player';
import { shrinkLightmap } from './shrink';
import { Sound } from './sound';
import { Halos } from './halos';
import { Daylight, loadRealLighting, saveRealLighting } from './daylight';
import { Surroundings } from './surroundings';
import { solarPosition, sunTimes } from './sun';
import { dayOfYear, daysInYear, formatClock, formatReadout, parseSunParam, SunClock, sunKeyAction } from './sun-clock';
import { TouchControls } from './touch';
import { COPY, isTouchOnly, UI } from './ui';
import { applyDoorRotation, applyGlows, applyPacks, buildWorld } from './world';
import './style.css';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

const params = new URLSearchParams(location.search);
const ui = new UI(document);
/** No mouse: touch controls instead of pointer lock, and a lighter load for the GPU. */
const touch = isTouchOnly((q) => window.matchMedia(q));

function fail(message: string, err: unknown): void {
  console.error(err);
  ui.showError(message, () => location.reload());
}

async function boot(): Promise<void> {
  if (touch) ui.setTouch();
  if (!WebGL.isWebGL2Available()) return ui.showNotice(COPY.noWebGL);
  try {
    await run();
  } catch (err) {
    fail(COPY.loadError, err); // anything that throws while setting up must not leave "Loading…" up forever
  }
}

async function run(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = CONFIG.exposure;
  renderer.autoClear = false; // two passes per frame: surroundings, then the apartment
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    fail(COPY.contextLost, new Error('WebGL context lost'));
  });

  const scene = new Scene();
  const surroundings = new Surroundings();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = CONFIG.envIntensity;

  const camera = new PerspectiveCamera(CONFIG.verticalFov, 1, 0.05, 60);
  let fixedHfov: number | null = null;
  const resize = () => {
    // The canvas's own size: on phones the window's lags behind rotation and the browser bars
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fixedHfov !== null ? vfovFromHfov(fixedHfov, camera.aspect) : screenFov(camera.aspect);
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const shrink = touch ? (m: LoadedMap) => shrinkLightmap(renderer, m, CONFIG.touch.maxLightmapSize) : undefined;
  const assets: LoadedAssets = await loadAssets((f) => ui.setProgress(f), shrink);

  const world = buildWorld(assets, scene);
  const mirrors = addMirrors(world.root, surroundings);
  const halos = new Halos(world.glows);
  world.root.add(halos.root);
  const site = assets.manifest.site;
  const clock = new SunClock(parseSunParam(params.get('sun'), site.timeZone) ?? Date.now(), site.timeZone);
  const daylight = new Daylight(renderer, scene, world, assets.manifest, assets.climate, surroundings, touch ? CONFIG.touch.shadowMapSize : undefined);
  let real = loadRealLighting(() => localStorage);
  daylight.setReal(real);
  const mirrorTarget = mirrors.userData.target as WebGLRenderTarget | undefined;
  assets.surroundings.then((root) => {
    if (!root) return;
    surroundings.add(root);
    daylight.addCasters(root);
    warmUpShaders(renderer, surroundings.scene, camera, [], mirrorTarget ? [mirrorTarget] : []).catch(() => {});
  });
  // Nothing should stall mid-walk: every shader compiles now, in the background, and the lightmaps go up to the GPU a
  // few per frame instead of when a room first comes into view.
  const uploads = new UploadQueue(renderer);
  uploads.add(lightmapTextures(world.lightmapped));
  assets.light.then(() => uploads.add(lightmapTextures(world.lightmapped))).catch(() => {});
  if (mirrorTarget) { // sized now, not on the first frame a mirror is in view
    const size = renderer.getDrawingBufferSize(new Vector2()).multiplyScalar(CONFIG.mirrorScale).round();
    mirrorTarget.setSize(size.x, size.y);
  }
  warmUpShaders(renderer, scene, camera, world.screens.map((s) => s.pictureMaterial), mirrorTarget ? [mirrorTarget] : [])
    .catch((err) => console.warn('Shader warm-up failed; shaders compile when first needed.', err));
  const names = new Map(assets.manifest.rooms.map((r) => [r.id, CONFIG.roomNames[r.id] ?? r.name]));
  const player = new Player(camera, world.collision, assets.manifest.spawn, assets.manifest.eyeHeight);
  player.resolve();
  player.attach(window, () => document.pointerLockElement);
  if (params.has('debug')) Object.assign(window, { walkthrough: { renderer, scene, camera, player, world, daylight, clock, surroundings, halos, CONFIG, LIGHT_SPILL } }); // tuning from the console

  const view = params.get('view');
  const vp = view ? assets.manifest.viewpoints.find((v) => v.name === view) : undefined;
  if (vp) {
    player.teleport(vp.position[0], vp.position[2], vp.yaw, vp.pitch, vp.position[1]);
    player.frozen = true;
    fixedHfov = vp.hfov;
    resize();
  }
  player.update(0); // place the camera now so the view behind the start overlay shows the spawn
  const spawnRoom = world.rooms.locate(player.x, player.z, null);
  if (spawnRoom && world.lights.has(spawnRoom) && real && daylight.isNight(clock.utc)) world.lights.toggle(spawnRoom);
  if (params.get('debug') === 'lightmap') {
    for (const m of world.lightmapped as MeshStandardMaterial[]) {
      m.color.setRGB(1, 1, 1);
      m.map = null;
      m.needsUpdate = true;
    }
  }

  const interactions = new Interactions(camera, world.pickables, world.targets, world.lights);
  const clicks = (kind: string) => kind === 'switch' || kind === 'lamp' || kind === 'screen';
  const autostart = params.has('autostart');
  let started = false;
  let currentRoom: string | null = null;
  let sound: Sound | null = null;
  let muted = loadMuted(() => localStorage);
  const steps = new StepTimer();
  const doorsBefore = world.doors.map((d) => ({ target: d.state.target, progress: d.state.progress }));
  const movablesBefore = world.movables.map((m) => ({ target: m.state.target, progress: m.state.progress }));

  const start = () => {
    if (started) return;
    ui.hideStart();
    ui.showHud();
    started = true;
    if (autostart) return; // ?autostart and ?view= reference renders stay silent
    sound = new Sound(camera);
    sound.setMuted(muted);
    sound.setRoom(currentRoom);
    ui.setMuted(muted);
    void sound.load();
    if (touch) fullscreen();
    else canvas.requestPointerLock();
  };
  ui.setReady();
  ui.onStart(start);
  ui.bindSunPanel({
    dayOfYear: (n) => clock.setDayOfYear(n),
    season: (month, day) => clock.setDate(clock.local().year, month, day),
    minutes: (m) => clock.setMinutes(m),
    now: () => clock.now(),
    play: () => clock.togglePlay(),
    real: (on) => setReal(on),
  });
  let shownVersion = -1;
  const times = new Map<string, ReturnType<typeof sunTimes>>();
  const showSun = () => {
    const l = clock.local();
    const key = `${l.year}-${l.month}-${l.day}`;
    let t = times.get(key);
    if (!t) {
      t = sunTimes(l, site.lat, site.lon, site.timeZone);
      times.set(key, t);
    }
    ui.setClock(formatClock(l));
    ui.setSunPanel({
      dayOfYear: dayOfYear(l), daysInYear: daysInYear(l.year), minutes: l.hour * 60 + l.minute,
      sunrise: t.sunrise, sunset: t.sunset, playing: clock.playing, real,
      readout: real ? formatReadout(l, solarPosition(clock.utc, site.lat, site.lon), assets.climate.months[l.month - 1]) : COPY.flatLighting,
    });
  };
  const setReal = (on: boolean) => {
    real = on;
    saveRealLighting(() => localStorage, on);
    daylight.setReal(on);
    showSun();
  };
  ui.onResume(() => {
    sound?.setPaused(false); // resume inside the click: Safari only allows it in a gesture
    if (touch) {
      setPausedState(false); // no pointer lock to wait for
      fullscreen();
    } else canvas.requestPointerLock();
  });
  if (autostart) start();
  let paused = false;
  let cursor = false; // Tab frees the mouse for the sun panel and keeps walking; Esc pauses
  let freeing = false; // the next unlock is Tab's, not Esc's
  const setPausedState = (on: boolean) => {
    paused = on;
    ui.setPaused(on);
    sound?.setPaused(on);
    if (on) {
      for (const k of Object.keys(player.keys) as (keyof typeof player.keys)[]) player.keys[k] = false;
      controls?.reset();
    }
  };
  const toggleRoomLight = () => {
    if (!currentRoom || !world.lights.has(currentRoom)) return;
    world.lights.toggle(currentRoom);
    sound?.click(world.switches.get(currentRoom));
  };
  const toggleMute = () => {
    if (!sound) return;
    muted = !muted;
    saveMuted(() => localStorage, muted);
    sound.setMuted(muted);
    ui.setMuted(muted);
  };
  const controls = touch ? new TouchControls(canvas, document.getElementById('stick')!, document.getElementById('stick-knob')!, {
    stick: (s) => { player.stick = s; },
    look: (dx, dy) => {
      if (started && !paused && !player.frozen) player.look(dx, dy, CONFIG.touch.lookSensitivity);
    },
    tap: (x, y) => {
      if (!started || paused) return;
      const r = canvas.getBoundingClientRect();
      const t = interactions.tap(new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2));
      if (t && clicks(t.kind)) sound?.click(t.node); // doors and drawers sound from the frame loop as they move
    },
  }) : null;
  ui.bindTouchBar({
    light: toggleRoomLight,
    mute: toggleMute,
    pause: () => {
      if (started && !autostart) setPausedState(true);
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (touch && document.hidden && started && !autostart) setPausedState(true); // with a mouse, losing the pointer lock pauses
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    cursor = started && !autostart && !locked && freeing;
    freeing = false;
    ui.setWalking(locked);
    ui.setCursor(cursor);
    setPausedState(started && !autostart && !locked && !cursor);
  });
  window.addEventListener('mousedown', (e) => {
    if (touch) return; // taps are handled by the touch controls
    if (cursor && e.button === 0 && e.target === canvas) return void canvas.requestPointerLock(); // a click on the view looks around again
    if (e.button !== 0 || !(autostart || document.pointerLockElement === canvas)) return;
    const t = interactions.click();
    if (t && clicks(t.kind)) sound?.click(t.node); // doors and drawers sound from the frame loop as they move
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      e.preventDefault(); // Tab toggles the free mouse, never focus cycling
      if (touch || !started || paused || autostart || e.repeat) return;
      if (cursor) canvas.requestPointerLock();
      else {
        freeing = true;
        document.exitPointerLock();
      }
      return;
    }
    if (touch && e.code === 'Escape' && started && !autostart) return setPausedState(true); // a tablet's keyboard
    if (cursor && e.code === 'Escape') {
      cursor = false;
      ui.setCursor(false);
      setPausedState(true);
      return;
    }
    if (!started || paused) return;
    const sunKey = sunKeyAction(e.code, e.shiftKey, e.metaKey || e.ctrlKey || e.altKey);
    if (sunKey) {
      if (sunKey !== 'play' || !e.repeat) clock.apply(sunKey); // holding , or . keeps scrolling
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) setReal(!real);
    if (e.code === 'KeyL') toggleRoomLight();
    if (e.code === 'KeyM') toggleMute();
  });

  const screenCentre = new Vector3();
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let doorsMoved = false;
    world.doors.forEach((d, i) => {
      d.state.update(dt);
      applyDoorRotation(d);
      const before = doorsBefore[i];
      const s = doorSound(before, d.state);
      if (s) sound?.door(d.node, s);
      if (d.state.progress !== before.progress) doorsMoved = true;
      before.target = d.state.target;
      before.progress = d.state.progress;
    });
    world.movables.forEach((m, i) => {
      m.state.update(dt);
      applyMovable(m);
      const before = movablesBefore[i];
      const s = doorSound(before, m.state);
      if (s) sound?.movable(m.node, s, m.state.info.kind === 'slide');
      before.target = m.state.target;
      before.progress = m.state.progress;
    });
    if (started && !paused) {
      const x = player.x;
      const z = player.z;
      player.update(dt);
      if (sound && steps.update(Math.hypot(player.x - x, player.z - z), player.running)) sound.step();
    }
    if (!player.frozen && world.collision.isBlocked(player.x, player.z)) player.resolve();
    currentRoom = world.rooms.locate(player.x, player.z, currentRoom);
    sound?.setRoom(currentRoom);
    ui.setRoom(currentRoom ? names.get(currentRoom) ?? '' : '');
    const target = started ? interactions.update() : null;
    ui.setPrompt(target ? promptFor(target, world.lights, touch ? 'Tap' : 'Click') : null);
    ui.setRoomLight(currentRoom && world.lights.has(currentRoom) ? world.lights.isOn(currentRoom) : null);
    clock.tick(dt);
    daylight.update(clock.utc, clock.version, doorsMoved);
    if (clock.version !== shownVersion) {
      shownVersion = clock.version;
      showSun();
    }
    const local = clock.local();
    for (const s of world.screens) {
      const near = camera.position.distanceTo(screenCentre.fromArray(s.info.center)) < CONFIG.screens.maxDistance;
      s.update(now / 1000, dt, local, near);
      if (s.info.group) world.lights.set(s.info.group, s.on); // the TV's bias light
    }
    world.lights.update(dt);
    applyGlows(world.glows, world.lights);
    halos.update(world.lights, camera);
    applyPacks(world);
    surroundings.sky.tick(now / 1000);
    uploads.tick();
    renderer.clear();
    surroundings.render(renderer, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  });
}

/** Android browsers go fullscreen from a tap, hiding their bars; iPhones can't, and nothing happens. */
function fullscreen(): void {
  document.documentElement.requestFullscreen?.()?.catch(() => {});
}

boot().catch((err) => fail(COPY.loadError, err));
