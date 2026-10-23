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
  // Tuned against the Cycles references: higher values wash out the baked light.
  envIntensity: 0.08,
  /** Flat daylight sky seen through the windows. */
  skyColor: '#cfdbe6',
  /** The export stores the surroundings' shade halved (glTF vertex colours stop at 1); see surroundings.py. */
  surroundingsShadeScale: 2,
  /** Near/far of the surroundings pass: the building's own facade is just below the windows, the sea kilometres out. */
  surroundingsNear: 0.3,
  surroundingsFar: 20000,
  /** Surroundings meshes thinner than this (m) are ground layers that share one plane. */
  surroundingsFlatHeight: 0.01,
  verticalFov: 70,
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
};
