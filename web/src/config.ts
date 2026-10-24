import type { Ambience } from './audio';

export const CONFIG = {
  assetsBase: 'assets/',
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
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
  /** How prompts name each lamp group ("Click: turn floor lamp on"); otherwise its name with spaces for hyphens. */
  lampNames: {
    'bar-shelves': 'shelf lights', workbench: 'workbench light', 'bedside-left': 'bedside lamp', 'bedside-right': 'bedside lamp',
    'screen-bar': 'monitor light', 'wall-lights': 'wall lights',
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
