# Start screen — Design

**Date:** 2026-10-28
**Status:** Approved in brainstorming

## Goal

A start screen that is calmer and more inviting. Today it is one centred column on an 82% veil: title, progress bar, name, voice, the start button, then all sixteen key bindings at the same weight. The flat behind it barely shows, nothing says whose home it is, and with `overflow: hidden` on the body a short window or a phone in landscape cuts off the top and bottom of the column, start button included.

## Content

One card in the middle of the screen:

- An eyebrow, "Welcome in", over the heading **Sandrolek & Jerry's apartment**.
- An intro line: "Our home, modelled room by room. Open the doors and drawers, switch on the lamps, put a record on, sit on the sofa. Anyone else here now walks it with you."
- The kitchen-wall note, when the wall is up (unchanged).
- The name field and the voice checkbox.
- The start button, with the loading bar inside it: it fills with the accent as the flat loads, then reads "Click to explore" or "Tap to explore". The separate progress bar goes.
- The essentials on one line: `WASD` walk, `Mouse` look, `Click` use, `Esc` pause; on touch, drag left to walk, drag right to look, tap to use.
- "All controls", a `<details>` holding today's full list, grouped: Moving, Using things, Time and light, Sound and voice.
- The error and "Try again" stay in the card.

## Look

- The flat at the spawn shows through a radial vignette, about 35% dark in the middle and 70% at the edges, instead of the flat veil. Pause and notice overlays keep today's veil.
- The card: a dark, see-through panel with a backdrop blur, a fine light border, rounded corners, about 420px wide.
- The heading in the system serif (`ui-serif`, Georgia); the rest in the system sans as today; the existing gold accent.
- No fade-in: while the flat loads the main thread is busy and a fade stalls half-way, leaving the card dim.

## Small screens

The overlay scrolls when the card is taller than the window (centred with auto margins, so a tall card starts at the top instead of overflowing it), and pads for the safe areas. On a phone the card fills the width with a 16px gutter.

## Code

Only `web/index.html` and `web/src/style.css` change. The element ids `ui.ts` uses (`start`, `progress-bar`, `start-button`, `name`, `voice`, `layout-note`, `error`, `retry-button`) stay, so `ui.ts` and `main.ts` are untouched.

## Checking

`npm test` and `npm run build`; then in the browser, a desktop window, a short window (the card scrolls) and a phone viewport (the touch controls show).
