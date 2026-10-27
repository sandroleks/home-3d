import {
  AgXToneMapping, BufferGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { doorSound, loadMuted, saveMuted, StepTimer } from './audio';
import { CONFIG } from './config';
import { Interactions, promptFor, type Target } from './interactions';
import { LIGHT_SPILL } from './lightmaps';
import { loadAssets, type LoadedAssets, type LoadedMap } from './loader';
import { addMirrors } from './mirrors';
import { assetsFor, type Kitchen, kitchenFrom, saveCarry, takeCarry, urlFor } from './layout';
import { lightmapTextures, UploadQueue, warmUpShaders } from './warmup';
import { applyMovable } from './movables';
import { Avatars, figureLight } from './avatars';
import { Multiplayer, trysteroRoom } from './multiplayer';
import { fetchIceServers } from './turn';
import { loadVoice, openMic, saveVoice, Voices, wallCounter } from './voice';
import { applyState, cleanName, collectState, lightValue, loadName, saveName, type StateMap, stateDelta, stateKey } from './presence';
import { activeScene, groupsIn, HUE_SCENES, levelFor, nextScene, NO_HUE_LINK, sceneById } from './hue';
import { Player, screenFov, vfovFromHfov } from './player';
import { shrinkLightmap } from './shrink';
import { Sound } from './sound';
import { Halos } from './halos';
import { Nanoleaf } from './nanoleaf';
import { Daylight, loadRealLighting, saveRealLighting } from './daylight';
import { Surroundings } from './surroundings';
import { solarPosition, sunTimes } from './sun';
import { dayOfYear, daysInYear, formatClock, formatReadout, parseSunParam, SunClock, sunKeyAction } from './sun-clock';
import { TouchControls } from './touch';
import { COPY, isTouchOnly, type SceneScope, UI } from './ui';
import { applyDoorPose, applyGlows, applyPacks, buildWorld } from './world';
import './style.css';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

const params = new URLSearchParams(location.search);
const ui = new UI(document);
/** No mouse: touch controls instead of pointer lock, and a lighter load for the GPU. */
const touch = isTouchOnly((q) => window.matchMedia(q));
const kitchen = kitchenFrom(params);
/** Coming from the other kitchen: where the visitor was, the time, and the doors and lights. */
const carry = takeCarry(() => sessionStorage);

function fail(message: string, err: unknown, retry = () => location.reload()): void {
  console.error(err);
  ui.showError(message, retry);
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
  ui.setKitchenWall(kitchen === 'wall');
  let assets: LoadedAssets;
  try {
    assets = await loadAssets((f) => ui.setProgress(f), shrink, assetsFor(kitchen));
  } catch (err) {
    if (kitchen !== 'wall') throw err;
    return fail(COPY.noKitchenWall, err, () => location.assign(urlFor(location.href, 'open')));
  }

  const world = buildWorld(assets, scene);
  const mirrors = addMirrors(world.root, surroundings);
  const nanoleaf = new Nanoleaf(world.glows);
  const halos = new Halos(world.glows.filter((g) => !nanoleaf.has(g)));
  world.root.add(halos.root);
  const avatars = new Avatars(); // the other visitors; in the scene now so the warm-up compiles them
  scene.add(avatars.root);
  const ear = new Vector3();
  const wallsBetween = wallCounter(world.occluders); // walls and closed doors between a voice and the listener
  // How lit a visitor's figure is: its room's ceiling light and lamps, or the daylight
  const roomGroups = new Map<string, { id: string; weight: number }[]>();
  for (const g of assets.manifest.groups) {
    roomGroups.set(g.room, [...(roomGroups.get(g.room) ?? []), { id: g.id, weight: g.kind === 'switch' ? 1 : CONFIG.multiplayer.creature.lamp }]);
  }
  const avatarLight = (x: number, z: number): number => {
    const room = world.rooms.locate(x, z, null);
    const lamps = (room && roomGroups.get(room)) || [];
    return figureLight(lamps.reduce((a, g) => Math.max(a, g.weight * world.lights.uniform(g.id).value), 0), world.sky.value);
  };
  const site = assets.manifest.site;
  const clock = new SunClock(carry?.utc ?? parseSunParam(params.get('sun'), site.timeZone) ?? Date.now(), site.timeZone);
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
  if (params.has('debug')) Object.assign(window, { walkthrough: { renderer, scene, camera, player, world, daylight, clock, surroundings, halos, avatars, CONFIG, LIGHT_SPILL, get voices() { return voices; }, get others() { return others; } } }); // tuning from the console

  const view = params.get('view');
  const vp = view ? assets.manifest.viewpoints.find((v) => v.name === view) : undefined;
  if (vp) {
    player.teleport(vp.position[0], vp.position[2], vp.yaw, vp.pitch, vp.position[1]);
    player.frozen = true;
    fixedHfov = vp.hfov;
    resize();
  } else if (carry) {
    player.teleport(carry.x, carry.z, carry.yaw, carry.pitch);
    player.resolve(); // where the wall now stands, step out of it
  }
  player.update(0); // place the camera now so the view behind the start overlay shows the spawn
  const spawnRoom = world.rooms.locate(player.x, player.z, null);
  if (carry) applyState(world, carry.state, performance.now() / 1000);
  else if (spawnRoom && world.lights.has(spawnRoom) && real && daylight.isNight(clock.utc)) world.lights.toggle(spawnRoom);
  if (params.get('debug') === 'lightmap') {
    for (const m of world.lightmapped as MeshStandardMaterial[]) {
      m.color.setRGB(1, 1, 1);
      m.map = null;
      m.needsUpdate = true;
    }
  }

  const interactions = new Interactions(camera, world.pickables, world.targets, world.lights);
  const turntable = world.movables.find((m) => m.state.info.kind === 'spin')?.state;
  /** Sounds for what a click or tap just used; doors and drawers sound from the frame loop as they move. */
  const used = (t: Target | null) => {
    if (!t) return;
    if (t.kind === 'switch' || t.kind === 'lamp' || t.kind === 'screen') sound?.click(t.node);
    if (t.kind === 'movable' && t.movable === turntable) {
      sound?.click(t.node);
      sound?.setMusic(turntable.isOpen);
    }
  };
  /** The others here, once joined: their avatars, and the doors, lights and screens shared with them. */
  let others: Multiplayer | null = null;
  /** The others' voices and the local mic, once started (not with ?solo). */
  let voices: Voices | null = null;
  const showPeople = () => ui.setPeople((others?.people ?? []).map((p) => ({ name: p.name, talking: voices?.talking(p.id) ?? false })));
  const byKey = new Map([...world.targets.values()].map((t) => [stateKey(t), t] as const));
  const share = (t: Target | null) => {
    if (t) others?.broadcast(stateDelta(t, world.lights));
  };
  ui.setName(loadName(() => localStorage));
  ui.setVoice(loadVoice(() => localStorage));
  // TURN credentials, asked for while the visitor reads the start screen so joining doesn't wait on them
  const joins = !params.has('autostart') && !params.has('solo');
  const iceServers = joins ? fetchIceServers(fetch, CONFIG.multiplayer.turn.url, CONFIG.multiplayer.turn.timeout) : Promise.resolve([]);
  let alone = false; // joining failed: the mic is released, and stays so if it arrives later
  const joinOthers = async () => {
    const typed = ui.getName().trim();
    saveName(() => localStorage, typed);
    try {
      const [{ joinRoom, selfId }, turnConfig] = await Promise.all([import('trystero'), iceServers]);
      const room = joinRoom(
        { appId: CONFIG.multiplayer.appId, ...(turnConfig.length ? { turnConfig } : {}) },
        params.get('room') || CONFIG.multiplayer.room,
        { onJoinError: ({ peerId, error }) => console.warn(`Could not connect to visitor ${peerId}: ${error}`) },
      );
      others = new Multiplayer(trysteroRoom(room, selfId), world, avatars, cleanName(typed), {
        now: () => performance.now() / 1000,
        onChanged: (keys) => keys.forEach((k) => used(byKey.get(k) ?? null)), // the sounds a local click would make
        onPeers: () => showPeople(),
      });
      if (voices) others.setVoice(voices);
      window.addEventListener('pagehide', () => others?.leave(), { once: true });
    } catch (err) {
      console.warn('Could not reach the other visitors; exploring alone.', err);
      alone = true;
      voices?.mic?.getTracks().forEach((t) => t.stop());
      voices?.setMic(null);
      ui.setMic(voices?.micState ?? 'none');
    }
  };
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
    sound.setMusic(turntable?.isOpen ?? false);
    ui.setMuted(muted);
    void sound.load();
    if (!params.has('solo')) {
      const v = (voices = new Voices(sound.context, sound.voiceOutput(CONFIG.multiplayer.voice.level)));
      const talk = ui.getVoice();
      saveVoice(() => localStorage, talk);
      ui.setMic('none');
      // Asked inside the click, the gesture browsers want for the mic; joining doesn't wait for the answer
      void (talk ? openMic(navigator.mediaDevices) : Promise.resolve(null)).then((mic) => {
        if (alone) mic?.getTracks().forEach((t) => t.stop());
        v.setMic(alone ? null : mic);
        others?.shareMic();
        ui.setMic(v.micState);
      });
      void joinOthers();
    }
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
  /** The other kitchen is another export: reload into it, keeping the visitor's place, the time and the lights. */
  const setKitchen = (k: Kitchen) => {
    if (k === kitchen) return;
    saveCarry(() => sessionStorage, {
      x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, utc: clock.utc, state: collectState(world),
    });
    location.assign(urlFor(location.href, k)); // pagehide says goodbye to the others
  };
  ui.onKitchenWall((wall) => setKitchen(wall ? 'wall' : 'open'));
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
    voices?.setPaused(on);
    if (on) {
      for (const k of Object.keys(player.keys) as (keyof typeof player.keys)[]) player.keys[k] = false;
      controls?.reset();
    }
  };
  const toggleRoomLight = () => {
    if (!currentRoom || !world.lights.has(currentRoom)) return;
    world.lights.toggle(currentRoom);
    sound?.click(world.switches.get(currentRoom));
    others?.broadcast({ [`light:${currentRoom}`]: lightValue(world.lights, currentRoom) });
  };
  /** Hue scenes: every light in the room (or the flat) to the scene's brightness and colour temperature. */
  const biasLights = new Set(world.screens.flatMap((s) => (s.info.group ? [s.info.group] : [])));
  const litRooms = [...new Set(assets.manifest.groups.map((g) => g.room))];
  const hue = NO_HUE_LINK; // the real bridge, once linked (CONFIG.hue)
  const sceneGroups = (room: string | null) => (room ? groupsIn(assets.manifest.groups, room, biasLights) : []);
  const applyScene = (id: string, scope: SceneScope) => {
    const scene = sceneById(id);
    const rooms = scope === 'home' ? litRooms : currentRoom ? [currentRoom] : [];
    if (!scene || rooms.length === 0) return;
    const delta: StateMap = {};
    for (const g of rooms.flatMap(sceneGroups)) {
      world.lights.setScene(g, levelFor(scene.bri), scene.ct);
      delta[`light:${g}`] = lightValue(world.lights, g);
      if (scene.ct > 0) delta[`ct:${g}`] = scene.ct;
    }
    if (currentRoom) sound?.click(world.switches.get(currentRoom));
    others?.broadcast(delta);
    hue.applyScene(rooms, scene);
  };
  ui.bindScenes(HUE_SCENES, applyScene);
  const toggleMute = () => {
    if (!sound) return;
    muted = !muted;
    saveMuted(() => localStorage, muted);
    sound.setMuted(muted);
    ui.setMuted(muted);
  };
  const toggleMic = () => {
    if (!voices?.mic) return;
    voices.setMicOn(voices.micState !== 'on');
    ui.setMic(voices.micState);
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
      used(t);
      share(t);
    },
  }) : null;
  ui.bindTouchBar({
    light: toggleRoomLight,
    mute: toggleMute,
    mic: toggleMic,
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
    used(t);
    share(t);
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
    if (e.code === 'KeyK' && !e.metaKey && !e.ctrlKey && !e.altKey) setKitchen(kitchen === 'wall' ? 'open' : 'wall');
    if (e.code === 'KeyL') toggleRoomLight();
    if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey && !e.altKey) applyScene(nextScene(activeScene(world.lights, sceneGroups(currentRoom))).id, 'room');
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleMic();
  });

  const screenCentre = new Vector3();
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let doorsMoved = false;
    world.doors.forEach((d, i) => {
      d.state.update(dt);
      applyDoorPose(d);
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
      if (s && m.state !== turntable) sound?.movable(m.node, s, m.state.info.kind === 'slide');
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
    if (others) {
      others.sendPose(player.x, player.z, player.yaw, player.pitch);
      others.tick();
    }
    avatars.update(dt, avatarLight);
    if (voices) {
      voices.update(dt, camera.getWorldPosition(ear), (id, out) => avatars.mouth(id, out), wallsBetween);
      for (const id of voices.ids) avatars.setTalk(id, voices.talk(id));
    }
    if (others) showPeople();
    currentRoom = world.rooms.locate(player.x, player.z, currentRoom);
    sound?.setRoom(currentRoom);
    ui.setRoom(currentRoom ? names.get(currentRoom) ?? '' : '');
    const target = started ? interactions.update() : null;
    ui.setPrompt(target ? promptFor(target, world.lights, touch ? 'Tap' : 'Click') : null);
    ui.setRoomLight(currentRoom && world.lights.has(currentRoom) ? world.lights.isOn(currentRoom) : null);
    ui.setScenes(currentRoom ? names.get(currentRoom) ?? null : null, activeScene(world.lights, sceneGroups(currentRoom)));
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
    nanoleaf.update(now / 1000, world.lights); // after the glows, before the halos and packs take its colours
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
