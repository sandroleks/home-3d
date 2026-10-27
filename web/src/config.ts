import type { Ambience } from './audio';

export const CONFIG = {
  assetsBase: 'assets/',
  /** The kitchen walled off, as it is now (?kitchen=wall, K): its own export, inside assetsBase. */
  kitchenWallAssets: 'variants/kitchen-wall/',
  dracoPath: 'draco/',
  walkSpeed: 1.4,
  runSpeed: 2.8,
  mouseSensitivity: 0.0022,
  doorDuration: 0.6,
  /** Seconds for a glazed door's leaf to slide open or shut. */
  slidingDoorDuration: 0.9,
  /** Metres the player keeps from a sliding leaf (walls: the player's radius). */
  slidingLeafRadius: 0.1,
  /** Seconds for the turntable's platter to come up to speed, or to stop. */
  spinUp: 1.2,
  /** Seconds for a drawer or cupboard door to open or close. */
  movableDuration: 0.45,
  lightFadeDuration: 0.4,
  /** Mirrors draw their reflection at this share of the screen's resolution: a whole second view of the flat. */
  mirrorScale: 0.5,
  /** Packed lamp textures one lightmapped material can take (the pipeline's MAX_PACKS). */
  maxPacks: 3,
  /** Share of each room's own baked lamp light that is always there, lights off or not: light spilling in from elsewhere, so unlit rooms keep their shape rather than going flat or black. */
  lightSpill: 0.02,
  interactDistance: 2.5,
  /** Sitting and lying (seats.ts): click a seat or the bed, C to sit on the floor; moving stands you up. */
  seats: {
    /** Eye height (m) above the seat or floor sitting, and above the mattress lying down. */
    sitEye: 0.72,
    lieEye: 0.2,
    /** Metres the eyes are back from the spot's middle: a seated back, a head on the pillow. */
    sitBack: 0.1,
    lieBack: 0.45,
    /** Where the view starts lying down: looking along the bed and up toward the ceiling (radians). */
    liePitch: 0.5,
    /** Seconds to sit down, lie down or stand up. */
    transition: 0.45,
    /** Metres in front of a seat where standing up puts you (or the nearest free spot to it). */
    standStep: 0.6,
    /** A spot is taken when another visitor sits or lies within this many metres of it. */
    takenRadius: 0.3,
  },
  /** Blender renders at +0.5 EV; the walkthrough runs 0.8 EV brighter than the Cycles references, which read too dark on screen. */
  exposure: Math.pow(2, 1.3),
  /** Cycles' diffuse light pass is outgoing/albedo; three.js wants irradiance (×π). */
  lightmapScale: Math.PI,
  // The room-environment reflections, scaled by the sky; higher values add light Cycles doesn't have.
  envIntensity: 0.0015,
  /** The daytime sky at the horizon, seen through the windows. */
  skyColor: '#cfdbe6',
  sky: {
    zenith: '#7ea6d4',
    sunsetZenith: '#5a6f9e',
    nightZenith: '#04070f',
    /** Around the sun: faint and white by day, strong and orange near sunset. */
    dayGlow: '#fff4dc',
    sunsetGlow: '#ff9a4a',
    /** Angular radius of the drawn disc in degrees; the real sun's is 0.27, too small to see at this resolution. */
    sunRadius: 0.8,
    /** Share of the month's mean cloud cover that is drawn: the mean includes overcast days, which the typical day's light doesn't show. */
    cloudScale: 0.6,
    /** Cloud cover with real lighting off. */
    flatCloudCover: 0.25,
  },
  /** Near/far of the surroundings pass: the building's own facade is just below the windows, the sea kilometres out. */
  surroundingsNear: 0.3,
  surroundingsFar: 20000,
  /** Surroundings meshes thinner than this (m) are ground layers that share one plane. */
  surroundingsFlatHeight: 0.01,
  verticalFov: 70,
  /** Degrees. Tall screens (a phone held upright) widen the vertical field of view so at least this much shows across. */
  minHorizontalFov: 50,
  /** Phones and tablets (no mouse): drag the left side to walk, the right side to look, tap to use. */
  touch: {
    /** Share of the screen's width, from the left, where a touch becomes the walking stick. */
    stickArea: 0.5,
    /** CSS px from the stick's centre to its ring: a push to the ring walks at full speed. */
    stickRadius: 56,
    /** Share of the radius that does nothing, so a resting thumb doesn't drift. */
    deadZone: 0.12,
    /** Pushing past this many radii runs. */
    runPush: 1.5,
    /** Radians of turn per CSS px dragged. */
    lookSensitivity: 0.005,
    /** A touch that moves less than this (CSS px) and lifts within tapTime (ms) is a tap. */
    tapSlop: 10,
    tapTime: 300,
    /** Phones have far less GPU memory than desktops: lightmaps above this size are halved on load, and the sun's shadow map is smaller. */
    maxLightmapSize: 1024,
    shadowMapSize: 2048,
  },
  sun: {
    /** Seconds of sun per real second while playing: one hour every two seconds. */
    playRate: 1800,
    nudgeMinutes: 15,
    nudgeDays: 7,
    shadowMapSize: 4096,
    /** How far toward the sun (m) shadow casters are collected; a 10 m building's shadow at 3 degrees reaches about 190 m. */
    shadowReach: 200,
    shadowBias: -0.00002,
    shadowNormalBias: 0.01,
    /** Share of the sunlight entering a room that comes back as an even fill, per m² of floor. Tuned against Cycles references: winter-morning bedroom and summer-evening Sala within about 1%. */
    bounce: 0.04,
    /** Global scale on the baked sky layer, fitted against Cycles (0.38). Not a double pi: bake.Lighting._sky swaps the Sky Texture for a flat colour, so the bake world shines from every direction, including below the horizon, and the baked scene has no ground (prepare_scene removes the neighbourhood and building). Windows therefore get full sky radiance in their lower half, while the Cycles references render the full .blend, where ground and neighbours block it. The proper fix is a horizon in the bake world (sky above, black below), then a re-bake and re-fit. */
    skyGain: 0.38,
    /** The sun's colour at the horizon; white above 30 degrees. */
    warmColor: '#ffb070',
    sunsetSky: '#f2a46b',
    nightSky: '#0d1424',
    /** Even light on top of the bake (three ambient intensity; pi gives full albedo), so corners and windowless rooms aren't black. Fades from day to night over civil twilight. */
    ambient: { day: 0.15, night: 0.03, color: '#fff2e2' },
  },
  /** Real lighting off: the same even daylight whatever the date and time. */
  flatLighting: {
    /** Baked sky layer brightness; real days run from about 0.5 (winter sunset) to 4.7 (summer noon). */
    sky: 3,
    ambient: 0.15,
    /** The neighbourhood's lighting (W/m²) and the sun's direction (degrees) outside. */
    outsideSun: { elevation: 50, azimuth: 200, watts: 500 },
    outsideSky: 150,
  },
  /** Visitors see each other: WebRTC between their browsers, found through public Nostr relays (Trystero), no server. */
  multiplayer: {
    appId: 'apartment-walkthrough',
    /** Everyone on the site shares this room; `?room=<name>` gives a group one of its own. */
    room: 'apartment',
    /** Where TURN credentials come from (`api/turn.ts`), for visitors whose networks block a direct connection, and
     * how long (ms) to wait for them before joining without. */
    turn: { url: 'api/turn', timeout: 3000 },
    /** Poses sent per second while moving or turning, and while still (a heartbeat). */
    poseRate: 15,
    idleRate: 1,
    /** Seconds without a pose before a visitor's avatar is removed. */
    staleAfter: 15,
    /** Time constant (s) of the avatars' motion smoothing between poses. */
    smoothing: 0.1,
    maxNameLength: 24,
    defaultName: 'Guest',
    /** Each visitor's colour, picked from here by their peer id: pastels, the first a caramel after the reindeer's brown. */
    colours: ['#e2bc94', '#f7b2c4', '#a9d4f5', '#b5e5b0', '#fde29b', '#cdb6f2', '#ffc4a0', '#9fe3d6'],
    /** The visitors' figures (`creatures.ts`): little toy animals, about 1.6 m to the antler tips at scale 1. */
    creature: {
      scale: 1,
      /** Metres between the top of the figure and its name label, and the label's width and height. */
      labelGap: 0.18,
      label: [0.9, 0.16] as [number, number],
      /** Metres walked per walk cycle (a step with each pair of legs). */
      stride: 0.75,
      /** The figure's brightness in an unlit room at night, as a share of its full colour. */
      darkest: 0.25,
      /** The baked sky level at which daylight shows a figure in full colour (night 0, a summer noon about 4.7). */
      daylight: 1.5,
      /** How much a lamp lights a figure in its room, against the room's ceiling light. */
      lamp: 0.7,
      /** Metres the body bounces with each step. */
      bounce: 0.05,
      /** Time constant (s) of sitting down, lying down and getting up. */
      settle: 0.15,
      /** The googly pupils: how stiff and how damped their spring is (lower damping wobbles longer), and how far they roll (radians). */
      googly: { stiffness: 80, damping: 3.2, range: 0.55 },
      /** Seconds between blinks, at random within this range, and how long one lasts. */
      blink: [2, 6] as [number, number],
      blinkTime: 0.16,
    },
    /** Proximity voice (voice.ts): how voices fall off with distance, how walls muffle them, and how a voice opens
     * its animal's mouth. */
    voice: {
      /** The voices' bus, against the other sounds. */
      level: 1,
      /** Metres within which a voice is at full level, how fast it falls off beyond, and where it stops falling. */
      refDistance: 1.5,
      rolloff: 1.2,
      maxDistance: 15,
      /** Wall checks per second per voice, and seconds a change in walls takes to fade in. */
      occlusionRate: 10,
      occlusionFade: 0.15,
      /** Metres within which hits along the ray count as one wall (both faces of it). */
      mergeHits: 0.3,
      /** Gain and low-pass cutoff (Hz) for 0, 1, 2 and 3 or more walls or closed doors in the way. */
      walls: [[1, 20000], [0.5, 1800], [0.25, 900], [0.12, 500]] as [number, number][],
      /** A voice's loudness as a mouth: the RMS of silence and of a full voice, seconds to open and to close, and the
       * level above which the "With …" line marks them talking, held for `hold` seconds. */
      talk: { floor: 0.01, full: 0.12, rise: 0.03, fall: 0.12, shown: 0.25, hold: 0.5 },
      /** Radians the body nods forward at full voice. */
      nod: 0.06,
    },
  },
  /** The office's Nanoleaf panels (nanoleaf.ts): a gradient between two hues (0..1: teal to magenta, through blue)
   * drifting across the panels, `speed` radians a second, `spread` radians a metre along the wall. `glow` scales the
   * panels' baked glow so the colours stay deep instead of clipping to white. */
  nanoleaf: { hues: [0.47, 0.83] as [number, number], speed: 0.45, spread: 4.5, saturation: 1, lightness: 0.5, glow: 0.22 },
  /** Philips Hue scenes (hue.ts): S in the sun panel, H steps through them in the room you're in. */
  hue: {
    /** Colour temperature the lamps were baked at (model_details.py: 3000 K ceilings, 2700 K lamps). */
    bakedKelvin: 2850,
    /** For linking the flat's real bridge later: its address and app key, and each room id's Hue room (group) id.
     * Until then (bridge null) scenes only change the walkthrough. */
    bridge: null as string | null,
    appKey: '',
    rooms: {} as Record<string, string>,
  },
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
  /** How prompts name each lamp group ("Click: turn floor lamp on"); otherwise its name with spaces for hyphens. */
  lampNames: {
    'bar-shelves': 'shelf lights', workbench: 'workbench light', 'bedside-left': 'bedside lamp', 'bedside-right': 'bedside lamp',
    'screen-bar': 'monitor light', 'wall-lights': 'wall lights', nanoleaf: 'Nanoleaf panels', niche: 'shelf light',
  } as Record<string, string>,
  /** The TV, monitor and laptop: picture size in px and brightness. The light they cast is baked (SCREEN_LIGHT_WATTS). */
  screens: {
    sizes: { tv: [512, 288], monitor: [512, 288], laptop: [384, 240] } as Record<string, [number, number]>,
    /** Multiplies the picture: above 1 the brightest parts bloom. */
    brightness: 1.25,
    /** Pictures redraw this often (per second), and only within this distance (m). */
    fps: 30,
    maxDistance: 10,
    fade: 0.25,
  },
  /** Soft glow around small lit fixtures (bulbs, lampshades, ceiling diffusers): one camera-facing sprite each. */
  halos: {
    /** Brightness, times the fixture's glow colour and its lamp's level. */
    strength: 0.35,
    /** Sprite size relative to the fixture, and its limits in m. */
    size: 2.2,
    minSize: 0.25,
    maxSize: 1.1,
    /** Glowing surfaces larger than this (m) get no halo: LED strips, a pair of wall lights sharing a material. */
    maxFixture: 0.7,
  },
  /** Rooms whose ambience isn't the default quiet room tone. */
  roomAmbience: { varanda: 'outdoor', marquise: 'outdoor', cozinha: 'kitchen', lavandaria: 'kitchen' } as Record<string, Ambience>,
  audio: {
    base: 'assets/audio/',
    /** Bus levels for one-shot effects, footsteps, room ambience and music. */
    effects: 0.5,
    steps: 0.35,
    ambience: 0.4,
    music: 0.25,
    /** Seconds. */
    ambienceFade: 1.5,
    /** The music fading in when the turntable starts and out when it stops. */
    musicFade: 1.5,
    muteFade: 0.2,
    /** Metres between footsteps, and before the first one after standing still. */
    stride: 0.7,
    runStride: 0.9,
    firstStep: 0.25,
  },
};
