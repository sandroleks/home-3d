import { Box3, BoxGeometry, DoubleSide, FrontSide, Matrix4, type Mesh, type MeshMatcapMaterial, Object3D, Quaternion, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { PlacedProp } from '../src/prop-places';
import { CARRIED_LAYER, isPropMessage, type PropMessage, Props, type PropWorld } from '../src/props';
import { floor, planesRaycast } from './planes';

const matcaps = { matte: null, gloss: null };
const placed = (id: string, extra: Partial<PlacedProp> = {}): PlacedProp => ({
  id, kind: 'tumbler', variant: 0, node: null, front: 'Move_cupboard', position: new Vector3(0, 0.9, 0), quaternion: new Quaternion(), on: null, place: 'Test', ...extra,
});

function setup(places: PlacedProp[] = [placed('a/tumbler/0'), placed('a/tumbler/1', { position: new Vector3(0.2, 0.9, 0) })]) {
  const root = new Object3D();
  const drawer = new Object3D();
  drawer.name = 'Move_drawer';
  drawer.position.set(1, 0, 0);
  root.add(drawer);
  const floorMesh = new Object3D();
  root.add(floorMesh);
  const hands = new Map<string, Vector3>([['me', new Vector3(0, 1.4, 0)], ['ana', new Vector3(2, 1.4, 0)]]);
  const world: PropWorld = {
    root,
    node: (n) => (n === drawer.name ? drawer : null),
    drawerOf: (o) => (o === drawer ? drawer : null),
    raycast: planesRaycast([floor(0, undefined, floorMesh)]),
    light: () => 1,
    selfId: () => 'me',
    hand: (id, p, q) => {
      const h = hands.get(id);
      if (!h) return false;
      p.copy(h);
      q.identity();
      return true;
    },
  };
  const props = new Props(places, world, matcaps);
  return { props, world, root, drawer };
}
const world = (o: Object3D) => o.getWorldPosition(new Vector3());

describe('Props', () => {
  it('builds every object at home, in the room or its drawer', () => {
    const { props, drawer } = setup([placed('a/tumbler/0'), placed('d/fork/0', { kind: 'fork', node: 'Move_drawer', position: new Vector3(1.1, 0.8, 0) })]);
    expect(props.list).toHaveLength(2);
    expect(props.list[1].root.parent).toBe(drawer);
    expect(world(props.list[1].root).x).toBeCloseTo(1.1);
    drawer.position.x += 0.4; // the drawer opens: its things go with it
    expect(world(props.list[1].root).x).toBeCloseTo(1.5);
  });

  it('picks up one thing at a time and shows it in the hand', () => {
    const { props } = setup();
    const [a, b] = props.list;
    expect(props.pickUp(a)).toEqual({ id: 'a/tumbler/0', n: 1, by: 'me', s: 'held' });
    expect(props.held).toBe(a);
    expect(props.pickUp(b)).toBeNull();
    props.update(1 / 60);
    expect(world(a.root).y).toBeCloseTo(1.4);
    a.root.traverse((o) => expect(o.layers.isEnabled(CARRIED_LAYER)).toBe(true));
    a.root.traverse((o) => expect(o.layers.isEnabled(0)).toBe(false));
    props.place({ point: new Vector3(0.5, 0.9, 0), yaw: 0, node: null });
    a.root.traverse((o) => expect(o.layers.isEnabled(0)).toBe(true));
  });

  it('puts what is held back home, and holds a thing with a carry pose that way', () => {
    const { props } = setup();
    const [a] = props.list;
    a.info.carry = new Matrix4().makeTranslation(-0.3, 0, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    props.pickUp(a);
    props.update(1 / 60);
    expect(world(a.root).x).toBeCloseTo(-0.3);
    expect(new Vector3(0, 1, 0).applyQuaternion(a.root.getWorldQuaternion(new Quaternion())).x).toBeCloseTo(-1);
    expect(props.putBack()).toEqual({ id: 'a/tumbler/0', n: 2, by: 'me', s: 'home' });
    expect(props.held).toBeNull();
    expect(world(a.root).toArray()).toEqual([0, 0.9, 0]);
    expect(props.putBack()).toBeNull();
  });

  it('takes the top of a stack', () => {
    const { props } = setup([placed('p/plate/0', { kind: 'plate' }), placed('p/plate/1', { kind: 'plate', position: new Vector3(0, 0.92, 0), on: 'p/plate/0' })]);
    const [bottom, top] = props.list;
    expect(props.top(bottom)).toBe(top);
    expect(props.pickUp(bottom)?.id).toBe('p/plate/1');
    expect(props.top(bottom)).toBe(bottom);
  });

  it('lets one thing carry several: the highest first, the carrier last, and each goes back onto it', () => {
    const tray = placed('t/plate/0', { kind: 'plate' });
    const bottle = (i: number, y: number) => placed(`t/winebottle/${i}`, { kind: 'winebottle', position: new Vector3(0.05 * i, y, 0), on: tray.id });
    const { props } = setup([tray, bottle(0, 0.93), bottle(1, 0.95), bottle(2, 0.94)]);
    const [t, b0, b1, b2] = props.list;
    expect(t.over).toHaveLength(3);
    expect(props.top(t)).toBe(b1);
    const taken: string[] = [];
    for (let i = 0; i < 4; i++) {
      taken.push(props.pickUp(t)!.id);
      props.place({ point: new Vector3(0.5 + i, 0.9, -0.5), yaw: 0, node: null });
    }
    expect(taken.slice(0, 3).sort()).toEqual([b0.id, b1.id, b2.id]);
    expect(taken[3]).toBe(t.id);
    expect(props.pickUp(t)?.id).toBe(t.id); // bare now
  });

  it('links a bottle put back home onto its tray, once', () => {
    const tray = placed('t/plate/0', { kind: 'plate' });
    const bottle = (i: number) => placed(`t/winebottle/${i}`, { kind: 'winebottle', position: new Vector3(0.05 * i, 0.93, 0), on: tray.id });
    const { props } = setup([tray, bottle(0), bottle(1)]);
    const [t, b0, b1] = props.list;
    props.pickUp(b0);
    props.place({ point: new Vector3(0.5, 0.9, 0), yaw: 0, node: null });
    expect(t.over).toEqual([b1]);
    props.receive({ id: b0.id, n: 10, by: 'ana', s: 'home' });
    expect(t.over).toHaveLength(2);
    expect(t.over).toContain(b0);
    expect(b0.under).toBe(t);
    props.receive({ id: b0.id, n: 11, by: 'ana', s: 'home' });
    expect(t.over.filter((q) => q === b0)).toHaveLength(1);
  });

  it('builds a thing from the model with its own name, map and size, and picks it up and puts it down', () => {
    const map = new Texture();
    const info = { name: 'mug', size: [0.08, 0.1, 0.08] as [number, number, number], tips: false, parts: () => [{ geometry: new BoxGeometry(0.08, 0.1, 0.08), look: { colour: '#ff8800', map } }] };
    const { props } = setup([placed('m/model/0', { kind: 'model', info })]);
    const [mug] = props.list;
    expect(mug.info.name).toBe('mug');
    expect(((mug.root.children[0] as Mesh).material as MeshMatcapMaterial).map).toBe(map);
    expect(props.pickUp(mug)?.id).toBe(mug.id);
    expect(props.place({ point: new Vector3(0.5, 0.9, 0), yaw: 0, node: null })).toMatchObject({ s: 'rest' });
  });

  it('gives a prop the side of its look, front by default', () => {
    const thing = (side?: typeof DoubleSide) => ({ name: 'x', size: [0.1, 0.1, 0.1] as [number, number, number], tips: false, parts: () => [{ geometry: new BoxGeometry(0.1, 0.1, 0.1), look: { colour: '#ffffff', side } }] });
    const { props } = setup([placed('m/model/0', { kind: 'model', info: thing(DoubleSide) }), placed('m/model/1', { kind: 'model', info: thing() })]);
    const sideOf = (i: number) => ((props.list[i].root.children[0] as Mesh).material as MeshMatcapMaterial).side;
    expect(sideOf(0)).toBe(DoubleSide);
    expect(sideOf(1)).toBe(FrontSide);
  });

  it('lights a model thing at home fully, but a drawer thing at home dimmed', () => {
    const white = { name: 'mug', size: [0.08, 0.1, 0.08] as [number, number, number], tips: false, parts: () => [{ geometry: new BoxGeometry(0.08, 0.1, 0.08), look: { colour: '#ffffff' } }] };
    const { props } = setup([placed('m/model/0', { kind: 'model', info: white, front: '' }), placed('d/model/0', { kind: 'model', info: white })]);
    props.update(1 / 60);
    const red = (i: number) => ((props.list[i].root.children[0] as Mesh).material as MeshMatcapMaterial).color.r;
    expect(red(0)).toBeCloseTo(1);
    expect(red(1)).toBeCloseTo(CONFIG.props.insideLight);
  });

  it('says which thing has no model info when a model place lacks it', () => {
    expect(() => setup([placed('m/model/9', { kind: 'model' })])).toThrow('m/model/9');
  });

  it('puts a thing down in the room or in a drawer, relative to it', () => {
    const { props, drawer } = setup();
    const [a, b] = props.list;
    props.pickUp(a);
    const m = props.place({ point: new Vector3(0.5, 0.9, -0.5), yaw: 0, node: null }) as Extract<PropMessage, { s: 'rest' }>;
    expect(m).toMatchObject({ id: a.id, n: 2, s: 'rest', parent: null });
    expect(m.p.map((v) => +v.toFixed(4))).toEqual([0.5, 0.9, -0.5]);
    expect(props.held).toBeNull();
    expect(a.atHome).toBe(false);
    props.pickUp(b);
    const inDrawer = props.place({ point: new Vector3(1.1, 0.8, 0), yaw: 0, node: drawer }) as Extract<PropMessage, { s: 'rest' }>;
    expect(inDrawer.parent).toBe('Move_drawer');
    expect(inDrawer.p[0]).toBeCloseTo(0.1);
    expect(b.root.parent).toBe(drawer);
  });

  it('throws a thing, and tells the others where it came to rest', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a);
    const m = props.throw(new Vector3(0, 1.2, 0), new Vector3(2, 0, 0)); // soft enough to land upright
    expect(m).toMatchObject({ id: a.id, n: 2, s: 'fly', v: [2, 0, 0] });
    let rest: PropMessage[] = [];
    for (let i = 0; i < 600 && !rest.length; i++) rest = props.update(1 / 60);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ id: a.id, n: 3, by: 'me', s: 'rest', parent: null });
    expect(world(a.root).y).toBeCloseTo(0, 2);
    expect(world(a.root).x).toBeGreaterThan(0.5);
  });

  it('drops a thing at its feet, upright', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a);
    props.drop(new Vector3(0, 1, -0.3));
    for (let i = 0; i < 300; i++) props.update(1 / 60);
    expect(world(a.root).y).toBeCloseTo(0, 2);
    expect(new Vector3(0, 1, 0).applyQuaternion(a.root.getWorldQuaternion(new Quaternion())).y).toBeCloseTo(1);
  });

  it('takes the newer change, and on a tie the lower id', () => {
    const { props } = setup();
    const [a] = props.list;
    expect(props.receive({ id: a.id, n: 1, by: 'zed', s: 'held' })).toBe(true);
    expect(a.holder).toBe('zed');
    expect(props.receive({ id: a.id, n: 1, by: 'ana', s: 'held' })).toBe(true); // same count, lower id
    expect(a.holder).toBe('ana');
    expect(props.receive({ id: a.id, n: 1, by: 'zed', s: 'held' })).toBe(false);
    expect(props.receive({ id: a.id, n: 0, by: 'ana', s: 'home' })).toBe(false);
    expect(props.receive({ id: 'nope', n: 9, by: 'ana', s: 'home' })).toBe(false);
  });

  it('loses a thing to someone who took it at the same moment', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a); // n 1 by me
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'held' }); // 'ana' < 'me'
    expect(props.held).toBeNull();
    expect(a.holder).toBe('ana');
  });

  it('runs a flight another visitor threw, and moves it where they say it landed', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'fly', p: [0, 1.2, 0], v: [1, 0, 0], w: [0, 0, 0] });
    let sent: PropMessage[] = [];
    for (let i = 0; i < 600; i++) sent = sent.concat(props.update(1 / 60));
    expect(sent).toEqual([]); // ana tells where it landed, not this visitor
    expect(world(a.root).y).toBeCloseTo(0, 2);
    props.receive({ id: a.id, n: 2, by: 'ana', s: 'rest', parent: null, p: [0.7, 0, 0.1], q: [0, 0, 0, 1] });
    expect(world(a.root).toArray().map((v) => +v.toFixed(3))).toEqual([0.7, 0, 0.1]);
  });

  it('shows a thing at home when its resting place is not in this layout', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'rest', parent: 'Move_island', p: [0, 0, 0], q: [0, 0, 0, 1] });
    expect(a.atHome).toBe(true);
    props.receive({ id: a.id, n: 2, by: 'ana', s: 'rest', parent: null, p: [3, 0.9, 0], q: [0, 0, 0, 1] }); // nothing under it here
    expect(a.atHome).toBe(true);
    expect(a.n).toBe(2);
  });

  it('drops what a leaving visitor held where they were', () => {
    const { props } = setup();
    const [a, b] = props.list;
    props.receive({ id: a.id, n: 4, by: 'ana', s: 'held' });
    props.leave('ana', new Vector3(2, 1, 0));
    expect(a.state).toBe('rest');
    expect(a.n).toBe(5);
    expect(world(a.root).toArray().map((v) => +v.toFixed(3))).toEqual([2, 0, 0]);
    props.receive({ id: b.id, n: 1, by: 'bo', s: 'held' });
    props.leave('bo', null);
    expect(b.atHome).toBe(true);
  });

  it('sends a newcomer everything away from home', () => {
    const { props } = setup();
    const [a, b] = props.list;
    expect(props.messages()).toEqual([]);
    props.pickUp(a);
    props.receive({ id: b.id, n: 1, by: 'ana', s: 'rest', parent: null, p: [0.5, 0, 0], q: [0, 0, 0, 1] });
    expect(props.messages().map((m) => [m.id, m.s])).toEqual([[a.id, 'held'], [b.id, 'rest']]);
  });

  it('sends a newcomer what went home after changes, so its counts match', () => {
    const { props } = setup();
    const [a] = props.list;
    const home: PropMessage = { id: a.id, n: 3, by: 'ana', s: 'home' };
    props.receive(home);
    expect(a.atHome).toBe(true);
    expect(props.messages()).toEqual([home]);
    const fresh = setup();
    for (const m of props.messages()) fresh.props.receive(m);
    expect(fresh.props.list[0].n).toBe(3);
    expect(fresh.props.pickUp(fresh.props.list[0])?.n).toBe(4); // taken everywhere, not rejected as stale
  });

  it('relays a rest into a drawer this layout has not, unchanged, to a newcomer whose layout has it', () => {
    const { props, world: w } = setup();
    w.node = () => null; // the other kitchen: no such drawer here
    const [, b] = props.list;
    const rest: PropMessage = { id: b.id, n: 2, by: 'ana', s: 'rest', parent: 'Move_drawer', p: [0.1, 0.8, 0], q: [0, 0, 0, 1] };
    props.receive(rest);
    expect(b.atHome).toBe(true);
    expect(props.messages()).toEqual([rest]);
    const fresh = setup();
    for (const m of props.messages()) fresh.props.receive(m);
    const fb = fresh.props.list[1];
    expect(fb.n).toBe(2);
    expect(fb.root.parent).toBe(fresh.drawer);
    expect(fb.atHome).toBe(false);
  });

  it('sends a newcomer its own changes, a flight in progress as it is now', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a);
    props.throw(new Vector3(0, 1.2, 0), new Vector3(1, 0, 0));
    props.update(0.1);
    const [m] = props.messages() as Extract<PropMessage, { s: 'fly' }>[];
    expect(m).toMatchObject({ id: a.id, n: 2, s: 'fly' });
    expect(m.p[0]).toBeGreaterThan(0.05); // where it is now, not where it left the hand
    for (let i = 0; i < 600; i++) props.update(1 / 60);
    expect(props.messages()).toMatchObject([{ id: a.id, n: 3, s: 'rest' }]);
  });

  it('lets the drop of a timed-out holder win over its own late change', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 4, by: 'ana', s: 'held' });
    props.leave('ana', new Vector3(2, 1, 0));
    expect(a.n).toBe(5);
    expect(props.receive({ id: a.id, n: 5, by: 'ana', s: 'rest', parent: null, p: [0.5, 0, 0], q: [0, 0, 0, 1] })).toBe(false);
    expect(props.messages()).toMatchObject([{ id: a.id, n: 5, by: '', s: 'rest' }]);
    // the holder's own tab ('me' here), back from the background: its late put-down loses to the drop, which it takes
    const back = setup();
    const [ba] = back.props.list;
    back.props.receive({ id: ba.id, n: 4, by: 'me', s: 'held' });
    const late = back.props.place({ point: new Vector3(0.5, 0.9, 0), yaw: 0, node: null })!;
    const others = setup();
    others.props.receive({ id: a.id, n: 4, by: 'me', s: 'held' });
    others.props.leave('me', new Vector3(2, 1, 0));
    expect(others.props.receive(late)).toBe(false);
    expect(back.props.receive(others.props.messages()[0])).toBe(true);
    expect(world(ba.root).x).toBeCloseTo(2);
  });

  it('re-keys what was taken before joining finished to the id joining gave', () => {
    const { props } = setup();
    const [a, b] = props.list;
    props.receive({ id: b.id, n: 1, by: 'self', s: 'rest', parent: null, p: [0.5, 0, 0], q: [0, 0, 0, 1] });
    props.receive({ id: a.id, n: 1, by: 'self', s: 'held' });
    props.rename('self', 'p9');
    expect(a.holder).toBe('p9');
    expect(a.by).toBe('p9');
    expect(b.by).toBe('p9');
    expect(props.messages()).toMatchObject([{ id: a.id, by: 'p9', s: 'held' }, { id: b.id, by: 'p9', s: 'rest' }]);
  });

  it('refuses a count far ahead of the one it has', () => {
    const { props } = setup();
    const [a] = props.list;
    expect(props.receive({ id: a.id, n: 1001, by: 'ana', s: 'held' })).toBe(false);
    expect(props.receive({ id: a.id, n: 1000, by: 'ana', s: 'held' })).toBe(true);
  });

  it('sends home what falls out of the flat', () => {
    const { props, world: w } = setup();
    w.raycast = () => null;
    const [a] = props.list;
    props.pickUp(a);
    props.throw(new Vector3(0, 1.5, 0), new Vector3(1, 0, 0));
    let sent: PropMessage[] = [];
    for (let i = 0; i < 600 && !sent.length; i++) sent = props.update(1 / 60);
    expect(sent[0]).toMatchObject({ id: a.id, s: 'home', n: 3 });
    expect(a.atHome).toBe(true);
  });

  it('finds what is in the way of a new place', () => {
    const { props } = setup();
    expect(props.overlaps(new Box3(new Vector3(-0.05, 0.9, -0.05), new Vector3(0.05, 1, 0.05)))).toBe(true);
    expect(props.overlaps(new Box3(new Vector3(-0.05, 2, -0.05), new Vector3(0.05, 2.1, 0.05)))).toBe(false);
  });

  it('keeps a tipped thing lying on the floor where another visitor put it', () => {
    const { props } = setup([placed('m/mug/0', { kind: 'mug' })]);
    const [m] = props.list;
    const s = Math.SQRT1_2;
    props.receive({ id: m.id, n: 1, by: 'ana', s: 'rest', parent: null, p: [0.5, 0.045, 0], q: [s, 0, 0, s] });
    expect(m.atHome).toBe(false);
  });

  it('lays a mug that lands hard on its side, on the floor', () => {
    const { props } = setup([placed('m/mug/0', { kind: 'mug' })]);
    const [m] = props.list;
    props.pickUp(m);
    props.drop(new Vector3(0, 3, 0));
    for (let i = 0; i < 600; i++) props.update(1 / 60);
    expect(m.state).toBe('rest');
    expect(new Box3().setFromObject(m.root).min.y).toBeCloseTo(0, 2);
    expect(Math.abs(new Box3().setFromObject(m.root).min.y)).toBeLessThan(0.005);
  });

  it('sends home what lands in an open drawer too low for it, and keeps what fits', () => {
    const fall = (kind: 'tumbler' | 'mug', height: number, from = 1) => {
      const { props, world: w, drawer } = setup([placed('x/0', { kind })]);
      w.raycast = planesRaycast([floor(0, undefined, drawer)]); // the floor is the drawer's
      w.drawerHeight = (node) => (node === drawer ? height : null);
      const [p] = props.list;
      props.pickUp(p);
      props.drop(new Vector3(0, from, 0));
      let sent: PropMessage[] = [];
      for (let i = 0; i < 600 && !sent.length; i++) sent = props.update(1 / 60);
      return { p, sent, drawer };
    };
    const low = fall('tumbler', 0.05);
    expect(low.sent[0]).toMatchObject({ s: 'home', n: 3 });
    expect(low.p.atHome).toBe(true);
    const tall = fall('tumbler', 0.2);
    expect(tall.sent[0]).toMatchObject({ s: 'rest', parent: 'Move_drawer' });
    expect(tall.p.root.parent).toBe(tall.drawer);
    const tipped = fall('mug', 0.092, 3); // lands on its side: 0.09 high, not 0.095
    expect(tipped.sent[0]).toMatchObject({ s: 'rest', parent: 'Move_drawer' });
  });

  it('hides what rests behind a shut front, and never what is held or flying', () => {
    const { props } = setup([
      placed('d/fork/0', { kind: 'fork', node: 'Move_drawer', front: 'Move_drawer', position: new Vector3(1.1, 0.8, 0) }),
      placed('c/tumbler/0'), // at home in a cupboard: in the room, behind its door
      placed('c/tumbler/1', { position: new Vector3(0.2, 0.9, 0) }),
      placed('c/tumbler/2', { position: new Vector3(0.4, 0.9, 0) }),
    ]);
    const [inDrawer, inCupboard, out, held] = props.list;
    props.receive({ id: out.id, n: 1, by: 'ana', s: 'rest', parent: null, p: [0.5, 0, 0], q: [0, 0, 0, 1] }); // out in the room
    props.pickUp(held);
    props.update(1 / 60);
    const asked: string[] = [];
    props.hideShut((node) => { asked.push(node); return true; });
    expect([inDrawer, inCupboard, out, held].map((p) => p.root.visible)).toEqual([false, false, true, true]);
    expect(asked.sort()).toEqual(['Move_cupboard', 'Move_drawer']);
    props.hideShut((node) => node !== 'Move_drawer'); // the drawer opens a little
    expect([inDrawer, inCupboard, out, held].map((p) => p.root.visible)).toEqual([true, false, true, true]);
    props.hideShut(() => false);
    expect(inCupboard.root.visible).toBe(true);
    props.throw(new Vector3(0, 1.2, 0), new Vector3(1, 0, 0));
    props.hideShut(() => true);
    expect(held.state).toBe('fly');
    expect(held.root.visible).toBe(true);
  });

  it('unlinks a stack when its top leaves and its bottom is taken', () => {
    const { props } = setup([placed('p/plate/0', { kind: 'plate' }), placed('p/plate/1', { kind: 'plate', position: new Vector3(0, 0.92, 0), on: 'p/plate/0' })]);
    const [bottom, top] = props.list;
    props.receive({ id: top.id, n: 1, by: 'ana', s: 'rest', parent: 'Move_island', p: [0, 0, 0], q: [0, 0, 0, 1] });
    expect(top.atHome).toBe(true);
    props.receive({ id: bottom.id, n: 1, by: 'ana', s: 'held' });
    props.receive({ id: bottom.id, n: 2, by: 'ana', s: 'rest', parent: null, p: [0.5, 0, 0], q: [0, 0, 0, 1] });
    expect(props.top(bottom)).toBe(bottom);
    expect(props.pickUp(bottom)?.id).toBe(bottom.id);
  });

  it('shows a thing thrown by someone whose hand was not known', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 1, by: 'zed', s: 'held' });
    props.update(1 / 60);
    expect(a.root.visible).toBe(false);
    props.receive({ id: a.id, n: 2, by: 'zed', s: 'fly', p: [0, 1.2, 0], v: [1, 0, 0], w: [0, 0, 0] });
    props.update(1 / 60);
    expect(a.root.visible).toBe(true);
  });

  it('slows a received throw that is faster than a real one can be', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'fly', p: [0, 1.2, 0], v: [100, 0, 0], w: [0, 1000, 0] });
    expect(a.flight!.velocity.length()).toBeLessThanOrEqual(CONFIG.props.throwSpeed[1] * CONFIG.props.maxSpeedFactor + 1e-9);
    expect(a.flight!.spin.length()).toBeLessThanOrEqual(CONFIG.props.throwSpin * CONFIG.props.maxSpeedFactor + 1e-9);
  });

  it('checks messages from the network', () => {
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'held' })).toBe(true);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'rest', parent: null, p: [0, 0, 0], q: [0, 0, 0, 1] })).toBe(true);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'fly', p: [0, 0, 0], v: [0, 0], w: [0, 0, 0] })).toBe(false);
    expect(isPropMessage({ id: 'a', n: -1, by: 'x', s: 'home' })).toBe(false);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'rest', parent: 3, p: [0, 0, 0], q: [0, 0, 0, 1] })).toBe(false);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'fly', p: [0, NaN, 0], v: [0, 0, 0], w: [0, 0, 0] })).toBe(false);
  });
});
