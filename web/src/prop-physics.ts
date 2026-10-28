import { Euler, type Object3D, Quaternion, Raycaster, Vector3 } from 'three';
import { CONFIG } from './config';

/** Where a segment first meets the flat: the point, the surface's normal facing back along the segment, and the mesh. */
export interface Hit { point: Vector3; normal: Vector3; object: Object3D }
export type Raycast = (from: Vector3, to: Vector3) => Hit | null;
/** A thing in the air: its middle, velocity, spin (rad/s about each axis) and turn; how long it has flown, its bounces,
 * its hardest landing (m/s) and whether it's sliding along a surface now. */
export interface Flight { position: Vector3; velocity: Vector3; spin: Vector3; quaternion: Quaternion; time: number; bounces: number; impact: number; sliding: boolean }
/** A flying thing is a ball: `radius`, and whether it falls over when it lands hard. */
export interface Shape { radius: number; tips: boolean }
/** Where it comes to rest: the surface point under it, the mesh it's on, whether it lies on its side, its heading. */
export interface Landing { point: Vector3; support: Object3D; tipped: boolean; yaw: number }
export type Step = { kind: 'flying' } | ({ kind: 'rest' } & Landing) | { kind: 'lost' };
type Physics = typeof CONFIG.props.physics;

const UP = new Vector3(0, 1, 0);
const move = new Vector3();
const end = new Vector3();
const tangent = new Vector3();
const below = new Vector3();
const axis = new Vector3();
const dq = new Quaternion();
const euler = new Euler();

/** Rays against meshes (three-mesh-bvh makes them fast): the nearest hit, with its normal in world space. */
export function meshRaycast(objects: Object3D[]): Raycast {
  const ray = new Raycaster() as Raycaster & { firstHitOnly?: boolean };
  ray.firstHitOnly = true;
  const dir = new Vector3();
  return (from, to) => {
    dir.subVectors(to, from);
    const far = dir.length();
    if (far < 1e-9) return null;
    ray.set(from, dir.divideScalar(far));
    ray.far = far;
    const hit = ray.intersectObjects(objects, true)[0];
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();
    return { point: hit.point.clone(), normal, object: hit.object };
  };
}

export function launch(position: Vector3, velocity: Vector3, spin = new Vector3(), quaternion = new Quaternion()): Flight {
  return { position: position.clone(), velocity: velocity.clone(), spin: spin.clone(), quaternion: quaternion.clone(), time: 0, bounces: 0, impact: 0, sliding: false };
}

/** The heading of a turn: its angle about up. */
export function yawOf(q: Quaternion): number {
  return euler.setFromQuaternion(q, 'YXZ').y;
}

/** Advances a flight by `dt`, in steps of at most `cfg.step`; tells when it comes to rest or is lost. */
export function fly(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg: Physics = CONFIG.props.physics): Step {
  for (let left = dt; left > 1e-9; left -= cfg.step) {
    const h = Math.min(cfg.step, left);
    f.time += h;
    const s = f.time > cfg.maxFlight ? settle(f, raycast, shape, cfg) : f.sliding ? slide(f, h, raycast, shape, cfg) : step(f, h, raycast, shape, cfg);
    if (s.kind !== 'flying') return s;
  }
  return { kind: 'flying' };
}

function turn(f: Flight, dt: number): void {
  const w = f.spin.length();
  if (w > 1e-6) f.quaternion.premultiply(dq.setFromAxisAngle(axis.copy(f.spin).divideScalar(w), w * dt));
}

function rest(f: Flight, point: Vector3, support: Object3D, shape: Shape, cfg: Physics): Step {
  return { kind: 'rest', point: point.clone(), support, tipped: shape.tips && f.impact > cfg.tipSpeed, yaw: yawOf(f.quaternion) };
}

/** Out of time: put it on whatever is under it. */
function settle(f: Flight, raycast: Raycast, shape: Shape, cfg: Physics): Step {
  const hit = raycast(f.position, below.copy(f.position).addScaledVector(UP, -3));
  return hit ? rest(f, hit.point, hit.object, shape, cfg) : { kind: 'lost' };
}

/** Bounces `v` off a surface: the speed into it comes back times `back`, the speed along it times `keep`. */
function bounce(v: Vector3, n: Vector3, back: number, keep: number): number {
  const vn = v.dot(n);
  tangent.copy(v).addScaledVector(n, -vn).multiplyScalar(keep);
  v.copy(tangent).addScaledVector(n, -vn * back);
  return vn;
}

function step(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg: Physics): Step {
  f.velocity.y -= cfg.gravity * dt;
  turn(f, dt);
  move.copy(f.velocity).multiplyScalar(dt);
  const len = move.length();
  if (len < 1e-9) return { kind: 'flying' };
  const hit = raycast(f.position, end.copy(f.position).addScaledVector(move, (len + shape.radius) / len));
  if (!hit) {
    f.position.add(move);
    return f.position.y < cfg.floorCatch ? { kind: 'lost' } : { kind: 'flying' };
  }
  f.position.copy(hit.point).addScaledVector(hit.normal, shape.radius);
  if (hit.normal.y < cfg.upNormal) { // a wall or a side: off it, still flying
    bounce(f.velocity, hit.normal, cfg.wallRestitution, 0.8);
    return { kind: 'flying' };
  }
  const vn = bounce(f.velocity, hit.normal, cfg.restitution, cfg.friction);
  f.impact = Math.max(f.impact, -vn);
  f.bounces += 1;
  f.spin.multiplyScalar(0.5);
  if (-vn * cfg.restitution < cfg.restSpeed || f.bounces >= cfg.maxBounces) { // too little left to bounce: slide
    f.sliding = true;
    f.velocity.y = 0;
  }
  return { kind: 'flying' };
}

/** Along the surface it landed on, slowing, until it stops, meets a wall or runs off an edge. */
function slide(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg: Physics): Step {
  const reach = shape.radius + cfg.support;
  const speed = Math.hypot(f.velocity.x, f.velocity.z);
  const slower = Math.max(0, speed - cfg.slideFriction * dt);
  if (slower < cfg.stopSpeed) {
    const under = raycast(f.position, below.copy(f.position).addScaledVector(UP, -reach));
    if (under) return rest(f, under.point, under.object, shape, cfg);
    f.sliding = false;
    return { kind: 'flying' };
  }
  f.velocity.set(f.velocity.x * (slower / speed), 0, f.velocity.z * (slower / speed));
  move.copy(f.velocity).multiplyScalar(dt);
  const len = move.length();
  const ahead = raycast(f.position, end.copy(f.position).addScaledVector(move, (len + shape.radius) / len));
  if (ahead && ahead.normal.y < cfg.upNormal) {
    f.position.copy(ahead.point).addScaledVector(ahead.normal, shape.radius);
    bounce(f.velocity, ahead.normal, cfg.wallRestitution, 0.8);
    f.velocity.y = 0;
  } else f.position.add(move);
  if (!raycast(f.position, below.copy(f.position).addScaledVector(UP, -reach))) f.sliding = false; // off the edge: it falls
  return { kind: 'flying' };
}
