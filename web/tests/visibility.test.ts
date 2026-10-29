import { Group, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { RoomCulling, visibleRooms } from '../src/visibility';

const vis = { hall: { sala: [[]], quarto: [[2]], wc: [[1, 3], [4]] }, sala: { hall: [[]] } };

describe('visibleRooms', () => {
  it('sees itself, the open-plan rooms, and the rooms behind doors that are all open', () => {
    expect(visibleRooms(vis, 'hall', () => false)).toEqual(new Set(['hall', 'sala']));
    expect(visibleRooms(vis, 'hall', (d) => d === 2)).toEqual(new Set(['hall', 'sala', 'quarto']));
    expect(visibleRooms(vis, 'hall', (d) => d === 1)).toEqual(new Set(['hall', 'sala'])); // 3 is still shut
    expect(visibleRooms(vis, 'hall', (d) => d === 1 || d === 3)?.has('wc')).toBe(true);
    expect(visibleRooms(vis, 'hall', (d) => d === 4)?.has('wc')).toBe(true);
  });

  it('draws everything outside the rooms or without a table', () => {
    expect(visibleRooms(vis, null, () => true)).toBeNull();
    expect(visibleRooms(vis, 'varanda', () => true)).toBeNull();
    expect(visibleRooms({}, 'hall', () => true)).toBeNull();
  });
});

describe('RoomCulling', () => {
  const make = () => {
    const objs = { hall: new Object3D(), sala: new Object3D(), quarto: new Object3D(), door: new Object3D(), mug: new Group() };
    const culling = new RoomCulling(vis, [
      { object: objs.hall, rooms: ['hall'] }, { object: objs.sala, rooms: ['sala'] },
      { object: objs.quarto, rooms: ['quarto'] }, { object: objs.door, rooms: ['hall', 'quarto'] },
    ], [{ objects: [objs.mug], resting: () => true, locate: () => 'quarto' }]);
    return { objs, culling };
  };

  it('hides what the room can\'t see and gives it all back after', () => {
    const { objs, culling } = make();
    culling.apply('hall', () => false);
    expect([objs.hall.visible, objs.sala.visible, objs.quarto.visible, objs.door.visible, objs.mug.visible]).toEqual([true, true, false, true, false]);
    culling.show();
    expect([objs.quarto.visible, objs.mug.visible]).toEqual([true, true]);
  });

  it('leaves alone what something else hid', () => {
    const { objs, culling } = make();
    objs.sala.visible = false;
    culling.apply('sala', () => false);
    culling.show();
    expect(objs.sala.visible).toBe(false);
  });

  it('draws a mirror\'s view from its room, then the visitor\'s again', () => {
    const { objs, culling } = make();
    culling.apply('sala', () => false);
    expect(objs.quarto.visible).toBe(false);
    let during: boolean[] = [];
    culling.seenFrom('hall', () => { during = [objs.hall.visible, objs.quarto.visible]; });
    expect(during).toEqual([true, false]);
    expect(objs.quarto.visible).toBe(false);
    expect(objs.hall.visible).toBe(true);
    culling.show();
  });
});
