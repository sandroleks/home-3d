# Proximity Voice — Design

**Date:** 2026-10-27
**Status:** Implemented

## Goal

Visitors in the flat talk to each other with their voices. A voice comes from where its animal stands: louder close by, quieter far away, and muffled through walls and closed doors, clear again through an open doorway. You can see who is talking, because their animal's mouth moves.

It builds on the multiplayer (`2026-10-25-multiplayer-design.md`): the same Trystero room, the same peers, the same no-server design, with the TURN fallback relaying voices for strict networks the way it relays poses.

## Joining with voice

- The start screen gets a checkbox, "Talk with your voice", under the name field. It is ticked by default and remembered in `localStorage` (`walkthrough.voice`).
- When it is ticked, the start click asks for the mic: `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`. The click is the user gesture browsers want.
- Refused, missing, or failing: the visitor joins listen-only. They still hear everyone; the HUD shows a crossed-out mic, and the console has a warning.
- Never with `?autostart` or `?solo`, which don't join at all. Unticked: listen-only, without asking for the mic.

## In the flat

- **V** turns the mic on and off. Off sets the mic track's `enabled` to false, so the peers get silence and nothing renegotiates. Turning it back on is instant. With no mic (listen-only), V does nothing.
- On touch, a mic button beside the existing sound button does the same.
- The HUD shows the mic state next to the muted mark: on, off, or none (listen-only). The controls list on the start screen gets "V: mic on or off".
- **M** (mute) already silences everything through the listener's input; voices go through it too, so M silences them as well. It does not touch the mic.
- Pausing (Esc) suspends the audio context, which stops the voices. It also turns the mic off while paused; resuming restores the mic to its state before the pause.

## Streaming

- The `Room` interface in `src/multiplayer.ts` gains `addStream(stream, to?)` and `onPeerStream(cb: (stream, peerId) => void)`. `trysteroRoom` maps them to Trystero's `room.addStream(stream, { target })` and `room.onPeerStream`.
- After joining, the mic stream is added for everyone in the room. Trystero only sends a stream to peers present when it is added, so `Multiplayer` also adds it for each peer on its `onPeerJoin`, targeted at that peer.
- An incoming stream belongs to its peer: `Multiplayer` forwards it to `Voices.add(peerId, stream)`. When the peer leaves or times out, `Voices.remove(peerId)` disconnects its nodes.
- Opus at the browser's default voice bitrate (about 30 kbps) per peer per direction. Everyone sends to everyone, which suits a handful of visitors, like the poses.

## Sound (`src/voice.ts`)

`Voices` owns the incoming voices and the local mic. It is created with `Sound`'s audio context and master input, so voices obey M and pause like every other sound.

Each peer's voice:

```
MediaStream ─► MediaStreamAudioSourceNode ─┬─► AnalyserNode (level, for the mouth)
                                           └─► GainNode (walls) ─► BiquadFilter lowpass (walls) ─► PannerNode ─► voice bus ─► master
```

- Chrome only feeds a remote WebRTC stream into Web Audio if the stream is also playing in a media element. Each voice therefore also plays in a muted, detached `<audio>` element.
- The panner is HRTF, `distanceModel` `inverse`, `refDistance` 1.5 m, `rolloffFactor` 1.2, `maxDistance` 15 m (the voice stays at its quietest beyond that). It is placed at the animal's head every frame, from the same smoothed pose the avatar uses, so a voice moves with its animal.
- The voice bus has its own level, `CONFIG.multiplayer.voice.level`.

## Walls and doors

- Ten times a second for each voice (`CONFIG.multiplayer.voice.occlusionRate`), a ray runs from the listener's ear (the camera) to the speaker's head, against `world.occluders`, the meshes that cast the sun's shadows: walls, doors and furniture, everything but glass. Voices pass through glass unmuffled. The meshes already have BVH bounds trees, so the rays are cheap.
- Hits closer than 0.3 m to each other count as one, so a wall counts once whether its meshes are single- or double-sided. The count is capped at 3. Tall furniture in the way (a wardrobe, kitchen cabinets) counts too. That is accepted: it muffles a little, as it would.
- A door's node turns as it opens, so an open door is out of the ray's way and a closed one is in it, without any door logic.
- `occlusionFor(walls)` (pure, tested) gives the gain and the low-pass cutoff:

  | walls | gain | cutoff |
  | --- | --- | --- |
  | 0 | 1 | 20 kHz (open) |
  | 1 | 0.5 | 1800 Hz |
  | 2 | 0.25 | 900 Hz |
  | 3 | 0.12 | 500 Hz |

  The table is `CONFIG.multiplayer.voice.walls`.
