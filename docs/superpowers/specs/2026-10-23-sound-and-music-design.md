# Sound and Music — Design

**Date:** 2026-10-23
**Status:** Approved in brainstorming, awaiting spec review

## Goal

Give the walkthrough sound: doors, light switches, footsteps, per-room ambience, and a quiet background music loop. It should make the apartment feel inhabited without getting in the way of looking around.

## Scope

**In:** door creak and latch, switch click, footsteps, room ambience with crossfades, looping calm piano / lo-fi music, a single mute key.

**Out:** volume sliders or a settings menu, separate music/effects toggles, reverb per room, occlusion through walls, sounds for anything other than doors and switches, mobile (still unsupported).

## Audio files

- All in `web/public/assets/audio/`, MP3 (plays in every supported browser, including Safari).
- CC0 only. Sound effects from Kenney's CC0 packs where they fit. Ambience and music from CC0 sources (OpenGameArt, Freesound CC0 filter, or similar).
- `web/public/assets/audio/CREDITS.md` lists every file with its source URL, author and licence.
- Each download is confirmed with the user before it happens.
- Budget: about 6 MB for all audio together. Music is mono or low-bitrate stereo (≤ 128 kbps), ambience loops ≤ 30 s each.
- Files:
  - `door-open.mp3`, `door-close.mp3` (creak / swing), `door-latch.mp3` (thud when a door finishes closing)
  - `switch.mp3`
  - `step-1.mp3` … `step-4.mp3` (one surface, several variations)
  - `ambience-outdoor.mp3` (birds, distant street), `ambience-kitchen.mp3` (appliance hum), `ambience-room.mp3` (quiet room tone, faint city)
  - `music.mp3` (seamless loop)

Audio is not part of the 30 MB first-view budget: it loads after the start click.

## Architecture

three.js's own audio classes (`AudioListener`, `Audio`, `PositionalAudio`, `AudioLoader`) on top of Web Audio. No new dependency.

### `src/audio.ts` — pure logic (unit-tested)

- `StepTimer`: fed the distance actually travelled each frame and whether Shift is held. Returns `true` when a step should sound. Stride 0.7 m walking, 0.9 m running (running steps come faster in time because the speed doubles). Resets when the player stops, so the first step after standing still sounds after a short distance (0.25 m), not a full stride.
- `ambienceFor(roomId)`: looks up `CONFIG.roomAmbience` (`varanda`, `marquise` → `outdoor`; `cozinha`, `lavandaria` → `kitchen`; anything else, and `null` → `room`).
- `doorEvents(prevTarget, prevProgress, door)`: compares a door's state with the previous frame and returns `'open' | 'close' | 'latch' | null`. `open`/`close` when `target` changes; `latch` when `progress` reaches 0 from above.

### `src/sound.ts` — Web Audio wiring (checked in the browser)

A `Sound` class created once in `main.ts`:

- An `AudioListener` attached to the camera. Three gain buses (effects, ambience, music) into the listener's master gain.
- `load()`: fetches and decodes all files in parallel. Any failure logs a warning and that sound stays silent, the same as the room light maps. Never blocks or fails the walkthrough.
- `door(node, kind)`: plays `door-open` / `door-close` / `door-latch` as a `PositionalAudio` at the door node's world position.
- `click(node)`: plays `switch` positioned at the switch node.
- `step(running)`: plays a random `step-N` (never the same twice in a row), non-positional, playback rate 0.92–1.08 and gain 0.8–1.0 at random.
- `setRoom(roomId)`: crossfades to `ambienceFor(roomId)` over 1.5 s. All three ambience loops play continuously; only their gains move.
- Music loops on the music bus at a low level (gain about 0.25).
- `setMuted(on)`: ramps the master gain to 0 / 1 over 0.2 s.
- `setPaused(on)`: suspends / resumes the `AudioContext`.

Starting levels (tunable in `CONFIG.audio`): effects 0.8, footsteps 0.35, ambience 0.4, music 0.25.

### `main.ts` integration

- `Sound` is created inside the start handler (the click is the user gesture browsers require), then `load()` runs in the background.
- With `?autostart` (including `?view=` reference renders) no `Sound` is created: those stay silent.
- Each frame: run `doorEvents` per door and play what it returns; feed `StepTimer` the distance the player actually moved (so walking into a wall is silent); call `setRoom(currentRoom)`.
- Switch click: `Interactions.click()` returns the activated target so `main.ts` can call `sound.click(node)`. The L key plays the click at that room's switch node.
- Pause / resume calls `setPaused`.

## Mute

- **M** mutes or unmutes everything (music, ambience, effects). Ignored while paused or before starting.
- Remembered across visits in `localStorage` (`walkthrough.muted`), read and written inside try/catch.
- While muted, a small speaker-with-slash icon shows in the bottom-right corner of the HUD.
- The start screen's controls list gains `<kbd>M</kbd> mute sound`.

## Testing

- Vitest unit tests in `web/tests/audio.test.ts` for `StepTimer`, `ambienceFor` and `doorEvents`.
- In the browser: start the walkthrough, open and close a door, flip a switch, press L, walk (and walk into a wall), move between the Sala and the Varanda, press M, reload to check mute is remembered, press Esc. Check the console has no audio errors and the network panel shows the audio loading only after the start click.
- `npm run build` passes (types).
