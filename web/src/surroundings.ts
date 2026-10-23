import {
  Box3, Color, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene, ShaderMaterial, Vector3,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from './config';
import { Sky, type SkyState } from './sky';

/** Flat ground layers (grass, asphalt, water…) lie in one plane; the bigger the layer, the further back it draws. */
export function groundOffsets(layers: { flat: boolean; area: number }[]): number[] {
  const order = layers.map((_, i) => i).filter((i) => layers[i].flat).sort((a, b) => layers[a].area - layers[b].area);
  const out = layers.map(() => 0);
  order.forEach((i, rank) => (out[i] = rank + 1));
  return out;
}

export interface SurroundingsLight {
  /** Unit vector toward the sun, three.js space. */
  sunDir: { value: Vector3 };
  /** Sun colour times its direct-normal strength, scene units. */
  sunLight: { value: Color };
  /** Sky irradiance on an upward face, scene units. */
  skyLight: { value: number };
}

export function makeSurroundingsLight(): SurroundingsLight {
  return { sunDir: { value: new Vector3(0, 1, 0) }, sunLight: { value: new Color(0, 0, 0) }, skyLight: { value: 0 } };
}

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize( mat3( modelMatrix ) * normal );
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// Lambert sun plus a sky that lights an upward face fully, a wall half and a downward face not at all
// (the same formula the export used to bake). No shadows between buildings.
const FRAGMENT = /* glsl */ `
#include <common>
uniform vec3 color;
uniform sampler2D map;
uniform vec3 sunDir;
uniform vec3 sunLight;
uniform float skyLight;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 n = normalize( vNormal );
  vec3 albedo = color;
#ifdef USE_SURROUNDINGS_MAP
  albedo *= texture2D( map, vUv ).rgb;
#endif
  vec3 e = vec3( skyLight * ( 1.0 + n.y ) * 0.5 ) + sunLight * max( dot( n, sunDir ), 0.0 );
  gl_FragColor = vec4( albedo * e / PI, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Swap the glTF materials for the live sun-and-sky shader. */
export function prepareSurroundings(root: Object3D, light: SurroundingsLight): void {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const size = new Vector3();
  const offsets = groundOffsets(
    meshes.map((m) => {
      new Box3().setFromObject(m).getSize(size);
      return { flat: size.y < CONFIG.surroundingsFlatHeight, area: size.x * size.z };
    }),
  );
  meshes.forEach((m, i) => {
    const src = m.material as MeshStandardMaterial;
    m.material = new ShaderMaterial({
      name: src.name,
      uniforms: { color: { value: src.color.clone() }, map: { value: src.map }, ...light },
      defines: src.map ? { USE_SURROUNDINGS_MAP: '' } : {},
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: src.side,
      polygonOffset: offsets[i] > 0, polygonOffsetFactor: offsets[i], polygonOffsetUnits: offsets[i],
    });
  });
}

/**
 * The neighbourhood outside the windows, in front of the sky. It is drawn first, with its own camera reaching kilometres
 * out, then the apartment on top after a depth clear, so the apartment keeps its depth precision.
 */
export class Surroundings {
  readonly scene = new Scene();
  readonly light = makeSurroundingsLight();
  readonly sky = new Sky();
  private camera = new PerspectiveCamera();

  constructor() {
    this.scene.add(this.sky.mesh);
  }

  setSky(state: SkyState): void {
    this.sky.set(state);
  }

  add(root: Object3D): void {
    prepareSurroundings(root, this.light);
    this.scene.add(root);
  }

  render(renderer: WebGLRenderer, eye: PerspectiveCamera): void {
    const c = this.camera;
    eye.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    c.fov = eye.fov;
    c.aspect = eye.aspect;
    c.near = CONFIG.surroundingsNear;
    c.far = CONFIG.surroundingsFar;
    c.updateProjectionMatrix();
    renderer.render(this.scene, c);
  }
}
