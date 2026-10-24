import { type Object3D, Quaternion, Vector3 } from 'three';
import { CONFIG } from './config';
import { easeInOut } from './doors';
import type { MovableInfo } from './manifest';

/** A drawer or cupboard door: eases between shut (0) and open (1). */
export class MovableState {
  progress = 0;
  target = 0;

  constructor(readonly info: MovableInfo, private duration = CONFIG.movableDuration) {}

  get isOpen(): boolean {
    return this.target === 1;
  }

  /** How far open, eased: 0 shut, 1 open. */
  get amount(): number {
    return easeInOut(this.progress);
  }

  toggle(): void {
    this.target = this.target === 1 ? 0 : 1;
  }

  update(dt: number): void {
    const step = dt / this.duration;
    this.progress = this.target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
  }
}

export interface MovableRuntime { state: MovableState; node: Object3D; position: Vector3; quaternion: Quaternion }

const tmp = new Quaternion();
const axis = new Vector3();

export function movableRuntime(state: MovableState, node: Object3D): MovableRuntime {
  return { state, node, position: node.position.clone(), quaternion: node.quaternion.clone() };
}

/** Pose the node: a slide moves along its direction, a hinge turns about its axis through the node's origin (the pivot). */
export function applyMovable(m: MovableRuntime): void {
  const { info, amount } = m.state;
  if (info.kind === 'slide') {
    m.node.position.copy(m.position).addScaledVector(axis.fromArray(info.dir!), info.distance! * amount);
  } else {
    m.node.quaternion.copy(m.quaternion).premultiply(tmp.setFromAxisAngle(axis.fromArray(info.axis!), info.angle! * amount));
  }
}

/** What a prompt calls it: "open drawer", "close fridge". */
export function movableNoun(info: MovableInfo): string {
  const n = info.node.toLowerCase();
  if (n.includes('fridge')) return n.includes('lower') ? 'freezer' : 'fridge';
  if (n.includes('dishwasher')) return 'dishwasher';
  if (n.includes('wardrobe')) return 'wardrobe';
  if (info.kind === 'slide') return n.includes('pull-out') ? 'pull-out' : 'drawer';
  return 'cupboard';
}
