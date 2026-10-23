import type { Ambience } from './audio';

export const CONFIG = {
  assetsBase: 'assets/',
  dracoPath: 'draco/',
  walkSpeed: 1.4,
  runSpeed: 2.8,
  mouseSensitivity: 0.0022,
  doorDuration: 0.6,
  lightFadeDuration: 0.4,
  interactDistance: 2.5,
  /** Blender renders at +0.5 EV. */
  exposure: Math.pow(2, 0.5),
  /** Cycles' diffuse light pass is outgoing/albedo; three.js wants irradiance (×π). */
  lightmapScale: Math.PI,
  // The room-environment reflections, scaled by the sky; higher values add light Cycles doesn't have.
  envIntensity: 0.0015,
  /** Flat daylight sky seen through the windows. */
  skyColor: '#cfdbe6',
  /** Near/far of the surroundings pass: the building's own facade is just below the windows, the sea kilometres out. */
  surroundingsNear: 0.3,
  surroundingsFar: 20000,
  /** Surroundings meshes thinner than this (m) are ground layers that share one plane. */
  surroundingsFlatHeight: 0.01,
  verticalFov: 70,
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
  },
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
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
    muteFade: 0.2,
    /** Metres between footsteps, and before the first one after standing still. */
    stride: 0.7,
    runStride: 0.9,
    firstStep: 0.25,
  },
};
