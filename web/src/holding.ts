import { Group, Mesh, MeshBasicMaterial, type PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { CONFIG } from './config';
import { yawOf } from './prop-physics';
import { findPlacement, type PlaceProbe, type PlaceResult } from './prop-placement';
import { CARRIED_LAYER, type Prop, type PropMessage, type Props } from './props';
import { COPY } from './ui';

const UP = new Vector3(0, 1, 0);
const CENTRE = new Vector2(0, 0);
const camQ = new Quaternion();

/** This visitor's hand: where the held thing is, where it would go, throwing and dropping it. */
export class Holding {
  /** A faint copy of the held thing where it would go; in the scene, on the carried layer. */
  readonly ghost = new Group();
  private result: PlaceResult | null = null;
  private charge: number | null = null;
  private noticeUntil = -Infinity;
  private ghostOf: Prop | null = null;
  private ray = new Raycaster();
  private ghostMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: CONFIG.props.ghostOpacity, depthWrite: false });

  constructor(private props: Props, private camera: PerspectiveCamera, private probe: PlaceProbe, private send: (m: PropMessage) => void,
    private now: () => number = () => performance.now() / 1000) {
    this.ghost.name = 'Prop ghost';
    this.ghost.visible = false;
  }

  get holding(): boolean {
    return this.props.held !== null;
  }

  /** Low and to the right of the view, upright and turned the way the visitor faces. */
  hand(position: Vector3, quaternion: Quaternion): void {
    this.camera.updateMatrixWorld();
    position.fromArray(CONFIG.props.hand).applyMatrix4(this.camera.matrixWorld);
    quaternion.setFromAxisAngle(UP, this.yaw());
  }

  /** Every frame: the throw's charge, and where the held thing would go along the ray through `aim`. */
  update(dt: number, aim: Vector2 = CENTRE): void {
    if (this.charge !== null) this.charge += dt;
    const held = this.props.held;
    this.result = held ? this.find(held, aim) : null;
    if (!held || !this.result?.ok) {
      this.ghost.visible = false;
      return;
    }
    if (this.ghostOf !== held) this.makeGhost(held);
    this.ghost.visible = true;
    this.ghost.position.copy(this.result.placement.point);
    this.ghost.quaternion.setFromAxisAngle(UP, this.result.placement.yaw);
  }

  /** What to say: a note, or what a click would do with the held thing. Null hands the prompt back to the crosshair's
   * target (`otherTarget`: a door, a drawer front, a lamp), or to nothing. */
  prompt(verb: string, touch: boolean, otherTarget: boolean): string | null {
    if (this.now() < this.noticeUntil) return COPY.taken;
    const held = this.props.held;
    if (!held) return null;
    if (this.result?.ok) return `${verb}: put down ${held.info.name}`;
    if (this.result?.reason === 'room') return COPY.noRoom;
    return otherTarget ? null : touch ? COPY.holdHintTouch : COPY.holdHint;
  }

  /** Puts the held thing where the ghost is; false when there's nowhere to. */
  place(): boolean {
    if (!this.result?.ok) return false;
    const m = this.props.place(this.result.placement);
    if (m) this.send(m);
    this.ghost.visible = false;
    return !!m;
  }

  /** A tap: put it down where the tap points. */
  placeAt(aim: Vector2): boolean {
    this.update(0, aim);
    return this.place();
  }

  startThrow(): void {
    if (this.holding && this.charge === null) this.charge = 0;
  }

  /** Throws along the view, harder the longer it was held. */
  releaseThrow(): void {
    if (this.charge === null) return;
    const strength = Math.min(1, this.charge / CONFIG.props.chargeTime);
    this.charge = null;
    const [slow, fast] = CONFIG.props.throwSpeed;
    const from = this.camera.getWorldPosition(new Vector3());
    const m = this.props.throw(from, this.camera.getWorldDirection(new Vector3()).multiplyScalar(slow + (fast - slow) * strength));
    if (m) this.send(m);
  }

  /** Lets go in front of the eye and below it, or at the eye where a wall is that close. */
  drop(): void {
    this.charge = null;
    const eye = this.camera.getWorldPosition(new Vector3());
    const ahead = new Vector3(-Math.sin(this.yaw()), 0, -Math.cos(this.yaw()));
    const at = eye.clone().addScaledVector(ahead, CONFIG.props.dropAhead).addScaledVector(UP, -CONFIG.props.dropBelow);
    const m = this.props.drop(this.probe.raycast(eye, at) ? eye : at);
    if (m) this.send(m);
  }

  /** Someone else took what this visitor held. */
  lost(): void {
    this.charge = null;
    this.noticeUntil = this.now() + CONFIG.props.noticeTime;
  }

  private yaw(): number {
    return yawOf(this.camera.getWorldQuaternion(camQ));
  }

  private find(held: Prop, aim: Vector2): PlaceResult | null {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(aim, this.camera);
    return findPlacement(this.ray.ray.origin, this.ray.ray.direction, this.yaw(), held.info.size, this.probe);
  }

  private makeGhost(held: Prop): void {
    this.ghost.clear();
    for (const part of held.info.parts(held.place.variant)) {
      const mesh = new Mesh(part.geometry, this.ghostMaterial);
      mesh.layers.set(CARRIED_LAYER);
      this.ghost.add(mesh);
    }
    this.ghost.layers.set(CARRIED_LAYER);
    this.ghostOf = held;
  }
}
