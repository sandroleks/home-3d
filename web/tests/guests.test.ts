import { describe, expect, it } from 'vitest';
import { guestList, type GuestListInput } from '../src/guests';
import { colourFor } from '../src/presence';

const input = (over: Partial<GuestListInput> = {}): GuestListInput => ({
  self: { id: 'me', name: 'Ana', arrived: 1000 },
  people: [
    { id: 'late', name: 'Zé', arrived: 3000 },
    { id: 'new', name: 'Guest', arrived: null },
    { id: 'early', name: 'Rui', arrived: 500 },
  ],
  host: 'early',
  roomOf: (id) => ({ me: 'Sala', early: 'Cozinha' } as Record<string, string>)[id] ?? null,
  talking: (id) => id === 'late',
  ...over,
});

describe('guestList', () => {
  it('lists everyone in arrival order, those without a hello last', () => {
    expect(guestList(input()).map((r) => r.id)).toEqual(['early', 'me', 'late', 'new']);
  });
  it('crowns the host and marks you', () => {
    const rows = guestList(input());
    expect(rows.filter((r) => r.host).map((r) => r.id)).toEqual(['early']);
    expect(rows.filter((r) => r.you).map((r) => r.id)).toEqual(['me']);
    expect(rows.find((r) => r.id === 'me')?.name).toBe('Ana');
  });
  it('gives each their colour, room and talking mark', () => {
    const rows = guestList(input());
    expect(rows.find((r) => r.id === 'late')).toEqual({
      id: 'late', name: 'Zé', colour: colourFor('late'), you: false, host: false, room: null, talking: true,
    });
    expect(rows.find((r) => r.id === 'early')?.room).toBe('Cozinha');
    expect(rows.find((r) => r.id === 'me')?.room).toBe('Sala');
  });
  it('alone: only you, without a crown', () => {
    const rows = guestList(input({ people: [], host: 'me' }));
    expect(rows).toEqual([{ id: 'me', name: 'Ana', colour: colourFor('me'), you: true, host: false, room: 'Sala', talking: false }]);
  });
});
