import { Box3, type BufferGeometry, Matrix4, Mesh, MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from 'three';
import type { PropInfo } from './manifest';
import type { KindInfo, Look, Part } from './prop-models';
import { type PlacedProp, slug } from './prop-places';

/** A thing more than this many times taller than it is wide lies along its length when set down. */
export const LIE_RATIO = 4;
/** How far above another's base (or top) a thing's base may be and still rest on it (m). */
export const SUPPORT_SLACK = 0.01;

const NODE_PREFIX = 'Prop_';

function lookOf(material: unknown): Look {
  const m = material as MeshStandardMaterial;
  return {
    colour: '#' + m.color.getHexString(),
    gloss: m.roughness < 0.5,
    opacity: m.transparent ? m.opacity : undefined,
    map: m.map,
  };
}

/** A kind built from a model node: the prompt name, size and tips from the manifest, its meshes' geometry (in the
 * node's space, origin at the middle of its base) with each material's colour, texture and opacity. Something more
 * than LIE_RATIO times taller than it is wide lies along its length when set down: `rest` is the turn from how it's
 * modelled to how it lies (identity otherwise), and `size` is lying. */
export function modelKind(node: Object3D, info: PropInfo): { kind: KindInfo; rest: Matrix4 } {
  node.updateWorldMatrix(true, true);
  const toNode = node.matrixWorld.clone().invert();
  const parts: Part[] = [];
  node.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geometry: BufferGeometry = o.geometry.clone().applyMatrix4(toNode.clone().multiply(o.matrixWorld));
    const mats: unknown[] = Array.isArray(o.material) ? o.material : [o.material];
    parts.push({ geometry, look: lookOf(mats[0]) });
  });
  const boxOf = () => parts.reduce((b, p) => b.union(p.geometry.boundingBox ?? (p.geometry.computeBoundingBox(), p.geometry.boundingBox!)), new Box3());
  const rest = new Matrix4();
  let size = info.size;
  let tips = info.tips;
  const [w, h, l] = info.size;
  if (h > LIE_RATIO * Math.max(w, l)) {
    rest.makeRotationX(-Math.PI / 2);
    for (const p of parts) p.geometry.applyMatrix4(rest).computeBoundingBox();
    const b = boxOf();
    const lay = new Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    for (const p of parts) p.geometry.applyMatrix4(lay).computeBoundingBox();
    rest.premultiply(lay);
    const s = boxOf().getSize(new Vector3());
    size = [s.x, s.y, s.z];
    tips = false;
  } else for (const p of parts) p.geometry.computeBoundingBox();
  return { kind: { name: info.name, size, tips, parts: () => parts }, rest };
}

/** For each box (world space, at home), the box it lies on, if any: a box whose base is between just above another's
 * base and just above its top (SUPPORT_SLACK), with its footprint's middle over that one's footprint; the highest such
 * one when several qualify. */
export function supportsOf(boxes: { id: string; box: Box3 }[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const a of boxes) {
    const cx = (a.box.min.x + a.box.max.x) / 2;
    const cz = (a.box.min.z + a.box.max.z) / 2;
    let best: { id: string; base: number } | null = null;
    for (const b of boxes) {
      if (b === a) continue;
      const base = a.box.min.y;
      if (base <= b.box.min.y + SUPPORT_SLACK || base > b.box.max.y + SUPPORT_SLACK) continue;
      if (cx < b.box.min.x || cx > b.box.max.x || cz < b.box.min.z || cz > b.box.max.z) continue;
      if (!best || b.box.min.y > best.base) best = { id: b.id, base: b.box.min.y };
    }
    out.set(a.id, best?.id ?? null);
  }
  return out;
}

/** Every model thing of a layout as a placed prop at home: its node leaves `root`; id `surface/<slug>`. */
export function surfacePlaces(props: PropInfo[], root: Object3D): PlacedProp[] {
  root.updateMatrixWorld(true);
  const found = props.flatMap((info) => {
    const node = root.getObjectByName(info.node);
    if (!node) return [];
    const { kind, rest } = modelKind(node, info);
    const home = node.matrixWorld.clone().multiply(rest.clone().invert());
    const box = new Box3();
    for (const p of kind.parts(0)) box.union(p.geometry.boundingBox!.clone().applyMatrix4(home));
    node.removeFromParent();
    return [{ id: 'surface/' + slug(info.node.replace(NODE_PREFIX, '')), info, node, kind, home, box }];
  });
  const on = supportsOf(found.map((f) => ({ id: f.id, box: f.box })));
  return found.map((f): PlacedProp => {
    const position = new Vector3();
    const quaternion = new Quaternion();
    f.home.decompose(position, quaternion, new Vector3());
    return { id: f.id, kind: 'model', variant: 0, node: null, front: '', position, quaternion, on: on.get(f.id) ?? null, place: f.node.name, info: f.kind };
  });
}
