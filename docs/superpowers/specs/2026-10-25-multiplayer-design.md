# Multiplayer — Design

**Date:** 2026-10-25
**Status:** Implemented

## Goal

People who open the walkthrough at the same time see each other walking around the flat, each with a name over their head, and share the flat: a door one of them opens is open for everyone, and so are drawers, cupboards, lights, screens and the turntable. Nothing else changes: alone, the walkthrough is exactly as before.

## No server

The site is static (Vercel). Visitors connect to each other directly with WebRTC, through [Trystero](https://github.com/dmotz/trystero) (`trystero`, exact version pinned). Its default strategy finds the other visitors through public Nostr relays, so there is no server to run, no account and no key. Trystero handles the mesh (one data channel per pair), joins and leaves; the walkthrough only sends and receives small JSON messages.

Limits that follow from this, and are accepted:

- Everyone connects to everyone: fine for a handful of people, not for a crowd. The default room is the whole site; `?room=<name>` puts a group in a room of its own.
- A network that blocks direct WebRTC connections (strict NAT, mobile carriers, some offices) needs a TURN relay. Cloudflare's TURN service provides one (added 2026-10-27, see "TURN" below). Without it, or on a network that blocks TURN too, that visitor is alone in the flat; the walkthrough carries on.
- Nobody is in charge. Each visitor owns their own position; the flat's state is "last message wins", which converges because messages carry the resulting state (open or closed, on or off), never a toggle.

The networking is behind a small `Room` interface in `src/multiplayer.ts` (join, send, receive, peer joined, peer left, leave) so a WebSocket server could replace Trystero later without touching the rest. The Trystero module is imported dynamically on the start click: it is not in the first bundle, and if it fails to load the walkthrough runs alone with a console warning.

## TURN

Added 2026-10-27. Its one piece of server code is a Vercel function, `web/api/turn.ts`. Given `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`, it asks Cloudflare for ICE servers with credentials that last 24 h and answers `{ iceServers }` (`Cache-Control: no-store`). It drops the port 53 URLs, which browsers block. Without the variables, or if Cloudflare fails, it answers an empty list. The token stays on the server.

The page asks `api/turn` for the list as soon as it loads (not with `?autostart` or `?solo`), so it is usually there by the start click. `fetchIceServers` (`src/turn.ts`) waits at most `CONFIG.multiplayer.turn.timeout` and never fails: no function (local dev, another host), a bad answer or a timeout all give an empty list. A non-empty list goes to Trystero as `turnConfig`, which keeps its default STUN servers. WebRTC still tries a direct connection first, and only pairs that can't connect directly use the relay. `onJoinError` logs a pair that could not connect at all.

Anyone can call `/api/turn` and get credentials, as anyone can open the site. Cloudflare's free tier (1,000 GB a month) is far above what a handful of visitors' small JSON messages use.

## Joining

- The start screen gets a name field ("Your name", optional). It is remembered in `localStorage` (`walkthrough.name`) and sent to the others; blank means "Guest". Names are trimmed and cut to 24 characters.
- The visitor joins on the start click, never before, and never with `?autostart` (reference renders stay empty) or `?solo`.
- Each visitor's colour comes from a fixed palette, chosen by hashing their peer id, so everyone sees the same colour for the same person without negotiating.
- Leaving the page leaves the room; a closed tab's peer disappears for the others within a few seconds (Trystero's peer-leave), and in any case an avatar that has not sent a pose for 15 s is removed.

## What is sent (`src/presence.ts`, pure, unit-tested)

Three message kinds, all small JSON:

- **hello**: `{ name, since }`, sent to each peer as it connects: the visitor's name and when they joined (epoch ms). A peer's avatar exists from its first message; its label reads "Guest" until its hello arrives.
- **pose**: `[x, z, yaw, pitch]` (metres and radians, rounded to 3 decimals), 15 times a second while the visitor moves or turns and once a second otherwise, so a still avatar stays alive and a stuck one times out. `shouldSend(last, now, moved)` decides.
- **state**: the flat's shared state, as a map of items to values: `{ "door:<node>": 0|1, "movable:<node>": 0|1, "light:<group>": 0|1, "screen:<node>": -1 | channel }`. Sent as a delta of the items a click just changed (one item, usually), and applied by whoever receives it. A screen's value is -1 for off, else the TV's channel (0 for the monitor and laptop, which only switch on or off).

Who has the flat's state when someone arrives: the newcomer. On each hello from a peer who joined earlier (`since` smaller than its own), a visitor who is not yet *settled* sends that peer `{ want: 1 }`, and the peer answers with its full state. A visitor is settled once it has received a state, or as soon as it changes something itself (its flat is live then, and must not be overwritten by a snapshot). Two visitors who arrive alone therefore never ask each other, and the one who was there first always answers the one who came later. Clock skew between browsers could in theory make both ask; the two snapshots would then swap, which is harmless and rare.

`collectState(world)` and `applyState(world, delta, now)` map between the world's objects and this plain form. `applyState` sets targets directly (`DoorState.target`, `MovableState.target`, `LightGroups.set`, and a new `Screen.set(on, channel, now)`), so the usual easing, sounds and lighting follow from the frame loop as they do for a local click. Remote switch, lamp and screen uses also play the click sound at the node, as a local one does; doors and drawers already sound as they move.

Sun date, time and the real-lighting toggle are not shared: they are each visitor's own view of the flat, like the sun panel says.

## Avatars (`src/creatures.ts`, `src/avatars.ts`)

