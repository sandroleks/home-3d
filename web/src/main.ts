import {
  AgXToneMapping, BufferGeometry, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { CONFIG } from './config';
import { Interactions, promptFor } from './interactions';
import { loadAssets, type LoadedAssets } from './loader';
import { Player, vfovFromHfov } from './player';
import { Surroundings } from './surroundings';
import { COPY, isTouchOnly, UI } from './ui';
import { applyDoorRotation, buildWorld } from './world';
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
  assets.surroundings.then((root) => root && surroundings.add(root));
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

  const start = () => {
    ui.hideStart();
    ui.showHud();
    started = true;
    if (!autostart) canvas.requestPointerLock();
  };
  ui.setReady();
  ui.onStart(start);
  ui.onResume(() => canvas.requestPointerLock());
  if (autostart) start();
  let paused = false;
  document.addEventListener('pointerlockchange', () => {
    paused = started && !autostart && document.pointerLockElement !== canvas;
    ui.setPaused(paused);
    if (paused) {
      for (const k of Object.keys(player.keys) as (keyof typeof player.keys)[]) player.keys[k] = false;
    }
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && (autostart || document.pointerLockElement === canvas)) interactions.click();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !e.repeat && started && !paused && currentRoom && world.lights.has(currentRoom)) world.lights.toggle(currentRoom);
  });

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const d of world.doors) {
      d.state.update(dt);
      applyDoorRotation(d);
    }
    if (started && !paused) player.update(dt);
    if (!player.frozen && world.collision.isBlocked(player.x, player.z)) player.resolve();
    currentRoom = world.rooms.locate(player.x, player.z, currentRoom);
    ui.setRoom(currentRoom ? names.get(currentRoom) ?? '' : '');
    const target = started ? interactions.update() : null;
    ui.setPrompt(target ? promptFor(target, world.lights) : null);
    world.lights.update(dt);
    renderer.clear();
    surroundings.render(renderer, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  });
}

boot().catch((err) => fail(COPY.loadError, err));
