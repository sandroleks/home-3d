export function sampleManifest(): unknown {
  return {
    version: 3,
    eyeHeight: 1.6,
    spawn: { x: 1, z: -0.8, yaw: -1.5708 },
    rooms: [
      { id: 'alpha', name: 'Alpha', floor: [0, 0, 3, 0, 3, -3, 0, 0, 3, -3, 0, -3], switch: 'Switch_alpha', area: 9 },
      { id: 'beta', name: 'Beta', floor: [3.2, 0, 6, 0, 6, -3, 3.2, 0, 6, -3, 3.2, -3], switch: null, area: 8.4 },
    ],
    groups: [
      { id: 'alpha', room: 'alpha', kind: 'switch', name: 'light', power: 100, target: 'Switch_alpha' },
      { id: 'alpha/desk-lamp', room: 'alpha', kind: 'lamp', name: 'desk-lamp', power: 10, target: 'Lamp_alpha-desk-lamp' },
      { id: 'beta/tv', room: 'beta', kind: 'lamp', name: 'tv', power: 60, target: null },
    ],
    chunks: [
      {
        node: 'Room_alpha', room: 'alpha', day: { file: 'lightmaps/alpha_day.webp', range: 4 }, light: { file: 'lightmaps/alpha_light.webp', range: 2 },
        packs: [{ file: 'lightmaps/alpha_pack0.webp', layers: [{ group: 'alpha/desk-lamp', range: 1.5, tint: [1.2, 0.95, 0.7] }] }],
      },
      {
        node: 'Room_beta', room: 'beta', day: { file: 'lightmaps/beta_day.webp', range: 3 }, light: null,
        packs: [{ file: 'lightmaps/beta_pack0.webp', layers: [{ spill: { opening: 1, from: 'alpha' }, range: 0.5, tint: [1, 1, 1] }, { group: 'beta/tv', range: 2, tint: [1, 1, 1] }] }],
      },
      { node: 'Room_exterior', room: null, day: { file: 'lightmaps/exterior_day.webp', range: 8 }, light: null, packs: [] },
    ],
    doors: [
      {
        node: 'Door_1', hinge: [3.1, -1.78], dir: [0, 1], width: 0.76, openAngle: -1.5708, opening: 1,
        lightmap: { file: 'lightmaps/door-1_day.webp', range: 2.5 }, packs: [],
      },
    ],
    movables: [
      {
        node: 'Move_cabinet-drawer', room: 'beta', kind: 'slide', dir: [0, 0, 1], distance: 0.35,
        lightmap: { file: 'lightmaps/movables-beta_day.webp', range: 1.5 }, packs: [],
      },
      {
        node: 'Move_cabinet-door', room: 'beta', kind: 'hinge', pivot: [4.42, 0.2, -2.55], axis: [0, 1, 0], angle: -1.7,
        lightmap: { file: 'lightmaps/movables-beta_day.webp', range: 1.5 }, packs: [],
      },
    ],
    screens: [
      { node: 'Screen_beta-tv', room: 'beta', kind: 'tv', group: 'beta/tv', center: [4.8, 1.2, -0.003], normal: [0, 0, -1], width: 0.8, height: 0.45 },
    ],
    glows: [{ node: 'Glow_desk-lamp-bulb', group: 'alpha/desk-lamp' }],
    viewpoints: [{ name: 'Cam_Sala', position: [4.5, 1.6, -1.5], yaw: 1.5708, pitch: 0, hfov: 1.5708 }],
    site: { lat: 41.117327, lon: -8.653914, timeZone: 'Europe/Lisbon', yBearing: 142.1 },
    sky: { irradiance: 0.6467, wattsToScene: 0.0044444 },
    windows: [{ room: 'alpha', center: [1.5, 1.5, 0.1], normal: [0, 0, 1], width: 1, height: 1 }],
  };
}
