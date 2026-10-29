import {
  AgXToneMapping, Box3, BufferGeometry, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { doorSound, loadMuted, saveMuted, StepTimer } from './audio';
import { CONFIG } from './config';
import { makeMatcaps } from './creatures';
import { solidBox } from './contact-shadow';
import { Holding } from './holding';
import { Interactions, promptFor, type RangeStatus, type Target } from './interactions';
import { LIGHT_SPILL } from './lightmaps';
import { loadAssets, type LoadedAssets, type LoadedMap } from './loader';
import { addMirrors, type Mirror } from './mirrors';
import { assetsFor, type Kitchen, kitchenFrom, saveCarry, takeCarry, urlFor } from './layout';
import { lightmapTextures, UploadQueue, warmUpShaders } from './warmup';
import { applyMovable } from './movables';
import { Avatars, figureLight } from './avatars';
import { Multiplayer, trysteroRoom } from './multiplayer';
import { meshRaycast } from './prop-physics';
import { drawerHeights, placesFor } from './prop-places';
import { surfacePlaces } from './surface-props';
import { CARRIED_LAYER, type PropMessage, Props } from './props';
import { domCanvas } from './screens';
import { guestList } from './guests';
import { BackgammonBoard } from './backgammon-board';
import { BoardPanel, GAME_COPY, type PanelBoard } from './board-panel';
import { ChessBoard } from './chess-board';
import { endOf, gameChairs, type GameKind, Games, otherSide, seatedAt, type Side, slotOf, SLOTS } from './games';
import { GoBoard } from './go-board';
import { TableGames } from './table-pieces';
import { DrawGame, type DrawOut, type Visitor } from './draw-game';
import { HeldRifle, RifleRack } from './range-rack';
import { RangeGame, rangeHud, type RangeOut } from './range-game';
import { RangeView } from './range-view';
import { TvPanel, tvPanelView } from './draw-panel';
import { tvView } from './draw-tv';
import { Drunk, viewFilter, wobbleAt } from './drunk';
import { WineBottle } from './wine';
import { fetchIceServers } from './turn';
import { loadVoice, openMic, saveVoice, Voices, wallCounter } from './voice';
import { applyState, cleanName, collectState, colourFor, isShared, lightValue, loadArrived, loadName, saveName, type StateMap, stateDelta, stateKey } from './presence';
import { activeScene, colourAt, groupsIn, HUE_SCENES, levelFor, nextScene, NO_HUE_LINK, packColour, sceneById } from './hue';
import { Player, screenFov, vfovFromHfov } from './player';
import { freeSpot, seatAt, seatedOn, seatingCode } from './seats';
import { shrinkLightmap } from './shrink';
import { Sound } from './sound';
import { roomProbes, standInProbe } from './reflections';
import { RoomCulling } from './visibility';
import { Bench, type BenchStop, FrameStats } from './stats';
import { Halos } from './halos';
import { Nanoleaf } from './nanoleaf';
import { Daylight, loadRealLighting, saveRealLighting } from './daylight';
import { Surroundings } from './surroundings';
import { solarPosition, sunTimes } from './sun';
import { dayOfYear, daysInYear, formatClock, formatReadout, parseSunParam, SunClock, sunKeyAction } from './sun-clock';
import { TouchControls } from './touch';
import { COPY, isTouchOnly, type SceneScope, UI } from './ui';
import { applyDoorPose, applyGlows, applyPacks, buildWorld } from './world';
import { setAnisotropy } from './scene-setup';
import { applyDetails } from './details';
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
  const UP = new Vector3(0, 1, 0);
  const surroundings = new Surroundings();
  const roomEnvironment = new RoomEnvironment();
  scene.environment = new PMREMGenerator(renderer).fromScene(roomEnvironment, 0.04).texture;
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
    const ktx2 = new KTX2Loader().setTranscoderPath(CONFIG.basisPath).detectSupport(renderer);
    assets = await loadAssets((f) => ui.setProgress(f), shrink, assetsFor(kitchen), ktx2);
  } catch (err) {
    if (kitchen !== 'wall') throw err;
    return fail(COPY.noKitchenWall, err, () => location.assign(urlFor(location.href, 'open')));
  }

  // What lightmapped surfaces reflect: their room's probes, or the stand-in room environment at the local light level.
  const standIn = standInProbe(renderer, scene.environment, roomEnvironment);
  const probes = roomProbes(renderer, assets.manifest.probes, assets.probes);
  const world = buildWorld(assets, scene, domCanvas, (room) => (room && probes.get(room)) || standIn);
  // The model's loose things leave the scene now, before anything renders or collects casters; buildWorld already
  // counted their meshes as occluders, so those go too (anything no longer under the world's root).
  const surfaceProps = surfacePlaces(assets.manifest.props, world.root);
  world.occluders = world.occluders.filter((m) => {
    let o: Object3D | null = m;
    while (o && o !== world.root) o = o.parent;
    return o === world.root;
  });
  const anisotropy = Math.min(touch ? CONFIG.touch.anisotropy : CONFIG.anisotropy, renderer.capabilities.getMaxAnisotropy());
  applyDetails(world.root);
  setAnisotropy(world.root, anisotropy);
  const mirrors = addMirrors(world.root, surroundings);
  const nanoleaf = new Nanoleaf(world.glows);
  const halos = new Halos(world.glows.filter((g) => !nanoleaf.has(g)));
  world.root.add(halos.root);
  const avatars = new Avatars(); // the other visitors; in the scene now so the warm-up compiles them
  scene.add(avatars.root);
  const tables = new TableGames(); // the dining table's games, in the scene now so the warm-up compiles them too
  tables.root.visible = !params.has('autostart'); // ?autostart reference views match the Cycles renders, which have no games
  scene.add(tables.root);
  const [tableX, tableZ] = CONFIG.games.slots[1]; // the table's middle, for how lit the pieces are
  const wine = new WineBottle(); // the bottle of red in the kitchen; not in reference views, as the games aren't
  const drunk = new Drunk();
  if (!params.has('autostart')) {
    scene.add(wine.root);
    world.pickables.push(wine.root);
    world.targets.set(wine.root, wine.target);
  }
  // The shooting range's rack, targets and rifle (see `range`, below), built now so the warm-up compiles them too: the
  // rack reads the range's status only when asked, so it can come before the game.
  const rangeStatus: RangeStatus = {
    get armed() { return range.armed; },
    get busy() { return range.busy; },
    get canArm() { return canHold(); },
  };
  const rack = new RifleRack(rangeStatus);
  const rangeView = new RangeView();
  const rifle = new HeldRifle();
  if (!params.has('autostart')) {
    scene.add(rack.root, rangeView.root);
    world.pickables.push(rack.rack, rack.button);
    world.targets.set(rack.rack, rack.rackTarget);
    world.targets.set(rack.button, rack.buttonTarget);
  }
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

  // The loose things in the drawers and cupboards (props.ts): built now, so the warm-up compiles them and the crosshair
  // finds them; held and flying ones are drawn on their own layer, which the crosshair leaves out.
  // The table's games and the wine are made here, not in the model, and are in the way too: nothing is put down in them,
  // and flights hit the bottle and glass (the games' pieces come and go, so the sets are only boxes).
  const inTheWay = wine.root.parent ? [...tables.root.children, wine.root] : [];
  const wayBox = new Box3();
  const solidRay = meshRaycast(wine.root.parent ? [...world.solids, wine.root] : world.solids);
  const movableNodes = new Set(world.movables.filter((m) => m.state.info.kind === 'slide').map((m) => m.node)); // not doors or the platter
  const drawerOf = (o: Object3D): Object3D | null => {
    for (let p: Object3D | null = o; p; p = p.parent) if (movableNodes.has(p)) return p;
    return null;
  };
  const fronts = new Set(assets.manifest.movables.map((m) => m.node));
  const heights = drawerHeights(fronts);
  const handAt = new Vector3();
  const props = new Props([...placesFor(fronts), ...surfaceProps], {
    root: world.root,
    node: (name) => world.root.getObjectByName(name) ?? null,
    drawerOf,
    drawerHeight: (node) => heights.get(node.name) ?? null,
    raycast: solidRay,
    light: avatarLight,
    selfId: () => selfId(),
    hand: (id, p, q) => {
      if (id === selfId()) {
        holding.hand(p, q);
        return true;
      }
      const figure = avatars.get(id);
      if (!figure || !avatars.mouth(id, p)) return false;
      const yaw = figure.pose[2];
      const [ahead, below] = CONFIG.props.otherHand;
      p.add(handAt.set(-Math.sin(yaw) * ahead, -below, -Math.cos(yaw) * ahead));
      q.setFromAxisAngle(UP, yaw);
      return true;
    },
  }, makeMatcaps(domCanvas));
  for (const p of props.list) {
    world.targets.set(p.root, { kind: 'prop', prop: p, node: p.root });
    world.pickables.push(p.root);
  }
  const holding = new Holding(props, camera, {
    raycast: solidRay,
    overlaps: (box) => props.overlaps(box) || inTheWay.some((o) => solidBox(o, wayBox).intersectsBox(box)),
    drawerOf: (o) => {
      const node = drawerOf(o);
      return node ? { node, height: heights.get(node.name) ?? null } : null;
    },
  }, (m) => sendProp(m));
  scene.add(holding.ghost);
  camera.layers.enable(CARRIED_LAYER);
  // Things in shut drawers and cupboards aren't drawn (props.hideShut, each frame).
  const movableAt = new Map(world.movables.map((m) => [m.state.info.node, m.state]));
  const shut = (node: string) => movableAt.get(node)?.progress === 0;
  const sendProp = (m: PropMessage | null) => {
    if (m) others?.sendProp(m);
  };
  /** Picks up a loose thing under the crosshair or a tap; false when it wasn't one. */
  const pickUp = (t: Target | null): boolean => {
    if (t?.kind !== 'prop') return false;
    if (!holding.holding && !player.frozen) sendProp(props.pickUp(t.prop));
    return true;
  };
  const site = assets.manifest.site;
  const clock = new SunClock(carry?.utc ?? parseSunParam(params.get('sun'), site.timeZone) ?? Date.now(), site.timeZone);
  const daylight = new Daylight(renderer, scene, world, assets.manifest, assets.climate, surroundings, touch ? CONFIG.touch.shadowMapSize : undefined);
  let real = loadRealLighting(() => localStorage);
  daylight.setReal(real);
  const mirrorTarget = mirrors.userData.target as WebGLRenderTarget | undefined;
  assets.surroundings.then((root) => {
    if (!root) return;
    setAnisotropy(root, anisotropy);
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
  // Twice: with the sun up and down, as the daylight takes it out of the scene's lights at night.
  // (warmUpShaders shows what's hidden, so the sun leaves the scene for the night pass).
  const warmUps = [true, false].map((up) => {
    if (!up) scene.remove(daylight.light);
    const job = warmUpShaders(renderer, scene, camera, [...world.screens.map((s) => s.pictureMaterial), holding.ghostMaterial, ...rangeView.warmMaterials(), ...rifle.materials], mirrorTarget ? [mirrorTarget] : []);
    if (!up) scene.add(daylight.light);
    return job;
  });
  Promise.all(warmUps).catch((err) => console.warn('Shader warm-up failed; shaders compile when first needed.', err));
  const names = new Map(assets.manifest.rooms.map((r) => [r.id, CONFIG.roomNames[r.id] ?? r.name]));
  const player = new Player(camera, world.collision, assets.manifest.spawn, assets.manifest.eyeHeight);
  player.resolve();
  player.attach(window, () => document.pointerLockElement);
  if (params.has('debug')) Object.assign(window, { walkthrough: { renderer, scene, camera, player, world, daylight, clock, surroundings, halos, avatars, CONFIG, LIGHT_SPILL, get voices() { return voices; }, get others() { return others; }, get games() { return games; }, props, holding, get draw() { return draw; }, get range() { return range; }, drunk } }); // tuning from the console

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

  // Seats are part of the rooms' meshes: where the crosshair meets one, the free spot on it nearest the crosshair
  const seatNode = new Object3D();
  const seatTarget = (p: Vector3): Target | null => {
    const seat = seatAt(assets.seats, p.x, p.y, p.z);
    if (!seat) return null;
    const spot = freeSpot(seat, p.x, p.z, (x, z) => avatars.occupied(x, z));
    const s = player.seat;
    if (spot && s && spot.at[0] === s.x && spot.at[2] === s.z) return null; // the one you're on
    return { kind: 'seat', seat, spot, node: seatNode };
  };
  const interactions = new Interactions(camera, world.pickables, world.targets, world.lights, undefined, seatTarget);
  /** A click or tap on a free seat sits you down (or lies you down, on the bed). */
  const sitOn = (t: Target | null) => {
    if (t?.kind === 'seat' && t.spot && !player.frozen && !player.held) player.sit(seatedOn(t.spot, t.seat.pose));
  };
  /** C, or the touch bar's button: sit down on the floor where you are, or get up. */
  const toggleSit = () => {
    if (player.frozen || (tvPanel.isOpen && !atBoard)) return; // the TV panel holds you like a board does
    if (atBoard) return standFromBoard(); // at a game board: asks first while a game runs
    if (player.seat) player.stand();
    else player.sit({ posture: 'sit', x: player.x, y: 0, z: player.z, yaw: player.yaw }, false);
  };
  /** A click or tap on the wine is a sip: the bottle tips toward you, and you get a little drunker. One too many too
   * fast blacks you out: frozen until you come to, sitting on the floor (the frame loop). */
  let blackedOut = false;
  const drinkFrom = (t: Target | null) => {
    if (t?.kind !== 'wine' || player.frozen) return;
    wine.sip(player.x, player.z);
    if (!drunk.sip()) return;
    holding.drop(); // what they held falls as they do
    blackedOut = true;
    player.frozen = true;
  };
  const turntable = world.movables.find((m) => m.state.info.kind === 'spin')?.state;
  /** Sounds for what a click or tap just used; doors and drawers sound from the frame loop as they move. */
  const used = (t: Target | null) => {
    if (!t) return;
    if (t.kind === 'switch' || t.kind === 'lamp' || t.kind === 'screen' || t.kind === 'wine') sound?.click(t.node);
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
  /** Set on joining. `arrived`: when this visitor first came to the room, kept through a reload, so a host who reloads
   * stays host. `joinedAt`: when this page joined; it picks whom to ask for the flat's state, and breaks a tie against
   * this visitor's own old page. */
  let arrived = Date.now();
  let joinedAt = arrived;
  /** Each visitor's last room for the guest list: outside every room, `locate` keeps the last one, as with your own. */
  const guestRooms = new Map<string, string | null>();
  let guestsDue = 0;
  /** From the frame loop: the open guest list, a few times a second, and at once after it opens or the host changes. */
  const showGuests = (now: number) => {
    if (!ui.guestsOpen || now < guestsDue) return;
    guestsDue = now + 1000 / CONFIG.multiplayer.guestListRate;
    const self = { id: others?.selfId ?? 'self', name: cleanName(ui.getName()), arrived, since: joinedAt };
    ui.setGuests(guestList({
      self,
      people: others?.people ?? [],
      host: others?.host ?? self.id,
      roomOf: (id) => {
        const figure = id === self.id ? null : avatars.get(id);
        if (id !== self.id && !figure?.root.visible) return null; // not placed yet: it sits at the origin
        const pose = figure ? figure.pose : [player.x, player.z];
        const room = world.rooms.locate(pose[0], pose[1], guestRooms.get(id) ?? null);
        guestRooms.set(id, room);
        return room ? names.get(room) ?? null : null;
      },
      talking: (id) => voices?.talking(id) ?? false,
    }));
  };
  const toggleGuests = () => {
    if (ui.toggleGuests()) guestsDue = 0;
  };
  ui.onGuests(() => {
    if (started && !autostart) toggleGuests();
  });
  const byKey = new Map([...world.targets.values()].flatMap((t) => (isShared(t) ? [[stateKey(t), t] as const] : [])));
  const share = (t: Target | null) => {
    if (t) others?.broadcast(stateDelta(t, world.lights));
  };
  /** The dining table's games (games.ts): who sits in the game chairs, the games, and the panel a player gets. */
  const selfId = () => others?.selfId ?? 'self';
  const chairs = gameChairs(assets.seats);
  /** Ids for new games: not `crypto.randomUUID`, which phones on a LAN address don't have. */
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const games = new Games(selfId, newId);
  /** Each game's board in the panel; each plays its entries at its own slot. */
  const boards: Partial<Record<GameKind, PanelBoard>> = {
    chess: new ChessBoard(document, (entry) => playEntry(slotOf('chess'), entry)),
    backgammon: new BackgammonBoard(document, (entry) => playEntry(slotOf('backgammon'), entry)),
    go: new GoBoard(document, (entry) => playEntry(slotOf('go'), entry)),
  };
  /** Where this visitor plays while the panel is open: the slot and the side. */
  let atBoard: { slot: number; side: Side } | null = null;
  /** An entry by this visitor at a slot (the games check it is their move there), sent when taken. */
  const playEntry = (slot: number, entry: string) => {
    const m = games.play(slot, entry);
    if (m) others?.sendGame(m);
  };
  /** This visitor's running game at the board: its slot, side and id; null when none runs. */
  const myGame = () => {
    const g = atBoard && games.at(atBoard.slot);
    return atBoard && g && g[atBoard.side] === selfId() && !endOf(g) ? { ...atBoard, id: g.id } : null;
  };
  /** Resigns, if the game asked about still runs and it is still this player's move (a confirm can outlive the game,
   * and a rematch can open meanwhile). */
  const resignIfDue = ({ slot, side, id }: { slot: number; side: Side; id: string }) => {
    const g = games.at(slot);
    if (g && g.id === id && g[side] === selfId() && !endOf(g) && g.rules.turn() === side) playEntry(slot, 'resign');
  };
  /** Gets up from the board; the frame loop closes the panel, and the view looks around again. */
  const standUp = () => {
    player.stand();
    if (cursor && !touch) lockPointer();
  };
  /** The panel's Stand up, or C: while your game runs it asks first, and on your move standing resigns it. `then`
   * runs once standing (another kitchen's reload). */
  const standFromBoard = (then?: () => void) => {
    const mine = myGame();
    if (!mine) {
      standUp();
      return then?.();
    }
    boardPanel.confirm(GAME_COPY.standAndResign, GAME_COPY.standUp, () => {
      resignIfDue(mine);
      standUp();
      then?.();
    });
  };
  const boardPanel = new BoardPanel(document, {
    resign: () => {
      const mine = myGame();
      if (mine) boardPanel.confirm(GAME_COPY.resignGame, GAME_COPY.resign, () => resignIfDue(mine));
    },
    stand: () => standFromBoard(),
  });
  const nameOf = (id: string) =>
    id === selfId() ? cleanName(ui.getName()) : others?.people.find((p) => p.id === id)?.name ?? CONFIG.multiplayer.defaultName;
  /** Frees the mouse for the panel, as Tab does. */
  const freeMouse = () => {
    if (touch || autostart || document.pointerLockElement !== canvas) return;
    freeing = true;
    document.exitPointerLock();
  };
  /** From the frame loop (`now` in seconds): who sits at the table, the games, the boards on it, and the panel. */
  const updateGames = (dt: number, now: number) => {
    const sitters = avatars.seated();
    if (player.seat) sitters.push({ id: selfId(), x: player.seat.x, z: player.seat.z });
    for (const m of games.update(seatedAt(chairs, sitters), now)) others?.sendGame(m);
    tables.update(dt, (slot) => games.at(slot), avatarLight(tableX, tableZ));
    const seat = started && !autostart ? games.seatOf(selfId()) : null;
    const board = seat && boards[SLOTS[seat.slot].kind];
    if (!seat || !board) {
      if (boardPanel.isOpen) boardPanel.close();
      atBoard = null;
      player.held = tvPanel.isOpen;
      return;
    }
    if (!boardPanel.isOpen || atBoard?.slot !== seat.slot) {
      closeTv(false); // one panel at a time: the board's
      boardPanel.open(SLOTS[seat.slot].title, board);
      freeMouse();
    }
    atBoard = seat;
    player.held = true;
    const g = games.at(seat.slot);
    const mine = g && g[seat.side] === selfId() ? g : null;
    const theirs = games.seatsAt(seat.slot)[otherSide(seat.side)];
    boardPanel.render({
      you: seat.side,
      me: { name: nameOf(selfId()), colour: colourFor(selfId()) },
      them: theirs ? { name: nameOf(theirs), colour: colourFor(theirs) } : null,
      game: mine?.rules ?? null,
      end: mine ? endOf(mine) : null,
    }, games.version);
  };
  /** Draw and guess on the Sala TV (draw-game.ts): the game, the TV showing it, and the TV's panel. */
  const tv = world.screens.find((s) => s.isTv) ?? null;
  const draw = new DrawGame(selfId, newId);
  const sendDraw = (out: DrawOut[]) => {
    for (const o of out) others?.sendDraw(o.msg, o.to);
  };
  /** Everyone here, this visitor first, with when they arrived: the players' order and the game's leader come from it. */
  const visitors = (): Visitor[] => [{ id: selfId(), name: cleanName(ui.getName()), arrived, since: joinedAt }, ...(others?.people ?? [])];
  /** The remote's buttons do what a click on the TV did, shared the same way; not while a game shows. */
  const remote = (press: () => void) => {
    if (!tv || draw.state) return;
    press();
    const t: Target = { kind: 'screen', screen: tv, node: tv.node };
    used(t);
    share(t);
  };
  const tvPanel = new TvPanel(document, {
    power: () => remote(() => tv?.power(performance.now() / 1000)),
    next: () => remote(() => tv?.nextChannel()),
    join: () => sendDraw(draw.setJoined(!draw.joined)),
    start: () => sendDraw(draw.start(visitors(), performance.now())),
    close: () => closeTv(true),
    escape: () => closeTv(false), // Esc frees the mouse; the next Esc pauses
    choose: (word) => sendDraw(draw.choose(word, performance.now())),
    guess: (text) => sendDraw(draw.guess(text)),
    penDown: (colour, width, x, y) => draw.penDown(colour, width, x, y),
    penMove: (x, y) => draw.penMove(x, y),
    undo: () => sendDraw(draw.undo()),
    clear: () => sendDraw(draw.clear()),
  });
  /** A click or tap on the TV, or T: the mouse is freed for the panel, and the movement keys don't move you. */
  const openTv = () => {
    if (!started || autostart || atBoard || tvPanel.isOpen) return;
    tvPanel.open();
    freeMouse();
    player.held = true;
  };
  /** Close, Esc or T; `look`: the view looks around again (not after Esc, which only frees the mouse). */
  const closeTv = (look: boolean) => {
    if (!tvPanel.isOpen) return;
    tvPanel.close();
    player.held = atBoard !== null;
    if (look && cursor && !touch) lockPointer();
  };
  /** From the frame loop (`now` in ms): the game's step, the TV showing it, and the panel while it's open. */
  const updateDraw = (now: number) => {
    sendDraw(draw.update(now, visitors()));
    const s = draw.state;
    tv?.setGame(s ? tvView(s, draw.sketch.strokes, draw.timeLeft()) : null, now / 1000);
    if (!tvPanel.isOpen) return;
    const me = selfId();
    tvPanel.render(tvPanelView({
      me, tvOn: tv?.on ?? false, game: s, leftMs: draw.timeLeft(),
      joined: draw.playing(visitors()).map((v) => ({ name: v.name, colour: colourFor(v.id), you: v.id === me })),
      youJoined: draw.joined, secret: draw.secret, choices: draw.choices, close: draw.close,
    }), draw.sketch.strokes, draw.sketch.version);
  };
  /** The shooting range on the Varanda (range-*.ts): the rack and the button, the rifle in hand, the targets for
   * everyone in the flat, and the round shared with whoever else holds a rifle. Not in reference views, as the
   * games aren't. */
  const range = new RangeGame(selfId, newId, undefined, undefined, nameOf);
  const sendRange = (out: RangeOut[]) => {
    for (const o of out) others?.sendRange(o.msg, o.to);
  };
  /** Whether this visitor may hold the rifle now: on the balcony, standing, awake, hands empty. */
  // The loose-objects merge adds `&& !holding.holding` here.
  const canHold = () => currentRoom === CONFIG.range.room && !player.seat && !player.frozen && !holding.holding;
  /** Picks up the rifle or puts it back on the rack. */
  const arm = (on: boolean) => {
    if (on === range.armed) return;
    sendRange(range.setArmed(on, cleanName(ui.getName()), performance.now()));
    rifle.shown = on;
    ui.setArmed(on);
    sound?.click(rack.rack);
  };
  /** A click or tap on the rack picks up or puts back the rifle; on the button, starts a round. True when it was one
   * of them, so nothing else takes the click. */
  const useRange = (t: Target | null): boolean => {
    if (t?.kind === 'rack') {
      if (canHold()) arm(!range.armed);
      return true;
    }
    if (t?.kind !== 'range-button') return false;
    const out = range.start(performance.now());
    if (out.length) {
      sendRange(out);
      sound?.click(rack.button);
    }
    return true;
  };
  /** A shot along the crosshair (the drunk wobble included), once the bolt has cycled: it kicks, it sounds, and the
   * others hear it. */
  let nextShot = 0;
  const shotFrom = new Vector3();
  const shotDir = new Vector3();
  const fire = () => {
    const now = performance.now();
    if (!range.armed || player.frozen || paused || tvPanel.isOpen || boardPanel.isOpen || now < nextShot) return;
    nextShot = now + CONFIG.range.cycle * 1000;
    camera.getWorldPosition(shotFrom);
    camera.getWorldDirection(shotDir);
    sendRange(range.shoot([shotFrom.x, shotFrom.y, shotFrom.z], [shotDir.x, shotDir.y, shotDir.z], now));
    rifle.fire();
    sound?.shot(null);
  };
  ui.onFire(fire);
  const otherShot = new Vector3();
  /** From the frame loop (`now` in ms): off the balcony, sitting or blacked out the rifle goes back; the round's step,
   * the targets, the rack and the rifle in hand, and the strip. */
  const updateRange = (dt: number, now: number) => {
    if (range.armed && !canHold()) arm(false);
    range.update(now);
    const events = range.takeEvents();
    for (const e of events) if (e.kind === 'shot') sound?.shot(otherShot.fromArray(e.o));
    const outside = avatarLight(CONFIG.range.middle, CONFIG.range.rail - CONFIG.range.near); // the open air: daylight only
    rangeView.update(dt, range.round, range.roundTime(now), range.broken(), events, colourFor, outside);
    const on = interactions.current?.kind;
    rack.update(avatarLight(CONFIG.range.rack[0], CONFIG.range.rack[1]), on === 'rack' || on === 'range-button' ? on : null, range.busy);
    rifle.update(dt, camera, avatarLight(player.x, player.z));
    ui.setRange(started && !autostart ? rangeHud(range, now, selfId()) : null, colourFor);
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
      const roomName = params.get('room') || CONFIG.multiplayer.room;
      joinedAt = Date.now();
      arrived = loadArrived(() => sessionStorage, roomName, joinedAt);
      const room = joinRoom(
        { appId: CONFIG.multiplayer.appId, ...(turnConfig.length ? { turnConfig } : {}) },
        roomName,
        { onJoinError: ({ peerId, error }) => console.warn(`Could not connect to visitor ${peerId}: ${error}`) },
      );
      others = new Multiplayer(trysteroRoom(room, selfId), world, avatars, cleanName(typed), {
        now: () => performance.now() / 1000,
        onChanged: (keys) => keys.forEach((k) => used(byKey.get(k) ?? null)), // the sounds a local click would make
        onPeers: () => showPeople(),
        onHost: () => { guestsDue = 0; },
        onGame: (g) => { games.receive(g); },
        games: () => games.messages(),
        onProp: (m) => {
          const had = props.held;
          props.receive(m);
          if (had && !props.held) holding.lost();
        },
        props: () => props.messages(),
        onDraw: (m, from) => sendDraw(draw.receive(m, from, performance.now())),
        onRange: (m, from) => sendRange(range.receive(m, from, performance.now())),
        onArrive: (id) => {
          sendDraw(draw.greet(id));
          sendRange(range.greet(id, visitors(), performance.now()));
        },
        onLeave: (id) => {
          range.leave(id);
          const f = avatars.get(id);
          props.leave(id, f?.root.visible ? new Vector3(f.target[0], CONFIG.props.leaveHeight, f.target[1]) : null);
        },
      }, joinedAt, arrived);
      props.rename('self', selfId); // what was picked up before joining finished is this visitor's under its real id
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
  /** Chrome refuses the lock for a moment after a reload or an Esc, and returns a promise that rejects; Safari and
   * Firefox only fire pointerlockerror, which is handled below. */
  const lockPointer = () => {
    (canvas.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => {});
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
    else lockPointer();
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
    holding.drop(); // the other kitchen reloads the page: let go first
    saveCarry(() => sessionStorage, {
      x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, utc: clock.utc, state: collectState(world),
    });
    location.assign(urlFor(location.href, k)); // pagehide says goodbye to the others
  };
  /** K or the kitchen-wall box: in a running game it asks first, as standing up does; Keep playing keeps the kitchen. */
  const switchKitchen = (k: Kitchen) => {
    if (k === kitchen || !player.held || !myGame()) return setKitchen(k);
    ui.setKitchenWall(kitchen === 'wall'); // the box shows this kitchen until the answer
    standFromBoard(() => setKitchen(k));
  };
  ui.onKitchenWall((wall) => switchKitchen(wall ? 'wall' : 'open'));
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
    } else if (boardPanel.isOpen || tvPanel.isOpen) { // with a panel open the mouse stays free for it
      cursor = true;
      ui.setCursor(true);
      setPausedState(false);
    } else lockPointer();
  });
  if (autostart) start();
  let paused = false;
  let cursor = false; // Tab frees the mouse for the sun panel and keeps walking; Esc pauses
  let freeing = false; // the next unlock is Tab's, not Esc's
  const setPausedState = (on: boolean) => {
    paused = on;
    if (on) holding.cancelThrow();
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
  /** Hue scenes: every light in the room (or the flat) to the scene's brightness and colour temperature, or for a
   * colour scene to its colours, each light the next one in turn. */
  const biasLights = new Set(world.screens.flatMap((s) => (s.info.group ? [s.info.group] : [])));
  const litRooms = [...new Set(assets.manifest.groups.map((g) => g.room))];
  const hue = NO_HUE_LINK; // the real bridge, once linked (CONFIG.hue)
  const sceneGroups = (room: string | null) => (room ? groupsIn(assets.manifest.groups, room, biasLights) : []);
  const applyScene = (id: string, scope: SceneScope) => {
    const scene = sceneById(id);
    const rooms = scope === 'home' ? litRooms : currentRoom ? [currentRoom] : [];
    if (!scene || rooms.length === 0) return;
    const delta: StateMap = {};
    for (const room of rooms) {
      sceneGroups(room).forEach((g, i) => {
        world.lights.setScene(g, levelFor(scene.bri), scene.ct);
        delta[`light:${g}`] = lightValue(world.lights, g);
        if (scene.ct > 0) delta[`ct:${g}`] = scene.ct;
        const colour = colourAt(scene, i);
        if (colour) {
          world.lights.setColour(g, colour);
          delta[`hs:${g}`] = packColour(colour);
        }
      });
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
      if (!started || paused || tvPanel.isOpen) return;
      const r = canvas.getBoundingClientRect();
      const aim = new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
      if (range.armed) return void useRange(interactions.at(aim)); // with the rifle in hand, only the rack and the button take a tap (Fire fires)
      if (holding.holding && holding.placeAt(aim)) return;
      if (holding.holding && interactions.at(aim)?.kind === 'prop') return;
      const t = interactions.tap(aim);
      if (pickUp(t)) return;
      if (t?.kind === 'screen' && t.screen.isTv) return openTv();
      if (useRange(t)) return;
      sitOn(t);
      drinkFrom(t);
      used(t);
      share(t);
    },
  }) : null;
  ui.bindTouchBar({
    light: toggleRoomLight,
    mute: toggleMute,
    mic: toggleMic,
    sit: () => {
      if (started && !paused) toggleSit();
    },
    pause: () => {
      if (started && !autostart) setPausedState(true);
    },
  });
  ui.bindHoldBar({
    throwStart: () => holding.startThrow(),
    throwEnd: () => holding.releaseThrow(),
    drop: () => holding.drop(),
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
  document.addEventListener('pointerlockerror', () => {
    if (!started || autostart || touch) return;
    // No lock (refused, or a frame without it): not stuck on a start screen that is gone, the mouse is free as with
    // Tab, the keys walk, and a click on the view asks again.
    cursor = true;
    ui.setCursor(true);
    setPausedState(false);
  });
  window.addEventListener('mousedown', (e) => {
    if (touch) return; // taps are handled by the touch controls
    if (cursor && e.button === 0 && e.target === canvas) { // a click on the view looks around again, but not in a panel
      if (!boardPanel.isOpen && !tvPanel.isOpen) lockPointer();
      return;
    }
    if (!(autostart || document.pointerLockElement === canvas)) return;
    if (e.button === 2) return holding.startThrow();
    if (e.button !== 0) return;
    if (range.armed) { // with the rifle in hand a click fires, except on the rack and the button
      const t = interactions.current;
      if (t?.kind === 'range-button' && range.busy) fire(); // the button mid-round is just a spot on the wall: shoot through it
      else if (!useRange(t)) fire();
      return;
    }
    if (holding.holding) {
      if (holding.place()) return;
      if (interactions.current?.kind === 'prop') return; // another loose thing: one at a time
    }
    const t = interactions.click();
    if (pickUp(t)) return;
    if (t?.kind === 'screen' && t.screen.isTv) return openTv();
    if (useRange(t)) return;
    sitOn(t);
    drinkFrom(t);
    used(t);
    share(t);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) holding.releaseThrow();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // the right button throws
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      e.preventDefault(); // Tab toggles the free mouse, never focus cycling
      if (touch || !started || paused || autostart || e.repeat || boardPanel.isOpen || tvPanel.isOpen) return;
      if (cursor) lockPointer();
      else {
        freeing = true;
        document.exitPointerLock();
      }
      return;
    }
    if (e.code === 'Escape' && tvPanel.isOpen) return closeTv(false); // the panel first; Esc again pauses
    if (touch && e.code === 'Escape' && started && !autostart) return setPausedState(true); // a tablet's keyboard
    if (cursor && e.code === 'Escape') {
      cursor = false;
      ui.setCursor(false);
      setPausedState(true);
      return;
    }
    if (e.code === 'KeyG' && started && !autostart && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) return toggleGuests(); // paused too
    if (e.code === 'KeyT' && started && !paused && !autostart && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) return tvPanel.isOpen ? closeTv(true) : openTv();
    if (!started || paused) return;
    const sunKey = sunKeyAction(e.code, e.shiftKey, e.metaKey || e.ctrlKey || e.altKey);
    if (sunKey) {
      if (sunKey !== 'play' || !e.repeat) clock.apply(sunKey); // holding , or . keeps scrolling
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.altKey) holding.startThrow();
    if (e.code === 'KeyQ' && !e.metaKey && !e.ctrlKey && !e.altKey) holding.drop();
    if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) setReal(!real);
    if (e.code === 'KeyK' && !e.metaKey && !e.ctrlKey && !e.altKey) switchKitchen(kitchen === 'wall' ? 'open' : 'wall');
    if (e.code === 'KeyL') toggleRoomLight();
    if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey && !e.altKey) applyScene(nextScene(activeScene(world.lights, sceneGroups(currentRoom))).id, 'room');
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleMic();
    if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleSit();
  });
  window.addEventListener('blur', () => holding.cancelThrow());
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyF') holding.releaseThrow();
  });

  // ?stats: frame numbers in a corner; ?bench (with ?autostart): the same walk every time, measured per stop.
  const stats = params.has('stats') || params.has('bench') ? new FrameStats(renderer, () => [scene, surroundings.scene], document) : null;
  const bench = params.has('bench') ? new Bench(benchStops()) : null;
  function benchStops(): BenchStop[] {
    const eye = assets.manifest.eyeHeight;
    const s = assets.manifest.spawn;
    const stops: BenchStop[] = [{ name: 'spawn', x: s.x, y: eye, z: s.z, pitch: 0 }];
    for (const v of assets.manifest.viewpoints) stops.push({ name: v.name, x: v.position[0], y: v.position[1], z: v.position[2], pitch: v.pitch });
    for (const r of assets.manifest.rooms) {
      let x = 0;
      let z = 0;
      for (let k = 0; k < r.floor.length; k += 2) {
        x += r.floor[k];
        z += r.floor[k + 1];
      }
      const [fx, fz] = world.collision.nearestFree((2 * x) / r.floor.length, (2 * z) / r.floor.length);
      stops.push({ name: r.id, x: fx, y: eye, z: fz, pitch: 0 });
    }
    return stops;
  }
  // Only the rooms the visitor can see, through open doors (the export's visibility table): their chunks, doors,
  // drawers, screens, bulbs, mirrors and the loose things resting in them.
  const m = assets.manifest;
  const groupRoom = new Map(m.groups.map((g) => [g.id, g.room]));
  const mirrorAt = new Vector3();
  const culling = new RoomCulling(m.visibility, [
    ...m.chunks.flatMap((c) => (c.room ? [{ object: world.root.getObjectByName(c.node)!, rooms: [c.room] }] : [])),
    ...world.doors.flatMap((d, i) => (m.doors[i].rooms?.length ? [{ object: d.node, rooms: m.doors[i].rooms! }] : [])),
    ...world.movables.map((mv) => ({ object: mv.node, rooms: [mv.state.info.room] })),
    ...world.screens.map((sc) => ({ object: sc.node, rooms: [sc.info.room] })),
    ...world.glows.flatMap((g) => (groupRoom.has(g.group) ? [{ object: g.mesh as Object3D, rooms: [groupRoom.get(g.group)!] }] : [])),
    ...mirrors.children.flatMap((mirror) => {
      mirror.getWorldPosition(mirrorAt);
      const room = world.rooms.locate(mirrorAt.x, mirrorAt.z, null);
      if (!room) return [];
      (mirror as Mirror).seenFrom = (draw) => culling.seenFrom(room, draw);
      return [{ object: mirror, rooms: [room] }];
    }),
  ].filter((c) => c.object), props.list.map((p) => ({
    objects: [p.root, p.shadow.mesh], resting: () => p.state === 'rest', locate: (x: number, z: number) => world.rooms.locate(x, z, null),
  })));
  const doorOpen = (i: number) => world.doors[i].state.progress > 0;
  let benchShown = false;
  const screenCentre = new Vector3();
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stats?.begin(now);
    if (bench && stats) {
      const pose = bench.step(dt, stats.latest);
      if (pose) {
        player.frozen = true;
        player.teleport(pose.stop.x, pose.stop.z, pose.yaw, pose.stop.pitch, pose.stop.y);
        player.update(0);
      } else if (!benchShown) {
        benchShown = true;
        const report = bench.report();
        console.log(`Walkthrough bench\n${report}`);
        Object.assign(window, { benchResult: bench.results, benchReport: report });
        stats.extra = `\n${report}`;
        player.frozen = vp !== undefined; // a ?view= stays frozen, as without the bench
      }
    }
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
    props.hideShut(shut);
    drunk.update(dt);
    if (blackedOut && drunk.darkness === 1 && !player.seat) player.sit({ posture: 'sit', x: player.x, y: 0, z: player.z, yaw: player.yaw }, false);
    if (blackedOut && !drunk.passedOut) {
      blackedOut = false;
      player.frozen = false;
    }
    const filter = viewFilter(now / 1000, drunk.strength, drunk.darkness);
    if (canvas.style.filter !== filter) canvas.style.filter = filter;
    if (started && !paused) {
      player.wobble = wobbleAt(now / 1000, drunk.strength);
      const x = player.x;
      const z = player.z;
      player.update(dt);
      if (sound && steps.update(Math.hypot(player.x - x, player.z - z), player.running)) sound.step();
    }
    if (!player.frozen && !player.seat && world.collision.isBlocked(player.x, player.z)) player.resolve();
    if (others) {
      others.sendPose(player.x, player.z, player.yaw, player.pitch, seatingCode(player.seat), drunk.strength);
      others.tick();
    }
    avatars.update(dt, avatarLight);
    for (const m of props.update(dt)) sendProp(m);
    holding.update(dt);
    updateGames(dt, now / 1000);
    updateDraw(now);
    updateRange(dt, now);
    wine.update(dt, avatarLight(CONFIG.wine.at[0], CONFIG.wine.at[1]), interactions.current?.kind === 'wine');
    if (voices) {
      voices.update(dt, camera.getWorldPosition(ear), (id, out) => avatars.mouth(id, out), wallsBetween);
      for (const id of voices.ids) avatars.setTalk(id, voices.talk(id));
    }
    if (others) showPeople();
    showGuests(now);
    currentRoom = world.rooms.locate(player.x, player.z, currentRoom);
    sound?.setRoom(currentRoom);
    ui.setRoom(currentRoom ? names.get(currentRoom) ?? '' : '');
    const target = started ? interactions.update() : null;
    const verb = touch ? 'Tap' : 'Click';
    props.highlight(!holding.holding && !range.armed && target?.kind === 'prop' ? props.top(target.prop) : null);
    // One thing in hand: with the rifle a click fires (but on the rack and the button); with a loose thing, the rifle and
    // other loose things wait.
    const prompted = range.armed ? (target?.kind === 'rack' || target?.kind === 'range-button' ? target : null)
      : holding.holding && (target?.kind === 'prop' || target?.kind === 'rack') ? null : target;
    const handPrompt = started ? holding.prompt(verb, touch, prompted !== null) : null;
    const aimed = prompted ? promptFor(prompted, world.lights, verb) : null;
    ui.setPrompt(boardPanel.isOpen || tvPanel.isOpen ? null : handPrompt ?? aimed ?? (player.seat && started ? COPY.stand : null));
    ui.setHolding(touch && holding.holding);
    ui.setSitting(player.seat !== null);
    ui.setRoomLight(currentRoom && world.lights.has(currentRoom) ? world.lights.isOn(currentRoom) : null);
    ui.setScenes(activeScene(world.lights, sceneGroups(currentRoom)));
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
      if (s.info.group) world.lights.set(s.info.group, s.lit); // the TV's bias light, on with a game too
    }
    world.lights.update(dt);
    applyGlows(world.glows, world.lights);
    nanoleaf.update(now / 1000, world.lights); // after the glows, before the halos and packs take its colours
    halos.update(world.lights, camera);
    applyPacks(world);
    surroundings.sky.tick(now / 1000);
    uploads.tick();
    // A frame that redraws the sun's shadows draws everything: what's hidden casts no shadow.
    culling.apply(renderer.shadowMap.needsUpdate || params.has('nocull') ? null : currentRoom, doorOpen);
    renderer.clear();
    surroundings.render(renderer, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
    culling.show();
    if (rifle.shown) { // the rifle in hand over everything, so it never sinks into the railing
      renderer.clearDepth();
      renderer.render(rifle.scene, camera);
    }
    stats?.end(now);
  });
}

/** Android browsers go fullscreen from a tap, hiding their bars; iPhones can't, and nothing happens. */
function fullscreen(): void {
  document.documentElement.requestFullscreen?.()?.catch(() => {});
}

boot().catch((err) => fail(COPY.loadError, err));
