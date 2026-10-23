import { BackSide, Color, LessEqualDepth, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { CONFIG } from './config';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const RAD = Math.PI / 180;

export interface SkyColors { zenith: Color; horizon: Color; glow: Color }

/** Blend through the stops of a day: full day from 6 degrees up, sunset at the horizon, night by the end of civil twilight. */
function byElevation(elevation: number, day: string, sunset: string, night: string): Color {
  if (elevation >= 6) return new Color(day);
  if (elevation >= 0) return new Color(sunset).lerp(new Color(day), elevation / 6);
  if (elevation >= -6) return new Color(night).lerp(new Color(sunset), (elevation + 6) / 6);
  return new Color(night);
}

/** The sky's gradient and the glow around the sun for a sun elevation in degrees. The horizon is the old flat sky colour. */
export function skyColors(elevation: number): SkyColors {
  const s = CONFIG.sky;
  // Faint by day; stronger and orange as the sun nears the horizon, but never so bright that the disc is lost in it.
  const low = clamp01(1 - elevation / 20);
  const glowStrength = clamp01((elevation + 6) / 6) * (0.12 + 0.45 * low);
  return {
    zenith: byElevation(elevation, s.zenith, s.sunsetZenith, s.nightZenith),
    horizon: byElevation(elevation, CONFIG.skyColor, CONFIG.sun.sunsetSky, CONFIG.sun.nightSky),
    glow: new Color(s.dayGlow).lerp(new Color(s.sunsetGlow), low * low).multiplyScalar(glowStrength),
  };
}

/** Share of the sky under cloud for a month's mean cloud cover in percent; the mean includes overcast days, so it is scaled down. */
export function cloudCover(meanPercent: number, scale = CONFIG.sky.cloudScale): number {
  return clamp01((meanPercent / 100) * scale);
}

export interface SkyState {
  /** Unit vector toward the sun, three.js space. */
  dir: readonly [number, number, number];
  /** Degrees above the horizon. */
  elevation: number;
  /** 0 to 1. */
  cover: number;
  /** The sun's light colour (white above 30 degrees, warmer toward the horizon). */
  sunColor: Color;
  /** 0 below the horizon, 1 once the disc is clear of it. */
  sunVisible: number;
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only, drawn at the far plane: the sky sits at infinity for any camera, the mirrors' included.
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 glow;
uniform vec3 sunColor;
uniform float sunVisible;
uniform float sunCos;
uniform float cover;
uniform float time;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
varying vec3 vDir;

float hash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float noise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float fbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 5; i++ ) {
    v += a * noise( p );
    p = p * 2.03 + vec2( 17.1, 9.2 );
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize( vDir );
  float up = max( d.y, 0.0 );
  float c = dot( d, sunDir );

  vec3 col = mix( horizon, zenith, pow( up, 0.45 ) );
  col += glow * pow( max( c, 0.0 ), 6.0 ) * ( 1.0 - 0.6 * up );
  col = mix( col, horizon * 0.85, smoothstep( 0.0, -0.15, d.y ) ); // below the horizon: haze over the sea

  // Clouds on a flat layer overhead, drifting; thinned toward the horizon where the projection stretches them.
  float cloud = 0.0;
  if ( d.y > 0.0 ) {
    vec2 uv = d.xz / ( d.y + 0.12 ) * 0.9 + vec2( time * 0.006, time * 0.0025 );
    float n = fbm( uv );
    float edge = 1.0 - cover;
    cloud = smoothstep( edge - 0.12, edge + 0.22, n ) * smoothstep( 0.0, 0.18, d.y ) * step( 0.001, cover );
    float rim = pow( max( c, 0.0 ), 12.0 );
    vec3 cc = mix( cloudShade, cloudLit, clamp( 0.55 + 0.45 * ( n - edge ) * 3.0, 0.0, 1.0 ) ) + sunColor * rim * 0.35;
    col = mix( col, cc, cloud * 0.92 );
  }

  // The disc, a tight halo and a wider bloom; clouds in front dim all three.
  float clear = sunVisible * ( 1.0 - 0.85 * cloud );
  float disc = smoothstep( sunCos - 0.00002, sunCos + 0.00002, c );
  float halo = exp( ( c - 1.0 ) * 1500.0 ) * 0.3 + exp( ( c - 1.0 ) * 150.0 ) * 0.1;
  col += sunColor * halo * clear;
  col = mix( col, sunColor * 1.6 + 0.4, disc * clear );

  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}`;

/**
 * Gradient sky, sun disc and drifting clouds behind the neighbourhood. Colours are display colours like the flat
 * background it replaces, so it skips tone mapping.
 */
export class Sky {
  readonly mesh: Mesh;
  readonly uniforms = {
    sunDir: { value: new Vector3(0, 1, 0) },
    zenith: { value: new Color() },
    horizon: { value: new Color() },
    glow: { value: new Color() },
    sunColor: { value: new Color() },
    sunVisible: { value: 0 },
    sunCos: { value: Math.cos(CONFIG.sky.sunRadius * RAD) },
    cover: { value: 0 },
    time: { value: 0 },
    cloudLit: { value: new Color() },
    cloudShade: { value: new Color() },
  };

  constructor() {
    const material = new ShaderMaterial({
      name: 'Sky',
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthWrite: false,
      depthFunc: LessEqualDepth,
      toneMapped: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 32, 16), material);
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  set(s: SkyState): void {
    const u = this.uniforms;
    const colors = skyColors(s.elevation);
    u.sunDir.value.set(s.dir[0], s.dir[1], s.dir[2]);
    u.zenith.value.copy(colors.zenith);
    u.horizon.value.copy(colors.horizon);
    u.glow.value.copy(colors.glow);
    u.sunColor.value.copy(s.sunColor);
    u.sunVisible.value = s.sunVisible;
    u.cover.value = s.cover;
    // Clouds take the sun's colour by day and the sky's own at night; their shaded side is a darker sky.
    const day = clamp01((s.elevation + 6) / 12);
    u.cloudLit.value.copy(colors.horizon).lerp(new Color(1, 1, 1).lerp(s.sunColor, 0.6), day);
    u.cloudShade.value.copy(colors.horizon).lerp(colors.zenith, 0.35).multiplyScalar(0.55 + 0.25 * day);
  }

  /** Seconds since start, for the cloud drift. */
  tick(seconds: number): void {
    this.uniforms.time.value = seconds;
  }
}
