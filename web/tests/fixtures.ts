export function sampleManifest(): unknown {
  return {
    version: 1,
    eyeHeight: 1.6,
    spawn: { x: 1, z: -0.8, yaw: -1.5708 },
    rooms: [
      { id: 'alpha', name: 'Alpha', floor: [0, 0, 3, 0, 3, -3, 0, 0, 3, -3, 0, -3], switch: 'Switch_alpha' },
      { id: 'beta', name: 'Beta', floor: [3.2, 0, 6, 0, 6, -3, 3.2, 0, 6, -3, 3.2, -3], switch: null },
    ],
    chunks: [
      { node: 'Room_alpha', room: 'alpha', day: { file: 'lightmaps/alpha_day.webp', range: 4 }, light: { file: 'lightmaps/alpha_light.webp', range: 2 } },
      { node: 'Room_beta', room: 'beta', day: { file: 'lightmaps/beta_day.webp', range: 3 }, light: null },
      { node: 'Room_exterior', room: null, day: { file: 'lightmaps/exterior_day.webp', range: 8 }, light: null },
    ],
    doors: [
      { node: 'Door_1', hinge: [3.1, -1.78], dir: [0, 1], width: 0.76, openAngle: -1.5708, lightmap: { file: 'lightmaps/door-1_day.webp', range: 2.5 } },
    ],
    viewpoints: [{ name: 'Cam_Sala', position: [4.5, 1.6, -1.5], yaw: 1.5708, pitch: 0, hfov: 1.5708 }],
  };
}