Each visitor is a little pastel toy animal, after the wooden reindeer on the sofa and made funnier: one egg-shaped body that is head and body at once (0.84 m tall, slightly narrower at the top), a cream face disc set into its front and tipped up a little, with rosy cheeks, big googly eyes along the disc's top edge (one a little bigger than the other), and four dowel legs on round feet, about 1.6 m to the top at `CONFIG.multiplayer.creature.scale` 1. Each animal has its own expression:

- **Reindeer**: antlers that jiggle as it walks, a shiny red nose and a smile.
- **Bear**: round ears with pink insides that twitch, a button nose, a smile and its tongue out to one side.
- **Bunny**: long floppy ears with pink insides, one flopped more than the other, a pink nose, a little open mouth with buck teeth, and a pompom tail.
- **Fox**: pointed ears, eyebrows up to something, a sly wide grin and a brush tail that wags.

The animal comes from the visitor's peer id (`speciesFor`, a different hash from the colour's), so everyone sees the same animal for the same person. The colour is the body's, from a pastel palette whose first entry is a caramel after the reindeer's brown. The face is cream with a hint of the body colour; legs, feet and antlers are a deeper, duskier shade of it (`creaturePalette`). Eyes, pupils, mouths, cheeks, noses and tongue are fixed colours (`FACE_COLOURS`).

- Built from primitives (an ellipsoid with analytic normals so the sphere's seam stays smooth, capsules, cones, cylinders, half-tori for the smiles), so there is nothing to download. Features sit on the egg or the face disc along its surface normal (`onEgg`, `onFace`). Geometry is shared by every figure; materials are per figure, one per colour.
- `MeshMatcapMaterial` with a soft studio light drawn on a canvas (a glossier one, with a sharp highlight, for eyes and noses), and not tone mapped: a toy's flat colours with a rounded look, at no cost per light. The rooms' light is baked and never reaches a moving figure, so the avatars dim their colours with the room instead: full under the room's ceiling light, 70% of that under a lamp, or by daylight (full from a baked sky level of 1.5), and a quarter in an unlit room at night (`figureLight`).
- No shadows cast or received: the sun's shadow map is only redrawn when the sun or a door moves (`daylight.ts`), so a moving figure could not cast a correct one.
- Alive: while moving, the legs swing in diagonal pairs at the speed the figure moves (a cycle every 0.75 m), the body bounces 5 cm a step, stretches mid-step and squashes on landing, and sways. Standing still it breathes and glances about. Its body tilts toward where its visitor looks (a third of the pitch, at most 0.3 rad). Ears, antlers and tails swing a little at rest and in step with the walk (`Wag`).
- Googly eyes: each pupil rides a loose, underdamped spring toward where the eyes glance (`stepGoogly`), and every footfall and turn shoves it, so pupils wobble and overshoot. The two eyes have different stiffness, so they never quite agree. At the edge of the eye a pupil bounces back. The figure blinks every 2 to 6 s, sometimes twice. Tuning in `CONFIG.multiplayer.creature` (`bounce`, `googly`, `blink`).
- The name label sits above the highest point (a sprite with the name drawn on a canvas, fixed world size, drawn over everything so it reads through a doorway).
- Avatars live in the main scene, so mirrors reflect them. A hidden spare figure is there from load, so the shader warm-up compiles its materials and the first person to appear doesn't stall the frame.
- No collision with avatars: people walk through each other.
- Poses are smoothed: each frame the avatar moves a share of the way to the latest pose (`smoothPose`, a time constant of 0.1 s, yaw by the shortest turn), so 15 updates a second look like continuous motion and a late packet is a brief slide, not a jump.

## HUD

Under the room name, a line lists who else is here ("With Ana, Rui"), hidden when alone. Touch and desktop alike.

## Files

- Create `web/src/presence.ts`: names, colours, pose encoding and smoothing, send throttling, state collect/apply, the peer table with timeouts. Tests in `web/tests/presence.test.ts`.
- Create `web/src/creatures.ts`: the four animals, their faces, palette and matcaps. Tests in `web/tests/creatures.test.ts`.
- Create `web/src/avatars.ts`: the figures, their labels, poses, walk, eyes and light. Tests in `web/tests/avatars.test.ts` (three.js runs in node).
- Create `web/src/multiplayer.ts`: the `Room` interface, the Trystero adapter, and `Multiplayer`, which owns the peers, forwards poses to avatars, answers state requests and broadcasts local changes. Tests with a fake room in `web/tests/multiplayer.test.ts`.
- Modify `web/src/screens.ts`: `Screen.set(on, channel, now)` and `channel`.
- Modify `web/index.html`, `web/src/ui.ts`, `web/src/style.css`: the name field, the "With …" line, the controls list.
- Modify `web/src/main.ts`: join on start, send the pose from the frame loop, broadcast after `used()` and the L key, update avatars.
- Modify `web/src/config.ts`: `CONFIG.multiplayer` (app id, default room, send rates, timeout, smoothing, palette, the creatures' scale, walk, eyes and light).
- Modify `web/src/lightmaps.ts`: `LightGroups.ids()`; `web/src/screen-content.ts`: `TvContent.setChannel`.
- Modify `README.md`.
- TURN (2026-10-27): create `web/api/turn.ts` (the Vercel function) and `web/src/turn.ts` (`fetchIceServers`), with tests in `web/tests/turn.test.ts`; `CONFIG.multiplayer.turn`; `api` added to `web/tsconfig.json`.
