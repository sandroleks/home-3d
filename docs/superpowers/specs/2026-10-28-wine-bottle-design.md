# Wine Bottle — Design

**Date:** 2026-10-28
**Status:** Implemented

## Goal

A bottle of red wine in the kitchen that every visitor can drink from. Drinking makes you drunk: your view wobbles and blurs, more the more you drink, and wears off with time. The others see your animal sway. A first taste of piece D in the party plan (`2026-10-28-party-host-guest-list-design.md`), without glasses to carry.

Not in this: a sound or a message for the blackout, a bottle that empties or is shared, glasses to pick up or clink, holding a drink on your animal, drunk walking (the keys still walk straight), sobering up on a reload being prevented.

## The bottle

- Built in code, like the dining table's game sets: a lathe-turned bottle (dark green glass, a cream label, a deep red capsule) and a short wine glass with a little wine in it beside it. Matcap materials dimmed with the light where they stand, as the table sets are (`TableMaterials`, `figureLight`).
- It stands on the back counter between the sink and the hob: x −2.95, z 4.3, on the worktop at 0.90 m. That counter is the same in both kitchens (measured in both exports), so the bottle is there with the wall up or down. All in `CONFIG.wine`.
- Hidden in `?autostart` reference views, like the game sets: the Cycles renders have no bottle.
- A target the crosshair finds (`kind: 'wine'`): it highlights, and the prompt reads "Click: drink some wine" (Tap on touch). Each click or tap is a sip: the bottle lifts, tips toward you and sets back down over about a second, with a click sound. Clicking again mid-sip is a sip too.
- It never runs out, and nothing about it is shared: each visitor drinks from their own.

## Getting drunk

- `Drunk` (`src/drunk.ts`) holds a level: each sip adds `CONFIG.wine.sip` (0.25), up to `CONFIG.wine.max` (1.5). It falls by `CONFIG.wine.soberRate` a second (1/180: three minutes from fully drunk to sober), never below 0. The effects follow `min(1, level)`: four sips is fully drunk, more keeps you there longer.
- Pure and time-driven (`update(dt)`), so tests can drive it. It wears off while paused too.

## Blacking out

- Drinking too fast blacks you out: a sip that makes more than `CONFIG.wine.blackout.sips` (10) within `window` seconds (120). `Drunk.sip()` returns true for it; the level goes to the most (1.5), and the count of recent sips starts over.
- The view fades to black over `fade` s (1.5), stays black `hold` s (4) and comes back over `wake` s (2.5): a CSS `brightness()` after the blur, on the canvas alone, so the HUD stays readable. `Drunk.darkness` is 0..1 along it.
- From the sip until the view starts coming back (`Drunk.passedOut`), the player is frozen: no walking, sitting, standing or drinking. Once it is black, you sink to the floor where you stood (the floor sit C gives, so the others see your animal sitting there), and you come to sitting, fully drunk; moving gets you up. Already sitting, you stay where you are.

## Your screen

- **Wobble:** the camera rolls and sways in a slow, irregular way (two sines each, at unrelated frequencies), and the view drifts a little in yaw and pitch on top of where you look. It goes on the camera after `Player.update` sets it, so it never feeds back into the player's own yaw and pitch. The crosshair picks with the wobbled camera, so aiming is harder. Amplitudes and speeds in `CONFIG.wine.wobble`.
- **Blur:** a CSS `filter: blur(…)` on the canvas, up to `CONFIG.wine.blur` px (3) at fully drunk, also pulsing gently. The browser composites it, so no render pass is added to the frame, and the filter is removed outright while sober (not set to `blur(0px)`).
- Reference views (`?view=`, `?autostart`) never get drunk: there is no bottle to click.

## The others see it

- The pose message gets an optional 8th number, the drunkenness (0..1, rounded like the rest), sent only while it is above 0: `[x, z, yaw, pitch, seat, seatY, seatYaw, drunk]`. Standing, the seat fields are 0, which `splitPose` already reads as standing.
- `isPose` accepts 4, 7 or 8 numbers; `splitPose` returns `drunk` (0 when absent). As drunkenness changes the pose differs, so it is sent at the pose rate while it changes.
- The animal sways: the whole figure tilts side to side and a little forward and back, and its body rolls, scaled by the drunkenness, eased like the rest of the pose so it doesn't jump. Sitting or lying, the sway is halved.
- A visitor on an older version rejects an 8-number pose, so a drunk visitor's animal stands still for them until it sobers up. The same kind of break as when seats were added; everyone gets the new version on their next load.

## Testing

- `drunk.test.ts`: the eleventh sip within the window blacks out and older sips don't count; the darkness fades in, holds and fades out, and the count starts over; the filter darkens to black;
  sips add up and cap, the level wears off at the rate and stops at 0, the effect strength is `min(1, level)`, the wobble is zero when sober and bounded when drunk, the blur filter string is empty when sober.
- `presence.test.ts`: an 8-number pose encodes and parses, a standing drunk pose splits as standing with its drunkenness, a sober pose stays 4 or 7 numbers.
- `interactions.test.ts`: the wine prompt.
- In the browser: the bottle on the counter in both kitchens, the prompt, sipping, the wobble and blur, and wearing off.
