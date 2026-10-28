# Party Host and Guest List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The visitor who arrived first in a room is its host, and a "Who's here" panel (G, the "With …" line, or a touch button) lists everyone with their colour, crown, room and talking mark.

**Architecture:** Every browser works out the host alone from an arrival time each visitor sends in the hello it already sends. The arrival time is kept per room in `sessionStorage` so a reload keeps it; the existing `since` keeps its job of choosing whom to ask for the flat's state. The panel's rows come from a pure `guestList()` in a new `src/guests.ts`; `UI` only draws them and `main.ts` wires keys, buttons and the refresh rate.

**Tech Stack:** TypeScript 5.6 (strict, `noUnusedLocals`, `noUnusedParameters`), Vite, Vitest 5, three.js, Trystero 0.26.

**Spec:** `docs/superpowers/specs/2026-10-28-party-host-guest-list-design.md`

## Global Constraints

- Run everything from `web/`: `npm test` (Vitest) and `npm run build` (`tsc --noEmit && vite build`). Both must pass at the end of every task.
- No new message kinds: the arrival time rides in the existing `hello` as an optional `arrived` field. A hello without it (an older visitor) uses its `since` instead.
- `since` keeps its meaning (this page's join time) and its job (whom a newcomer asks for the flat's state). Only `arrived` decides the host.
- Storage key: `walkthrough.arrived.<room>` in `sessionStorage`. Blocked storage: the arrival time is the join time.
- Host rule: the earliest `arrived` among yourself and peers with a hello; a tie goes to the lower peer id; a peer without a hello is not a candidate.
- Alone (no peers, `?solo`): no crown is shown.
- Names come from other visitors: render them with `textContent` only, never `innerHTML`.
- Panel copy, verbatim: heading "Who's here"; alone line "Just you so far. Share the link to invite people."; your row's suffix " (you)"; host mark " 👑"; talking mark " 🔊".
- Key: **G** toggles the panel (no Cmd, Ctrl or Alt), also while paused. `CONFIG.multiplayer.guestListRate = 4` (refreshes per second while open).
- Match the code around you: short doc comments on exported things, the existing naming, no new dependencies.

## Files

- Modify `web/src/presence.ts`: `Peers` keeps each peer's `arrived`; new `Arrival`, `byArrival`, `hostOf`, `loadArrived`.
- Modify `web/src/multiplayer.ts`: `arrived` in the hello, `host`, `selfId`, the `onHost` hook.
- Create `web/src/guests.ts`: `GuestRow`, `GuestListInput`, `guestList()`.
- Modify `web/src/ui.ts`, `web/index.html`, `web/src/style.css`: the panel, the touch button, the clickable "With …" line.
- Modify `web/src/config.ts`: `guestListRate`.
- Modify `web/src/main.ts`: arrival time, wiring, refresh.
- Modify `README.md`: Visitors together and the controls.
- Tests: `web/tests/presence.test.ts`, `web/tests/multiplayer.test.ts`, create `web/tests/guests.test.ts`.

---

### Task 1: Arrival times and the host rule (`presence.ts`)

**Files:**
- Modify: `web/src/presence.ts` (the `PeerInfo` / `Peers` block at the end, and new functions after `saveName`)
- Test: `web/tests/presence.test.ts`

**Interfaces:**
- Produces:
  - `interface PeerInfo { name: string | null; since: number | null; arrived: number | null; lastSeen: number }`
  - `Peers.hello(id: string, name: string, since: number, now: number, arrived?: number): void` (`arrived` defaults to `since`)
  - `Peers.list(fallback?): { id: string; name: string; arrived: number | null }[]`
  - `interface Arrival { id: string; arrived: number | null }`
  - `byArrival(a: Arrival, b: Arrival): number`: earliest first, ties to the lower id, `null` last
  - `hostOf(self: { id: string; arrived: number }, others: Arrival[]): string`
  - `loadArrived(storage: () => KeyValueStore, room: string, now: number): number`

- [ ] **Step 1: Write the failing tests**

In `web/tests/presence.test.ts`, add `byArrival, hostOf, loadArrived` to the import from `'../src/presence'` (keep it alphabetical with the others). Change the first `Peers` test's expectation to include `arrived`:

