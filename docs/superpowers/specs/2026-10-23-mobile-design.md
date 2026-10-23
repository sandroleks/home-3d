# Phones and Tablets — Design

**Date:** 2026-10-23
**Status:** Implemented

## Goal

The walkthrough runs on phones and tablets instead of showing a "best viewed on desktop" notice. Desktop behaviour stays as it was.

## Which devices

`isTouchOnly` (coarse pointer and no fine one) decides at load: phones and tablets get touch mode (`body.touch`); touch laptops and iPads with a trackpad keep the desktop controls.

## Controls (`src/touch.ts`)

- Pointer events on the canvas (`touch-action: none`), so two thumbs work at once.
- A touch that starts on the left half (`CONFIG.touch.stickArea`) becomes a floating stick centred where it went down. The push is analog: nothing inside the dead zone, full walking speed at the ring, running past 1.5 radii (the ring turns gold). `Player.stick` feeds `moveDelta` alongside the keys; keys win when both are used.
- A touch on the right half drags the view, mouse-style (drag left to turn left), at `lookSensitivity` radians per CSS px.
- A touch that moves less than 10 px and lifts within 300 ms is a tap, wherever it lands. A tap uses the door or switch under the finger (`Interactions.tap`, the same raycast and distance as the crosshair). The crosshair and its prompt stay as a hint, reading "Tap: open door".
- No pointer lock: start, pause and resume don't wait for it. The page pauses when it goes to the background.

## Screen

- A button bar at the top right replaces the keys: show or hide the sun panel, room light (L), sound (M), pause (Esc). The light button is disabled in rooms without a light.
- The sun panel is hidden until its button is pressed, then opens under the bar with larger buttons. Its Tab hints don't show.
- The start screen lists the touch controls instead of the keys and reads "Tap to explore".
- The canvas follows its own size (`ResizeObserver`), safe-area insets keep the HUD clear of notches, and a screen held upright widens the vertical field of view so at least 50° shows across (`CONFIG.minHorizontalFov`).
- Android goes fullscreen on start and on resume; iPhones don't support it.

## GPU memory

The lightmaps decode to about 290 MB, more than many phones give a page. In touch mode:

- `shrinkLightmap` (`src/shrink.ts`) halves every lightmap over `CONFIG.touch.maxLightmapSize` (1024) on the GPU as it loads: each output texel averages its 2×2 block as decoded light, skips empty texels outside UV islands (so island edges don't darken), grows islands by one texel, and re-encodes RGBM with the same range. The original is freed. Lighting-only renders of the Sala, kitchen and bedroom viewpoints match the full-size maps to a mean of 0.2/255.
- The sun's shadow map is 2048 px (`CONFIG.touch.shadowMapSize`) instead of 4096.

On every device, each lightmap's decoded ImageBitmap is closed once it's on the GPU (lightmaps never re-upload), which frees the CPU-side copy.