- Gain and cutoff ramp to their new values over 0.15 s (`CONFIG.multiplayer.voice.occlusionFade`), so stepping through a doorway glides from muffled to clear.

## Talking animals

- Each voice's analyser gives an RMS level every frame. `talkLevel(rms)` (pure, tested) maps it to 0..1 between a noise floor and a full level (`CONFIG.multiplayer.voice.talk`). `smoothTalk(prev, next, dt)` rises fast (about 0.03 s) and falls slower (about 0.12 s), so a mouth snaps open and closes gently. The level is measured before the walls, so a muffled voice still moves its mouth.
- `Avatars.setTalk(id, level)` stores it, and the figure shows it:
  - Each animal gets an open mouth: a dark ellipse on the face disc (a new `FACE_COLOURS.mouth`, a deep red-brown), inside the smile or grin, scaled from flat to open by the level. The bunny's existing little open mouth scales the same way.
  - The head nods a little with the level (up to 0.06 rad), on top of the existing tilt.
- The "With …" line marks whoever is talking: a small speaker glyph after the name while the level is above a threshold (`CONFIG.multiplayer.voice.talk.shown`), held for 0.5 s so it doesn't flicker.
- Your own animal isn't drawn (first person), so nothing shows your own talking.

## Config (`CONFIG.multiplayer.voice`)

`level` (voice bus), `refDistance`, `rolloff`, `maxDistance`, `occlusionRate`, `occlusionFade`, `mergeHits` (0.3 m), `walls` (the table above), `talk: { floor, full, rise, fall, shown, hold }`, `nod`.

## Files

- Create `web/src/voice.ts`: `Voices` (mic, per-peer graph, panner positions, occlusion, levels) and the pure helpers `occlusionFor`, `countWalls` (merging hits), `talkLevel`, `smoothTalk`. Tests in `web/tests/voice.test.ts`, with the pure helpers tested directly and `Voices` against a fake audio context.
- Modify `web/src/multiplayer.ts`: `Room.addStream` and `Room.onPeerStream`, in `trysteroRoom` too; `Multiplayer` adds the mic for each peer that joins, and hands incoming streams and departures to `Voices`. Tests in `web/tests/multiplayer.test.ts`, with the fake room.
- Modify `web/src/avatars.ts` and `web/src/creatures.ts`: `setTalk`, the open mouth, the nod.
- Modify `web/src/sound.ts`: expose the context and the master input for `Voices`.
- Modify `web/index.html`, `web/src/ui.ts`, `web/src/style.css`: the checkbox, the mic button and mark, "V" in the controls list, the speaker glyph in the "With …" line.
- Modify `web/src/main.ts`: ask for the mic on start, create `Voices`, pass the occluders, V and the touch button, pause, the per-frame update. `world.occluders` (unchanged) are the occluders.
- Modify `web/src/config.ts`: `CONFIG.multiplayer.voice`.
- Modify `README.md` and `2026-10-25-multiplayer-design.md` (a pointer to this note).

## Testing

- Unit: `occlusionFor`, `countWalls`, `talkLevel`, `smoothTalk`; the mic added for late joiners and streams routed to `Voices` (fake room); `Voices` creating and tearing down a peer's nodes and toggling the mic (fake audio context); the mouth opening with `setTalk`.
- In the browser: two tabs, where the mic is replaced with a generated tone (an oscillator into a `MediaStreamAudioDestinationNode`, through a `?debug` hook). Check that the other tab's level for that peer rises and its animal's mouth opens, that a wall between the two lowers the gain and cutoff, and that V silences it.
- With real people: two devices, by ear. Not part of automated checks.

## Limits

- Everyone sends to everyone: a handful of visitors, as before.
- Echo cancellation copes with laptop speakers, but headphones sound better.
- Safari asks for mic permission on each visit unless the site is allowed in its settings.
- No voice activity detection on the sending side: an open mic sends silence or room noise. Noise suppression keeps it low.