```ts
  it('lists ids with names, the default until a hello', () => {
    const p = new Peers(15);
    p.seen('a', 0);
    p.hello('b', 'Rui', 100, 0);
    expect(p.list()).toEqual([{ id: 'a', name: 'Guest', arrived: null }, { id: 'b', name: 'Rui', arrived: 100 }]);
  });
```

Append a new `describe` block at the end of the file:

```ts
describe('the host', () => {
  it('keeps an arrival time apart from the join time, the join time when none is given', () => {
    const p = new Peers(15);
    p.hello('a', 'Ana', 900, 0, 300);
    p.hello('b', 'Rui', 800, 0);
    expect(p.get('a')).toMatchObject({ since: 900, arrived: 300 });
    expect(p.get('b')).toMatchObject({ since: 800, arrived: 800 });
  });
  it('orders by arrival, ties by id, those without a hello last', () => {
    const list = [{ id: 'c', arrived: null }, { id: 'b', arrived: 200 }, { id: 'a', arrived: 200 }, { id: 'd', arrived: 100 }];
    expect([...list].sort(byArrival).map((p) => p.id)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('is whoever arrived first, ties to the lower id', () => {
    expect(hostOf({ id: 'me', arrived: 1000 }, [])).toBe('me');
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'p1', arrived: 2000 }])).toBe('me');
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'p1', arrived: 2000 }, { id: 'p2', arrived: 500 }])).toBe('p2');
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'aa', arrived: 1000 }])).toBe('aa');
  });
  it("doesn't count a peer without a hello", () => {
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'p1', arrived: null }])).toBe('me');
  });
  it('remembers the arrival per room, and copes with broken storage', () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadArrived(storage, 'party', 1000)).toBe(1000);
    expect(store.get('walkthrough.arrived.party')).toBe('1000');
    expect(loadArrived(storage, 'party', 5000)).toBe(1000); // a reload keeps it
    expect(loadArrived(storage, 'other', 6000)).toBe(6000); // another room starts afresh
    const broken = () => { throw new Error('no storage'); };
    expect(loadArrived(broken, 'party', 7000)).toBe(7000);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/presence.test.ts`
Expected: FAIL. `byArrival`, `hostOf` and `loadArrived` are not exported, and `list()` has no `arrived`.

- [ ] **Step 3: Implement**

In `web/src/presence.ts`, after `saveName`, add:

```ts
const ARRIVED_KEY = 'walkthrough.arrived.';

/** When this tab first arrived in the room (ms since 1970), kept across a reload so a host who reloads stays host; a
 * closed tab forgets it. Blocked storage: now. */
export function loadArrived(storage: () => KeyValueStore, room: string, now: number): number {
  try {
    const kept = Number(storage().getItem(ARRIVED_KEY + room));
    if (kept > 0 && Number.isFinite(kept)) return kept;
    storage().setItem(ARRIVED_KEY + room, String(now));
  } catch {
    // private mode: each reload arrives afresh
  }
  return now;
}
```

Replace the `PeerInfo` line and the `seen`, `hello` and `list` methods of `Peers`:

```ts
export interface PeerInfo { name: string | null; since: number | null; arrived: number | null; lastSeen: number }
```

```ts
  /** Marks a peer alive; returns true when it is new. */
  seen(id: string, now: number): boolean {
    const p = this.table.get(id);
    if (p) {
      p.lastSeen = now;
      return false;
    }
    this.table.set(id, { name: null, since: null, arrived: null, lastSeen: now });
    return true;
  }

  /** `arrived` is when it first came to the room (a visitor from before hosts sends none: its join time stands in). */
  hello(id: string, name: string, since: number, now: number, arrived = since): void {
    this.seen(id, now);
    const p = this.table.get(id)!;
    p.name = name;
    p.since = since;
    p.arrived = arrived;
  }
```

```ts
  /** Ids, names and arrival times, in join order, for showing who is talking and who is host. */
  list(fallback = CONFIG.multiplayer.defaultName): { id: string; name: string; arrived: number | null }[] {
    return [...this.table].map(([id, p]) => ({ id, name: p.name ?? fallback, arrived: p.arrived }));
  }
```

At the end of the file, add:

