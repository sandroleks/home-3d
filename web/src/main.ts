import {
  AgXToneMapping, BufferGeometry, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { doorSound, loadMuted, saveMuted, StepTimer } from './audio';
import { CONFIG } from './config';
import { Interactions, promptFor } from './interactions';
import { loadAssets, type LoadedAssets } from './loader';
import { Player, vfovFromHfov } from './player';
import { Sound } from './sound';
import { Daylight } from './daylight';
import { Surroundings } from './surroundings';
import { solarPosition, sunTimes } from './sun';
import { dayOfYear, daysInYear, formatClock, formatReadout, parseSunParam, SunClock, sunKeyAction } from './sun-clock';
import { COPY, isTouchOnly, UI } from './ui';
import { applyDoorRotation, applyGlows, buildWorld } from './world';
import './style.css';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

const params = new URLSearchParams(location.search);
const ui = new UI(document);

function fail(message: string, err: unknown): void {
  console.error(err);
  ui.showError(message, () => location.reload());
}

async function boot(): Promise<void> {
  if (isTouchOnly((q) => window.matchMedia(q))) return ui.showNotice(COPY.mobile);
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
  const surroundings = new Surroundings(new Color(CONFIG.skyColor));
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = CONFIG.envIntensity;

  const camera = new PerspectiveCamera(CONFIG.verticalFov, 1, 0.05, 60);
  let fixedHfov: number | null = null;
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    if (fixedHfov !== null) camera.fov = vfovFromHfov(fixedHfov, camera.aspect);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const assets: LoadedAssets = await loadAssets((f) => ui.setProgress(f));

  const world = buildWorld(assets, scene);
  const site = assets.manifest.site;
  const clock = new SunClock(parseSunParam(params.get('sun'), site.timeZone) ?? Date.now(), site.timeZone);
  const daylight = new Daylight(renderer, scene, world, assets.manifest, assets.climate, surroundings);
  assets.surroundings.then((root) => {
    if (!root) return;
    surroundings.add(root);
    daylight.addCasters(root);
  });
  const names = new Map(assets.manifest.rooms.map((r) => [r.id, CONFIG.roomNames[r.id] ?? r.name]));
  const player = new Player(camera, world.collision, assets.manifest.spawn, assets.manifest.eyeHeight);
  player.resolve();
  player.attach(window, () => document.pointerLockElement);

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
  if (spawnRoom && world.lights.has(spawnRoom) && daylight.isNight(clock.utc)) world.lights.toggle(spawnRoom);
  if (params.get('debug') === 'lightmap') {
    for (const m of world.lightmapped as MeshStandardMaterial[]) {
      m.color.setRGB(1, 1, 1);
      m.map = null;
      m.needsUpdate = true;
    }
  }

  const interactions = new Interactions(camera, world.pickables, world.targets, world.lights);
  const autostart = params.has('autostart');
  let started = false;
  let currentRoom: string | null = null;
  let sound: Sound | null = null;
  let muted = loadMuted(() => localStorage);
  const steps = new StepTimer();
  const doorsBefore = world.doors.map((d) => ({ target: d.state.target, progress: d.state.progress }));

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
    canvas.requestPointerLock();
  };
  ui.setReady();
  ui.onStart(start);
  ui.bindSunPanel({
    dayOfYear: (n) => clock.setDayOfYear(n),
    season: (month, day) => clock.setDate(clock.local().year, month, day),
    minutes: (m) => clock.setMinutes(m),
    now: () => clock.now(),
    play: () => clock.togglePlay(),
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
      sunrise: t.sunrise, sunset: t.sunset, playing: clock.playing,
      readout: formatReadout(l, solarPosition(clock.utc, site.lat, site.lon), assets.climate.months[l.month - 1]),
    });
  };
  ui.onResume(() => {
    sound?.setPaused(false); // resume inside the click: Safari only allows it in a gesture
    canvas.requestPointerLock();
  });
  if (autostart) start();
  let paused = false;
  document.addEventListener('pointerlockchange', () => {
    paused = started && !autostart && document.pointerLockElement !== canvas;
    ui.setPaused(paused);
    sound?.setPaused(paused);
    if (paused) {
      for (const k of Object.keys(player.keys) as (keyof typeof player.keys)[]) player.keys[k] = false;
    }
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(autostart || document.pointerLockElement === canvas)) return;
    const t = interactions.click();
    if (t?.kind === 'switch') sound?.click(t.node); // doors sound from the frame loop as they move
  });
  window.addEventListener('keydown', (e) => {
    if (!started || paused) return;
    const sunKey = sunKeyAction(e.code, e.shiftKey);
    if (sunKey) {
      if (sunKey !== 'play' || !e.repeat) clock.apply(sunKey); // holding , or . keeps scrolling
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyL' && currentRoom && world.lights.has(currentRoom)) {
      world.lights.toggle(currentRoom);
      sound?.click(world.switches.get(currentRoom));
    }
    if (e.code === 'KeyM' && sound) {
      muted = !muted;
      saveMuted(() => localStorage, muted);
      sound.setMuted(muted);
      ui.setMuted(muted);
    }
  });

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
    if (started && !paused) {
      const x = player.x;
      const z = player.z;
      player.update(dt);
      if (sound && steps.update(Math.hypot(player.x - x, player.z - z), player.keys.run)) sound.step();
    }
    if (!player.frozen && world.collision.isBlocked(player.x, player.z)) player.resolve();
    currentRoom = world.rooms.locate(player.x, player.z, currentRoom);
    sound?.setRoom(currentRoom);
    ui.setRoom(currentRoom ? names.get(currentRoom) ?? '' : '');
    const target = started ? interactions.update() : null;
    ui.setPrompt(target ? promptFor(target, world.lights) : null);
    clock.tick(dt);
    daylight.update(clock.utc, clock.version, doorsMoved);
    if (clock.version !== shownVersion) {
      shownVersion = clock.version;
      showSun();
    }
    world.lights.update(dt);
    applyGlows(world.glows, world.lights);
    renderer.clear();
    surroundings.render(renderer, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  });
}

boot().catch((err) => fail(COPY.loadError, err));
