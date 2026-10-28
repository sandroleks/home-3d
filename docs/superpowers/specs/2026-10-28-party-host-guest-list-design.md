# Party: Host and Guest List — Design

**Date:** 2026-10-28
**Status:** Implemented

## Goal

The flat is getting an online party: up to about six guests at once, in the same Trystero room as the multiplayer (`2026-10-25-multiplayer-design.md`) and voice (`2026-10-27-proximity-voice-design.md`). This is the first of five pieces:

| # | Piece | Builds on |
|---|---|---|
| A | **Host and guest list** (this note) | — |
| B | Shared music / DJ: the same track in sync for everyone, the host's queue, guests' requests | A |
| C | Dancing, emotes and party lights pulsing with the music | B |
| D | Drinks and food: pick up a glass or a snack, clink, hold it on your animal | C |
| E | Shared TV and games: a video in sync on the TV, screen sharing, a party game | A |

Each gets its own design note, plan and build. A gives the party a host, the person whose say counts once B, C and E add controls, and a panel listing who is here.

Not in A: a doorbell or an arrival flow (guests appear at the entrance as they do now), party links, muting or removing guests, gathering everyone, handing the host role over by hand, co-hosts.

## Who is host

- The host is whoever arrived first: the earliest **arrival time** among yourself and everyone you have a hello from, a tie going to the later join (`since`), then the lower peer id. The later join matters after a reload: the new page has a new peer id but keeps its `arrived`, and if the old id's leave hasn't arrived yet, both are listed for a moment; the new page wins, so no two browsers disagree and the list shows no duplicate for long. Every browser works it out alone from the same data, so all agree without any new message or any chance of two claims.
- **Arrival time** (`arrived`) is new, and separate from the existing `since`. `since` stays this page's join time and keeps its job of choosing whom a newcomer asks for the flat's state; `arrived` only decides the host. (Reusing `since` across a reload would make a reloading host look like the oldest visitor: it would stop asking for the state, and the others could take its fresh, default flat as the truth.)
- `arrived` is kept in `sessionStorage` per room (`walkthrough.arrived.<room>`), so a host who reloads the tab stays host. Closing the tab forgets it, and the role passes on. Another `?room=` starts a time of its own. Storage blocked: `arrived` is the page's join time.
- The hello carries `arrived` beside `since`. A peer on an older version sends none: its `since` stands in.
- A peer is a candidate once its hello is in; a peer seen only by its poses is not. So for a moment after joining, before the hellos arrive, a newcomer may see itself as host; the crown settles within the first hello round.
- When the host leaves (Trystero's leave, or the 15 s silence timeout that already removes an animal), the next earliest is host at once, everywhere.
- Alone, with `?solo`, or in a reference render (`?autostart`): you are host, and nothing shows it.
- `hostOf(self, peers)` is a pure function in `src/presence.ts`, beside `Peers`, which now also keeps each peer's `arrived`. `Multiplayer` exposes `host` (a peer id, or the visitor's own) and calls a new `onHost` hook when it changes. In A the host's only sign is the crown in the guest list; B, C and E will read `host` to decide who gets their controls.

## Guest list panel

- **G** opens and closes it. With the mouse free (the cursor shown), clicking the "With …" line under the room name does the same. On touch that line is click-through, so only the people button in the top-right bar opens the panel. It opens and closes like the sun panel, and works while paused. The "With …" line stays as the summary while the panel is closed, and is hidden while the panel is open, since the panel lists the same people and would cover a wrapped line.
- One row per person, in arrival order, so the host comes first:
  - a dot in their animal's colour (`colourFor(id)`);
  - their name, "(you)" on your own row;
  - 👑 on the host;
  - the room they are in (Sala, Cozinha, …), from their animal's position through the same `RoomLocator` that names your own room;
  - 🔊 while they talk (`voices.talking(id)`).
- Alone: "Just you so far. Share the link to invite people."
- It updates as people come and go and as the host changes; rooms and talking are checked about four times a second (`CONFIG.multiplayer.guestListRate`), not every frame.
- The rows come from a pure `guestList(...)` (self, peers, host, rooms, talking → rows); `UI.setGuests(rows)` only draws them; `main.ts` wires G, the touch button and the update rate. The controls list on the start screen gets "G: who's here".

## Known limits

- Arrival times come from each visitor's own clock. Two guests arriving within a clock's error of each other may come out in the "wrong" order, but every browser agrees on it.
- Everyone connects to everyone. If two guests can't reach each other (a network blocking WebRTC with no TURN), they can disagree on who is host until they connect.

## Testing

- Unit tests (`web/tests`):
  - `hostOf`: the earliest arrival wins; a tie goes to the later join, then the lower id (a reloaded host beats its old self); a peer without a hello doesn't count; an older peer's `since` stands in for `arrived`; the role passes when the host leaves or times out.
  - `arrived`: kept per room in `sessionStorage`, reused on reload, fresh for another room, the join time when storage is blocked.
  - `guestList`: order, the crown, "(you)", rooms, talking, the empty list.
- By hand: two or three tabs on one `?room=`. The first gets the crown; reloading it keeps the crown and the flat's state; closing it moves the crown to the next tab. Rooms and 🔊 follow as people walk and talk. Then on a phone-sized viewport with the touch button.
- The README's "Visitors together" and controls get the host, the panel and G.