```ts
/** A visitor and when it arrived; null until its hello. */
export interface Arrival { id: string; arrived: number | null }

/** Earliest arrival first, ties to the lower id, those without a hello last: the same order in every browser. */
export function byArrival(a: Arrival, b: Arrival): number {
  if (a.arrived === null || b.arrived === null) return (a.arrived === null ? 1 : 0) - (b.arrived === null ? 1 : 0);
  return a.arrived - b.arrived || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The host: whoever arrived first among this visitor and the peers it has a hello from. */
export function hostOf(self: { id: string; arrived: number }, others: Arrival[]): string {
  return [self, ...others.filter((p) => p.arrived !== null)].sort(byArrival)[0].id;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/presence.test.ts`
Expected: PASS.

Run: `cd web && npm test`
Expected: FAIL only in `tests/multiplayer.test.ts`, "lists the people here with their ids" (`people` now carries `arrived`). Task 2 updates that test. Everything else passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/presence.ts web/tests/presence.test.ts
git commit -m "Party: arrival times and the host rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The host in multiplayer (`multiplayer.ts`)

**Files:**
- Modify: `web/src/multiplayer.ts`
- Test: `web/tests/multiplayer.test.ts`

**Interfaces:**
- Consumes (Task 1): `Peers.hello(id, name, since, now, arrived?)`, `Peers.list()` with `arrived`, `hostOf(self, others)`.
- Produces:
  - `new Multiplayer(room, world, avatars, name, hooks, joinedAt = Date.now(), arrived = joinedAt)`
  - `MultiplayerHooks.onHost?: (hostId: string) => void`: called when the host changes
  - `Multiplayer.host: string`: the host's peer id (this visitor's own `selfId` when it is host)
  - `Multiplayer.selfId: string`
  - `Multiplayer.people: { id: string; name: string; arrived: number | null }[]`
  - The hello on the wire: `{ name, since, arrived }` (plus `ask: 1` when asking)

- [ ] **Step 1: Write the failing tests**

In `web/tests/multiplayer.test.ts`, replace `setup` so it takes an arrival time and records host changes:

```ts
function setup(joinedAt = 1000, arrived = joinedAt) {
  const fake = fakeRoom();
  const world = { doors: [{ state: new DoorState(door) }], movables: [], lights: new LightGroups(['sala']), screens: [] };
  const avatars = new Avatars(null);
  let now = 0;
  const changed: string[][] = [];
  const peers: string[][] = [];
  const hosts: string[] = [];
  const mp = new Multiplayer(fake.room, world, avatars, 'Ana', {
    now: () => now, onChanged: (k) => void changed.push(k), onPeers: (n) => void peers.push(n), onHost: (h) => void hosts.push(h),
  }, joinedAt, arrived);
  return { fake, world, avatars, mp, changed, peers, hosts, setNow: (t: number) => { now = t; }, node: new Object3D() };
}
```

Update the existing expectations that the new field changes:
- "lists the people here with their ids": `expect(mp.people).toEqual([{ id: 'p1', name: 'Rui', arrived: 2000 }]);`
- "greets a joining peer, …": `expect(fake.sent).toEqual([{ kind: 'hello', data: { name: 'Ana', since: 1000, arrived: 1000 }, to: 'p1' }]);`
- "asks a peer that comes back after timing out …": both hello expectations get `arrived: 1000`, i.e. `{ name: 'Ana', since: 1000, arrived: 1000, ask: 1 }` and `{ name: 'Ana', since: 1000, arrived: 1000 }`.

Add these tests inside `describe('Multiplayer', …)`:

