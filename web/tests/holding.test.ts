import { Object3D, PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Holding } from '../src/holding';
import type { PropMessage } from '../src/props';
import { Props } from '../src/props';
import { COPY } from '../src/ui';
import { floor, planesRaycast, wallX } from './planes';

function setup(planes = [floor(0.9)]) {
  const root = new Object3D();
  const camera = new PerspectiveCamera(70, 1, 0.05, 60);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 0.9, -0.7);
  camera.updateMatrixWorld();
  const raycast = planesRaycast(planes);
  const sent: PropMessage[] = [];
  let holding!: Holding;
  const props = new Props([{ id: 'a/tumbler/0', kind: 'tumbler', variant: 0, node: null, position: new Vector3(5, 0.9, 5), quaternion: new Quaternion(), on: null, place: 'A' }], {
    root, node: () => null, drawerOf: () => null, raycast, light: () => 1, selfId: () => 'me',
    hand: (id, p, q) => (id === 'me' ? (holding.hand(p, q), true) : false),
  }, { matte: null, gloss: null });
  let t = 0;
  holding = new Holding(props, camera, { raycast, overlaps: (b) => props.overlaps(b), drawerOf: () => null }, (m) => void sent.push(m), () => t);
  return { props, holding, sent, camera, tick: (s: number) => { t += s; holding.update(s); } };
}

describe('Holding', () => {
  it('says nothing while the hand is empty', () => {
    const { holding } = setup();
    holding.update(0);
    expect(holding.prompt('Click', false, false)).toBeNull();
  });

  it('shows where a held thing would go, and puts it there', () => {
    const { props, holding, sent } = setup();
    sent.push(props.pickUp(props.list[0])!);
    holding.update(0);
    expect(holding.ghost.visible).toBe(true);
    expect(holding.ghost.position.y).toBeCloseTo(0.9);
    expect(holding.prompt('Click', false, false)).toBe('Click: put down glass');
    expect(holding.place()).toBe(true);
    expect(sent.at(-1)).toMatchObject({ s: 'rest' });
    expect(holding.holding).toBe(false);
  });

  it('hints at throwing where there is nowhere to put it, unless something else is under the crosshair', () => {
    const { props, holding } = setup([wallX(-0.5)]);
    props.pickUp(props.list[0]);
    holding.update(0);
    expect(holding.ghost.visible).toBe(false);
    expect(holding.prompt('Click', false, false)).toBe(COPY.holdHint);
    expect(holding.prompt('Tap', true, false)).toBe(COPY.holdHintTouch);
    expect(holding.prompt('Click', false, true)).toBeNull(); // a door or drawer front: its own prompt
    expect(holding.place()).toBe(false);
  });

  it('throws harder the longer it is held, up to full strength', () => {
    const speed = (seconds: number) => {
      const { props, holding, sent, tick } = setup();
      props.pickUp(props.list[0]);
      holding.startThrow();
      tick(seconds);
      holding.releaseThrow();
      const m = sent.at(-1) as Extract<PropMessage, { s: 'fly' }>;
      return new Vector3(...m.v).length();
    };
    const [slow, fast] = CONFIG.props.throwSpeed;
    expect(speed(0)).toBeCloseTo(slow);
    expect(speed(CONFIG.props.chargeTime / 2)).toBeCloseTo((slow + fast) / 2);
    expect(speed(5)).toBeCloseTo(fast);
  });

  it('drops in front of the eye, below it', () => {
    const { props, holding, sent, camera } = setup();
    props.pickUp(props.list[0]);
    holding.drop();
    const m = sent.at(-1) as Extract<PropMessage, { s: 'fly' }>;
    expect(m.v).toEqual([0, 0, 0]);
    expect(m.p[1]).toBeCloseTo(camera.position.y - CONFIG.props.dropBelow);
  });

  it('says so for a while when someone else took it', () => {
    const { holding, tick } = setup();
    holding.lost();
    expect(holding.prompt('Click', false, false)).toBe(COPY.taken);
    tick(CONFIG.props.noticeTime + 0.1);
    expect(holding.prompt('Click', false, false)).toBeNull();
  });

  it('puts it down where a tap says', () => {
    const { props, holding } = setup();
    props.pickUp(props.list[0]);
    expect(holding.placeAt(new Vector2(0, 0))).toBe(true);
  });
});
