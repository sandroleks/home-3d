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
  envIntensity: 0.2,
  verticalFov: 70,
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
};
