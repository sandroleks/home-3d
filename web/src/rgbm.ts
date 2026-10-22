/** RGBM decode, matching blender/pipeline/raster.py rgbm_encode. */
export const RGBM_GLSL = /* glsl */ `
vec3 rgbmDecode( vec4 c, float range ) { return c.rgb * c.a * range; }
`;

export function rgbmDecode(r: number, g: number, b: number, a: number, range: number): [number, number, number] {
  return [r * a * range, g * a * range, b * a * range];
}