```ts
  it('is host until someone who arrived earlier says hello, and gets it back when they leave', () => {
    const { fake, mp, hosts } = setup(1000);
    expect(mp.selfId).toBe('me');
    expect(mp.host).toBe('me');
    fake.join('early'); // no hello yet: not a candidate
    expect(mp.host).toBe('me');
    fake.receive('hello', { name: 'Zé', since: 1500, arrived: 1500 }, 'late');
    expect(mp.host).toBe('me');
    expect(hosts).toEqual([]);
    fake.receive('hello', { name: 'Rui', since: 2000, arrived: 500 }, 'early');
    expect(mp.host).toBe('early');
    expect(hosts).toEqual(['early']);
    fake.leave('early');
    expect(mp.host).toBe('me');
    expect(hosts).toEqual(['early', 'me']);
  });
  it("takes an older visitor's join time as its arrival", () => {
    const { fake, mp } = setup(1000);
    fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(mp.host).toBe('old');
  });
  it('hands the host on when the host times out', () => {
    const { fake, mp, hosts, setNow } = setup(1000);
    fake.receive('hello', { name: 'Rui', since: 500, arrived: 500 }, 'old');
    setNow(20);
    mp.tick();
    expect(mp.host).toBe('me');
    expect(hosts).toEqual(['old', 'me']);
  });
  it('a host back from a reload keeps the crown and still asks for the state', () => {
    const { fake, mp } = setup(3000, 500); // joined this page at 3000, first arrived at 500
    fake.receive('hello', { name: 'Rui', since: 1000, arrived: 1000 }, 'p1');
    expect(mp.host).toBe('me');
    expect(fake.sent.at(-1)).toEqual({ kind: 'state', data: { want: 1 }, to: 'p1' });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/multiplayer.test.ts`
Expected: FAIL. `mp.host` and `mp.selfId` are undefined, the hello has no `arrived`, and `hosts` stays empty.

- [ ] **Step 3: Implement**

In `web/src/multiplayer.ts`:

Add `hostOf` to the import from `'./presence'` (alphabetical: after `encodePose`).

Change the `Hello` interface:

```ts
/** `arrived`: when it first came to the room, which decides the host (an older visitor sends none). `ask`: send yours
 * back (to a peer that timed out here and came back, so its name is lost). */
interface Hello { name: string; since: number; arrived?: number; ask?: 1 }
```

Add the hook to `MultiplayerHooks`:

```ts
  /** The host's peer id (this visitor's own when it is host), whenever that changes. */
  onHost?: (hostId: string) => void;
```

In the class, add a field after `private since: number;`:

```ts
  private lastHost: string;
```

Change the constructor's signature and first line:

```ts
  constructor(private room: Room, world: StateWorld, private avatars: Avatars, private name: string, private hooks: MultiplayerHooks, joinedAt = Date.now(), private arrived = joinedAt) {
    this.since = joinedAt;
    this.lastHost = room.selfId;
```

In the `'hello'` handler, replace `this.peers.hello(id, peerName, data.since, hooks.now());` with:

```ts
      const arrived = typeof data.arrived === 'number' && Number.isFinite(data.arrived) ? data.arrived : data.since;
      this.peers.hello(id, peerName, data.since, hooks.now(), arrived);
```

and after its `hooks.onPeers(this.peers.names());` add `this.checkHost();`.

Change the `people` getter's type and add `selfId` and `host` after it:

```ts
  /** Ids, names and arrival times of the others here. */
  get people(): { id: string; name: string; arrived: number | null }[] {
    return this.peers.list();
  }

  get selfId(): string {
    return this.room.selfId;
  }

  /** Whoever arrived first: their peer id, or this visitor's own. */
  get host(): string {
    return hostOf({ id: this.room.selfId, arrived: this.arrived }, this.peers.list());
  }
```

Replace `greet`:

```ts
  private greet(id: string, ask = false): void {
    const hello = { name: this.name, since: this.since, arrived: this.arrived };
    this.room.send('hello', ask ? { ...hello, ask: 1 } : hello, id);
  }
```

Add after `greet`:

```ts
  /** Tells the hook when someone else is host now (after a hello, a leave or a timeout). */
  private checkHost(): void {
    const host = this.host;
    if (host === this.lastHost) return;
    this.lastHost = host;
    this.hooks.onHost?.(host);
  }
```

In `depart`, after `this.hooks.onPeers(this.peers.names());` add `this.checkHost();`. In `tick`, change the last line to:

```ts
    if (gone.length) {
      this.hooks.onPeers(this.peers.names());
      this.checkHost();
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npm test`
Expected: PASS (all files).

Run: `cd web && npx tsc --noEmit`
Expected: no errors. `main.ts` still compiles because the new constructor argument and hook are optional.

- [ ] **Step 5: Commit**

