import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { Collision } from '../src/collision';
import { Player } from '../src/player';
import { eyeOf, freeSpot, parseSeats, type Seat, seatAt, seatedOn, seatingCode, standPoint } from '../src/seats';

const cfg = { sitEye: 0.7, lieEye: 0.2, sitBack: 0.1, lieBack: 0.4, liePitch: 0.9, transition: 0.5, standStep: 0.6, takenRadius: 0.3 };

/** A two-seat sofa cushion facing +x (yaw -π/2), its spots 0.6 m apart along z. */
const sofa: Seat = {
  name: 'Corner sofa seat long 1', pose: 'sit', min: [0.5, 0.3, 6.3], max: [1.3, 0.47, 7.5],
  spots: [{ at: [0.9, 0.47, 6.6], yaw: -Math.PI / 2 }, { at: [0.9, 0.47, 7.2], yaw: -Math.PI / 2 }],
};

describe('parseSeats', () => {
  it('reads seats.json and leaves out anything malformed', () => {
    const seats = parseSeats({
      version: 1,
      seats: [sofa, { name: 'x', pose: 'stand', min: [0, 0, 0], max: [1, 1, 1], spots: [] }, { name: 'y', pose: 'sit', min: [0, 0], max: [1, 1, 1], spots: [] },
        { ...sofa, name: 'no spots', spots: [{ at: [0, 0], yaw: 0 }] }],
    });
    expect(seats.map((s) => s.name)).toEqual(['Corner sofa seat long 1']);
    expect(parseSeats(null)).toEqual([]);
    expect(parseSeats({ seats: 'no' })).toEqual([]);
  });
});

describe('seats', () => {
  it('finds the seat under a point, with a little margin', () => {
    expect(seatAt([sofa], 0.9, 0.47, 7)).toBe(sofa);
    expect(seatAt([sofa], 0.9, 0.5, 7)).toBe(sofa);
    expect(seatAt([sofa], 0.9, 0.6, 7)).toBe(sofa); // a throw or duvet on top
    expect(seatAt([sofa], 0.9, 0.7, 7)).toBeNull();
    expect(seatAt([sofa], 2, 0.47, 7)).toBeNull();
  });

  it('picks the free spot nearest where it was clicked', () => {
    expect(freeSpot(sofa, 0.9, 7.4, () => false)).toBe(sofa.spots[1]);
    expect(freeSpot(sofa, 0.9, 7.4, (_x, z) => z > 7)).toBe(sofa.spots[0]);
    expect(freeSpot(sofa, 0.9, 7.4, () => true)).toBeNull();
  });

  it('puts the eyes above the seat and back from its middle, lower and further back lying down', () => {
    const s = seatedOn(sofa.spots[0], 'sit');
    const [x, y, z] = eyeOf(s, cfg);
    expect(x).toBeCloseTo(0.8); // facing +x, so the back is toward -x
    expect(y).toBeCloseTo(1.17);
    expect(z).toBeCloseTo(6.6);
    const [lx, ly] = eyeOf({ ...s, posture: 'lie' }, cfg);
    expect(lx).toBeCloseTo(0.5);
    expect(ly).toBeCloseTo(0.67);
  });

  it('stands up a step in front of a seat, and where it sat on the floor', () => {
    const [x, z] = standPoint(seatedOn(sofa.spots[0], 'sit'), 0.6);
    expect(x).toBeCloseTo(1.5);
    expect(z).toBeCloseTo(6.6);
    expect(standPoint({ posture: 'sit', x: 2, y: 0, z: 3, yaw: 1 }, 0.6)).toEqual([2, 3]);
  });

  it('shares sitting as 1 and lying as 2, with the height and facing', () => {
    expect(seatingCode(null)).toBeNull();
    expect(seatingCode(seatedOn(sofa.spots[0], 'sit'))).toEqual([1, 0.47, -Math.PI / 2]);
    expect(seatingCode({ posture: 'lie', x: 0, y: 0.53, z: 0, yaw: 0 })?.[0]).toBe(2);
  });
});

describe('Player sitting', () => {
  const free: Collision = { move: (x: number, z: number, dx: number, dz: number) => [x + dx, z + dz], nearestFree: (x: number, z: number) => [x, z] } as unknown as Collision;
  const make = () => {
    const camera = new PerspectiveCamera();
    const p = new Player(camera, free, { x: 2, z: 7, yaw: 0 }, 1.6);
    p.update(0);
    return { p, camera };
  };

  it('eases the camera down onto the seat, turned the way it faces', () => {
    const { p, camera } = make();
    p.sit(seatedOn(sofa.spots[0], 'sit'));
    expect(p.yaw).toBeCloseTo(-Math.PI / 2);
    expect([p.x, p.z]).toEqual([0.9, 6.6]);
    p.update(0.1);
    expect(camera.position.y).toBeLessThan(1.6);
    expect(camera.position.y).toBeGreaterThan(1.2);
    for (let i = 0; i < 20; i++) p.update(0.05);
    expect(camera.position.y).toBeCloseTo(0.47 + 0.72);
  });

  it('looks up from the bed', () => {
    const { p } = make();
    p.sit({ posture: 'lie', x: -1.9, y: 0.53, z: -7.3, yaw: -Math.PI / 2 });
    expect(p.pitch).toBeGreaterThan(0.3);
  });

  it("keeps looking where it was sitting on the floor", () => {
    const { p } = make();
    p.yaw = 1;
    p.sit({ posture: 'sit', x: p.x, y: 0, z: p.z, yaw: p.yaw }, false);
    expect(p.yaw).toBe(1);
  });

  it('stands up when it moves, but not on keys still held from walking up to the seat', () => {
    const { p } = make();
    p.keys.forward = true;
    p.sit(seatedOn(sofa.spots[0], 'sit'));
    p.update(0.05);
    expect(p.seat).not.toBeNull();
    p.keys.forward = false;
    p.update(0.05);
    expect(p.seat).not.toBeNull();
    p.keys.left = true;
    p.update(0.05);
    expect(p.seat).toBeNull();
    expect(p.x).toBeGreaterThan(1.4); // in front of the sofa, then a step of walking
  });

  it('stands up from the stick too, and teleporting gets up', () => {
    const { p } = make();
    p.sit(seatedOn(sofa.spots[0], 'sit'));
    p.stick = { forward: 0.5, right: 0, run: false };
    p.update(0.05);
    expect(p.seat).toBeNull();
    p.sit(seatedOn(sofa.spots[0], 'sit'));
    p.teleport(0, 0, 0, 0);
    expect(p.seat).toBeNull();
  });
});
