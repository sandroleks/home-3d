import {
  Box3, Color, Group, HalfFloatType, type Material, Matrix4, Mesh, type Object3D, PerspectiveCamera, Plane, PlaneGeometry,
  Raycaster, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { CONFIG } from './config';
import type { Surroundings } from './surroundings';

export function isMirror(m: Material): boolean {
  return /^mirror(\.\d+)?$/i.test(m.name);
}

/** Where a reflecting plane goes: the mirror slab's room-facing face, as centre, outward normal and size. */
export interface MirrorFace { center: Vector3; normal: Vector3; width: number; height: number }

/** Anything this close behind a face is what the mirror is mounted on. */
const MOUNT_GAP = 0.05;
const THIN = 0.03;
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

/**
 * The face of a thin axis-aligned mirror slab that looks into the room: the side with nothing behind it
 * within a few centimetres. Null when the slab isn't thin and axis-aligned, or both sides are covered.
 */
export function mirrorFace(mesh: Mesh, others: Object3D[]): MirrorFace | null {
  mesh.updateWorldMatrix(true, false);
  const box = new Box3().setFromObject(mesh);
  const size = box.getSize(new Vector3());
  const thin = [size.x, size.y, size.z].indexOf(Math.min(size.x, size.y, size.z));
  if (size.getComponent(thin) > THIN) return null;
  const center = box.getCenter(new Vector3());
  const half = size.getComponent(thin) / 2;
  const ray = new Raycaster();
  ray.far = half + MOUNT_GAP;
  const open = [1, -1].filter((sign) => {
    const dir = AXES[thin].clone().multiplyScalar(sign);
    ray.set(center, dir); // from inside the slab: the mount's face sits flush against its back
    return ray.intersectObjects(others, true).every((h) => h.object === mesh);
  });
  if (open.length === 0) return null;
  const normal = AXES[thin].clone().multiplyScalar(open[0]);
  const [u, v] = thin === 1 ? [size.x, size.z] : [thin === 0 ? size.z : size.x, size.y];
  return { center: center.addScaledVector(normal, half + 0.001), normal, width: u, height: v };
}

const shader = {
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 tint;
    uniform sampler2D map;
    varying vec4 vUv;
    void main() {
      gl_FragColor = vec4(texture2DProj(map, vUv).rgb * tint, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * A planar reflection after three's Reflector: before the mirror is drawn, the scene is rendered from the
 * camera reflected in its plane (outside view first, as the main loop does). All mirrors share one render
 * target, since each is drawn straight after its own reflection pass; `all` (every mirror) is hidden during a
 * pass, so a mirror seen in another shows its bare slab rather than the target being drawn.
 */
export class Mirror extends Mesh {
  constructor(face: MirrorFace, tint: Color, target: WebGLRenderTarget, surroundings: Surroundings, all: Object3D) {
    const textureMatrix = new Matrix4();
    super(new PlaneGeometry(face.width, face.height), new ShaderMaterial({
      name: 'Mirror reflection',
      uniforms: { tint: { value: tint }, map: { value: target.texture }, textureMatrix: { value: textureMatrix } },
      ...shader,
    }));
    this.position.copy(face.center);
    this.lookAt(face.center.clone().add(face.normal));

    const eye = new PerspectiveCamera();
    const plane = new Plane();
    const normal = new Vector3();
    const mirrorPos = new Vector3();
    const cameraPos = new Vector3();
    const look = new Vector3();
    const view = new Vector3();
    const rotation = new Matrix4();
    const clip = new Vector4();
    const q = new Vector4();
    const bufferSize = new Vector2();

    this.onBeforeRender = (renderer: WebGLRenderer, scene, camera) => {
      const cam = camera as PerspectiveCamera;
      mirrorPos.setFromMatrixPosition(this.matrixWorld);
      cameraPos.setFromMatrixPosition(cam.matrixWorld);
      normal.set(0, 0, 1).applyMatrix4(rotation.extractRotation(this.matrixWorld));
      view.subVectors(mirrorPos, cameraPos);
      if (view.dot(normal) > 0) return; // seen from behind

      view.reflect(normal).negate().add(mirrorPos);
      rotation.extractRotation(cam.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rotation).add(cameraPos);
      look.subVectors(mirrorPos, look).reflect(normal).negate().add(mirrorPos);
      eye.position.copy(view);
      eye.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
      eye.lookAt(look);
      eye.fov = cam.fov;
      eye.aspect = cam.aspect;
      eye.far = cam.far;
      eye.layers.mask = cam.layers.mask; // what the main camera sees, carried things too
      eye.updateMatrixWorld();
      eye.projectionMatrix.copy(cam.projectionMatrix);

      textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(eye.projectionMatrix).multiply(eye.matrixWorldInverse).multiply(this.matrixWorld);

      // Oblique near plane on the mirror (Lengyel), so nothing behind the mirror shows in it.
      plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(eye.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = eye.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x;
      p[6] = clip.y;
      p[10] = clip.z + 1;
      p[14] = clip.w;

      renderer.getDrawingBufferSize(bufferSize).multiplyScalar(CONFIG.mirrorScale).round();
      if (target.width !== bufferSize.x || target.height !== bufferSize.y) target.setSize(bufferSize.x, bufferSize.y);
      const previous = renderer.getRenderTarget();
      all.visible = false;
      renderer.setRenderTarget(target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      surroundings.render(renderer, eye);
      renderer.clearDepth();
      renderer.render(scene, eye);
      renderer.setRenderTarget(previous);
      all.visible = true;
    };
  }
}

/** Put a reflecting plane on each mirror under root. */
export function addMirrors(root: Object3D, surroundings: Surroundings): Group {
  const slabs: Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && isMirror(mesh.material as Material)) slabs.push(mesh);
  });
  const all = new Group();
  all.name = 'Mirrors';
  if (slabs.length === 0) return all;
  const target = new WebGLRenderTarget(1, 1, { samples: 2, type: HalfFloatType });
  all.userData.target = target; // for shader warm-up: the scene drawn into it needs its own shader variants
  for (const slab of slabs) {
    const face = mirrorFace(slab, [root]);
    if (!face) {
      console.warn(`Mirror ${slab.name} isn't a thin axis-aligned slab with an open side; it stays as it is.`);
      continue;
    }
    const tint = ((slab.material as { color?: Color }).color ?? new Color(1, 1, 1)).clone();
    all.add(new Mirror(face, tint, target, surroundings, all));
  }
  root.add(all);
  return all;
}