```bash
git add web/src/multiplayer.ts web/tests/multiplayer.test.ts
git commit -m "Party: the first to arrive is host, kept through a reload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The guest list's rows (`guests.ts`)

**Files:**
- Create: `web/src/guests.ts`
- Test: `web/tests/guests.test.ts`

**Interfaces:**
- Consumes (Task 1): `byArrival`, `colourFor(id)` from `./presence`.
- Produces:
  - `interface GuestRow { id: string; name: string; colour: string; you: boolean; host: boolean; room: string | null; talking: boolean }`
  - `interface GuestListInput { self: { id: string; name: string; arrived: number }; people: { id: string; name: string; arrived: number | null }[]; host: string; roomOf: (id: string) => string | null; talking: (id: string) => boolean }`
  - `guestList(input: GuestListInput): GuestRow[]`

- [ ] **Step 1: Write the failing tests**

Create `web/tests/guests.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/guests.test.ts`
Expected: FAIL, because `../src/guests` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/guests.ts`:

```ts
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
  self: { id: string; name: string; arrived: number };
  /** The others, as `Multiplayer.people` lists them. */
  people: { id: string; name: string; arrived: number | null }[];
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/guests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/guests.ts web/tests/guests.test.ts
git commit -m "Party: the guest list's rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The panel, G and the touch button

**Files:**
- Modify: `web/index.html` (the HUD, the touch bar, both controls lists)
- Modify: `web/src/style.css`
- Modify: `web/src/ui.ts`
- Modify: `web/src/config.ts` (`multiplayer` block)
- Modify: `web/src/main.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `guestList`, `GuestRow` (Task 3); `Multiplayer.host`, `.selfId`, `.people`, the `onHost` hook and the 7th constructor argument (Task 2); `loadArrived` (Task 1).
- Produces:
  - `UI.setGuests(rows: GuestRow[]): void`
  - `UI.toggleGuests(): boolean` (returns whether it is open now)
  - `UI.guestsOpen: boolean`
  - `UI.onGuests(cb: () => void): void`
  - `CONFIG.multiplayer.guestListRate: number`

There are no unit tests for DOM wiring in this project (`tests/ui.test.ts` only tests pure helpers). This task is checked with `npm run build` and by hand in Task 5.

- [ ] **Step 1: Markup**

In `web/index.html`, after `<div id="people" hidden></div>`, add:

```html
      <section id="guests" aria-label="Who's here" hidden>
        <h2>Who's here</h2>
        <ul id="guest-rows"></ul>
        <p id="guests-alone" hidden>Just you so far. Share the link to invite people.</p>
      </section>
```

In `#touch-bar`, after the `touch-sun` button, add:

```html
        <button type="button" id="touch-guests" aria-label="Who's here" aria-expanded="false" aria-controls="guests">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="16.5" cy="9" r="2.5" /><path d="M15.5 14.2a4.5 4.5 0 0 1 5 4.8" /></svg>
        </button>
```

In `.controls.keys-only`, after the `V` line, add `<li><kbd>G</kbd> who's here</li>`. In `.controls.touch-only`, change the buttons line to:

```html
        <li>Buttons, top right: date and time (and the kitchen wall), who's here, room light, sound, mic, pause</li>
```

- [ ] **Step 2: Styles**

In `web/src/style.css`, after the `#mic:not(.off) …` rule, add:

```css

/* Who's here (G, a click on the "With …" line with the mouse free, or the touch bar's people button): top left, under
   the room name. It only shows, so clicks and touches go through to the view; it sits above the pause veil like the
   sun panel. */
#guests {
  position: fixed; left: calc(16px + env(safe-area-inset-left)); top: calc(64px + env(safe-area-inset-top)); z-index: 10;
  width: min(260px, calc(100vw - 32px)); box-sizing: border-box; padding: 10px 14px; border-radius: 10px;
  background: rgba(30, 28, 25, 0.78); font-size: 13px; pointer-events: none;
}
#guests h2 { margin: 0 0 6px; font-size: 14px; font-weight: 500; letter-spacing: 0.03em; }
#guest-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#guest-rows li { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; }
#guest-rows i { width: 10px; height: 10px; border-radius: 50%; }
#guest-rows span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#guest-rows .room { color: var(--muted); }
#guests-alone { margin: 6px 0 0; color: var(--muted); line-height: 1.4; }
body.cursor #people { pointer-events: auto; cursor: pointer; }
```

