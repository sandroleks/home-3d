import { byArrival, colourFor } from './presence';

/** One line of the guest list. */
export interface GuestRow {
  id: string;
  name: string;
  /** Their animal's colour. */
  colour: string;
  you: boolean;
  host: boolean;
  /** The room's display name; null outside every room. */
  room: string | null;
  talking: boolean;
}

export interface GuestListInput {
  self: { id: string; name: string; arrived: number; since: number };
  /** The others, as `Multiplayer.people` lists them. */
  people: { id: string; name: string; arrived: number | null; since: number | null }[];
  /** The host's peer id (`Multiplayer.host`). */
  host: string;
  roomOf: (id: string) => string | null;
  talking: (id: string) => boolean;
}

/** Everyone here in arrival order, so the host comes first. Alone there's no one to host, so no crown. */
export function guestList({ self, people, host, roomOf, talking }: GuestListInput): GuestRow[] {
  const alone = people.length === 0;
  return [self, ...people].sort(byArrival).map((p) => ({
    id: p.id,
    name: p.name,
    colour: colourFor(p.id),
    you: p.id === self.id,
    host: !alone && p.id === host,
    room: roomOf(p.id),
    talking: talking(p.id),
  }));
}