- [ ] **Step 3: `UI` methods**

In `web/src/ui.ts`, add `import type { GuestRow } from './guests';` after the existing imports. Add a field to the class, after `private touch = false;`:

```ts
  private lastGuests = '';
```

Add these methods after `setPeople`:

```ts
  /** The guest list's rows, redrawn only when something in them changed. Names come from other visitors: text only. */
  setGuests(rows: GuestRow[]): void {
    const key = JSON.stringify(rows);
    if (key === this.lastGuests) return;
    this.lastGuests = key;
    this.el('guest-rows').replaceChildren(...rows.map((r) => {
      const li = this.doc.createElement('li');
      const dot = this.doc.createElement('i');
      dot.style.background = r.colour;
      const name = this.doc.createElement('span');
      name.textContent = `${r.name}${r.you ? ' (you)' : ''}${r.host ? ' 👑' : ''}${r.talking ? ' 🔊' : ''}`;
      const room = this.doc.createElement('span');
      room.className = 'room';
      room.textContent = r.room ?? '';
      li.append(dot, name, room);
      return li;
    }));
    this.el('guests-alone').hidden = rows.length > 1;
  }

  get guestsOpen(): boolean {
    return !this.el('guests').hidden;
  }

  /** Shows or hides the guest list; returns whether it is open now. */
  toggleGuests(): boolean {
    const panel = this.el('guests');
    panel.hidden = !panel.hidden;
    this.el('touch-guests').setAttribute('aria-expanded', String(!panel.hidden));
    return !panel.hidden;
  }

  /** A click on the "With …" line (with the mouse free) or the touch bar's people button. */
  onGuests(cb: () => void): void {
    this.el('people').addEventListener('click', cb);
    this.el('touch-guests').addEventListener('click', cb);
  }
```

- [ ] **Step 4: Config**

In `web/src/config.ts`, in the `multiplayer` block after `staleAfter: 15,`, add:

```ts
    /** Times a second the open guest list looks again at who is in which room and who is talking. */
    guestListRate: 4,
```

- [ ] **Step 5: Wiring in `main.ts`**

Imports: add `loadArrived` to the `'./presence'` import (alphabetical: after `lightValue`) and add `import { guestList } from './guests';` after the `'./multiplayer'` import.

In `joinOthers`, replace the `joinRoom(…)` call's room argument and the `new Multiplayer(…)` call so they read:

```ts
      const roomName = params.get('room') || CONFIG.multiplayer.room;
      arrived = loadArrived(() => sessionStorage, roomName, Date.now());
      const room = joinRoom(
        { appId: CONFIG.multiplayer.appId, ...(turnConfig.length ? { turnConfig } : {}) },
        roomName,
        { onJoinError: ({ peerId, error }) => console.warn(`Could not connect to visitor ${peerId}: ${error}`) },
      );
      others = new Multiplayer(trysteroRoom(room, selfId), world, avatars, cleanName(typed), {
        now: () => performance.now() / 1000,
        onChanged: (keys) => keys.forEach((k) => used(byKey.get(k) ?? null)), // the sounds a local click would make
        onPeers: () => showPeople(),
        onHost: () => { guestsDue = 0; },
      }, Date.now(), arrived);
```

After the `showPeople` line (`const showPeople = () => …`), add:

```ts
  /** When this visitor first came to the room: kept through a reload, so a host who reloads stays host (set on joining). */
  let arrived = Date.now();
  /** Each visitor's last room for the guest list: outside every room, `locate` keeps the last one, as with your own. */
  const guestRooms = new Map<string, string | null>();
  let guestsDue = 0;
  /** From the frame loop: the open guest list, a few times a second, and at once after it opens or the host changes. */
  const showGuests = (now: number) => {
    if (!ui.guestsOpen || now < guestsDue) return;
    guestsDue = now + 1000 / CONFIG.multiplayer.guestListRate;
    const self = { id: others?.selfId ?? 'self', name: cleanName(ui.getName()), arrived };
    ui.setGuests(guestList({
      self,
      people: others?.people ?? [],
      host: others?.host ?? self.id,
      roomOf: (id) => {
        const pose = id === self.id ? [player.x, player.z] : avatars.get(id)?.pose;
        if (!pose) return null;
        const room = world.rooms.locate(pose[0], pose[1], guestRooms.get(id) ?? null);
        guestRooms.set(id, room);
        return room ? names.get(room) ?? null : null;
      },
      talking: (id) => voices?.talking(id) ?? false,
    }));
  };
  const toggleGuests = () => {
    if (ui.toggleGuests()) guestsDue = 0;
  };
  ui.onGuests(() => {
    if (started && !autostart) toggleGuests();
  });
```

(`names` is defined near the top of the same function, `const names = new Map(…)` at about line 149, so it is in scope. `player`, `avatars` and `world` are too.)

In the `keydown` listener, just before `if (!started || paused) return;`, add:

```ts
    if (e.code === 'KeyG' && started && !autostart && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) return toggleGuests(); // paused too
```

In the animation loop, after `if (others) showPeople();`, add:

```ts
    showGuests(now);
```

- [ ] **Step 6: README**

In `README.md`:
- In the Controls paragraph under "Run and test", after `M mutes sound, ` insert `G shows who's here, `.
- In the touch paragraph, change "The buttons at the top right open the sun panel, toggle the room's light, …" to "The buttons at the top right open the sun panel, show who's here, toggle the room's light, …".
- In "Visitors together", after the first paragraph, add:

```markdown
Whoever arrived first is the host: every browser works it out alone from the arrival time each visitor sends in its hello, earliest first and ties to the lower peer id, so all agree without a server. The arrival time is kept per room in the tab's `sessionStorage`, so a host who reloads stays host; one who closes the tab hands over to the next to have arrived. For now the host only wears a crown; the party's music, lights and TV controls will go to the host. G (or a click on the "With …" line with the mouse free, or the people button on touch) opens "Who's here": everyone in arrival order with their animal's colour, a 👑 on the host, the room they're in and 🔊 while they talk. The design note is `docs/superpowers/specs/2026-10-28-party-host-guest-list-design.md`.
```

- [ ] **Step 7: Build and test**

Run: `cd web && npm test && npm run build`
Expected: all tests PASS, the build finishes with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/src/style.css web/src/ui.ts web/src/config.ts web/src/main.ts README.md
git commit -m "Party: the Who's here panel (G, the With line, a touch button)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Check it in the browser

**Files:** none, unless a check fails (then fix in the file at fault, re-run `npm test && npm run build`, and commit the fix).

- [ ] **Step 1: Start the dev server**

Use the preview tool with the `walkthrough` configuration in `.claude/launch.json` (it runs `npm --prefix web run dev` on port 5173). Do not start it from Bash.

- [ ] **Step 2: One visitor**

Open `http://localhost:5173/?room=host-check-<random>`, type the name "Ana", untick "Talk with your voice", and start. Press G.
Expected: "Who's here" shows one row, "Ana (you)" with your room's name and no crown, and "Just you so far. Share the link to invite people." There are no console errors (`read_console_messages`).

- [ ] **Step 3: Three visitors**

Open the same URL in two more tabs, named "Rui" and then "Zé". In each, press G.
Expected: every tab lists Ana, Rui, Zé in that order, with 👑 on Ana in all three. Walk Rui into another room: within about a quarter-second the other tabs show Rui's new room.

- [ ] **Step 4: Reload and leave**

Reload Ana's tab and start again with the same name.
Expected: Ana still has the crown in all tabs, and Ana's flat shows the doors and lights as the others left them. Change a light in Rui's tab first, then reload Ana, and check that it stays as Rui set it.

Close Ana's tab.
Expected: within the leave event (or at most 15 s), Rui gets the crown in the remaining tabs.

- [ ] **Step 5: Touch and pause**

Resize to the mobile preset and reload. Start, then tap the people button in the top-right bar.
Expected: the panel opens and the button shows pressed. Tap again to close it. Back on desktop, press Esc to pause, then G.
Expected: the panel toggles while paused and shows above the pause veil. Reset the viewport to desktop afterwards.

- [ ] **Step 6: Screenshot and finish**

Take a screenshot of the open panel with three visitors, for the PR.
