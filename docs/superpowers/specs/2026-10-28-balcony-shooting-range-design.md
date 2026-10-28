# Balcony Shooting Range — Design

**Date:** 2026-10-28
**Status:** Implemented

## Goal

A shooting range on the Varanda, the balcony off the office (Quarto 02): pick up a rifle, press the big red Start button, and shoot clay pigeons and bonus targets flying over the street. Everyone holding a rifle competes in the same 60 s round for the same targets, with a shared scoreboard, in the same Trystero room as the multiplayer, no server.

Not in this: a scope or zoom, bullet drop, your animal holding a rifle, ammo limits, a high-score table that outlives the round, other ranges or rooms, birds as targets.

## The balcony

- The Varanda's floor runs x 0.33–3.135, z −9.08 to −7.51 (viewer coordinates); its open side, the railing, faces −z, out over the street. The targets fly beyond it.
- Built in code, like the wine bottle and the table's game sets (matcaps dimmed with the light where they stand, `TableMaterials`, `figureLight`):
  - **The rack:** a small wooden stand at the railing with a rifle resting on it. Prompt "Click: pick up the rifle" ("Tap: …" on touch); with a rifle in hand, "Click: put the rifle back".
  - **The Start button:** a big red mushroom button on a short post beside the rack. Prompt "Click: start a round"; while a round runs it is lit and reads "A round is on".
- Where they stand, at the railing's end where they don't block the balcony door, is `CONFIG.range.rack` and `CONFIG.range.button`, chosen against the model.
- Hidden in `?autostart` reference views, like the game sets: the Cycles renders have no rack.

## The rifle

- Clicking the rack gives you a rifle of your own; everyone gets one and the rack never empties (the one on it stays, as the wine bottle never empties).
- **Held in view:** a simple rifle (stock, receiver, barrel, iron sights) at the bottom right of the screen, drawn over the scene so it never clips into the railing. You aim with the crosshair; no zoom.
- **Firing:** a click fires (on touch, a **Fire** button shows while you hold the rifle). Each shot has a bolt cycle of `CONFIG.range.cycle` (0.6 s) before the next; clicks during it do nothing. A shot kicks the rifle back and up and flashes at the muzzle. The shot's sound is made in code: a short filtered noise burst with a fast decay through the Web Audio graph `sound.ts` already has, placed where the shooter stands. No new audio files.
- **While you hold it,** clicks fire instead of opening doors, using switches, sitting or drinking; only the rack and the Start button still take a click (with the crosshair on them, a click puts the rifle back or starts a round, it doesn't fire). Moving still works, but only on the balcony: stepping off the Varanda puts the rifle back (as does clicking the rack again). Esc and Tab free the mouse with the rifle still in hand. C (sit) puts it back first.
- Drunk, the wobble moves the crosshair, so aiming is harder. No special case.

## Targets

- They fly beyond the railing, 12–30 m away and from balcony height up to about 15 m above it, in open air: nothing in the neighbourhood blocks a shot or hides a target.
- Three kinds:
  - **Clay pigeon:** an orange disc, spinning, 10 points. Most of the targets.
  - **Gold clay:** smaller and faster, on a flatter arc, 30 points. About one in eight.
  - **Drone:** a little quadcopter that zig-zags across rather than arcing, slower but erratic, 50 points. Two or three a round.
- Clays launch from below the railing line or from the sides and fly a gravity arc for 2.5–4 s, then fall away out of sight. Drones cross from one side to the other in 5–7 s.
- **Bigger than real:** a clay is about 55 cm (a real one is 11 cm, a few pixels at 30 m), and its hit zone is a sphere a little larger than it looks (radius about 0.85 m) so iron sights are fair. Sizes, hit zones, speeds, points and the mix are all in `CONFIG.range`.
- **The schedule** comes from the round's seed, through a small seeded random generator: single targets about every 1.6 s at first, and from the halfway point pairs launched together; about 45 clays, 6 gold and 3 drones in all. Every browser generates the same flights, so target positions are never sent.
- A target's position is a pure function of the round time: `flightAt(target, t)`.

## Hitting

- A shot is instant along the crosshair (from the camera, along its view, wobble included): no bullet drop or travel time at these distances.
- It hits the nearest target, by distance along the line, whose hit zone the line passes through at the shot's round time, among those in flight and not yet broken. No target: a miss, and nothing lost but the bolt cycle.
- The shooter's browser judges its own shots at once, so hits never lag, and sends the claim to all.
- **One target, one winner:** every browser keeps all claims and gives each target to the earliest by round time, ties to the lower peer id. All of them apply the same rule, so they agree on the scores whatever order the claims arrive in. A hit that turns out a few milliseconds late (two players on the same clay) loses it: the target is already shattered on screen, and the points go to the other player.
- A hit target shatters into a handful of shards that tumble and fall, and "+10" (or 30, 50) floats up from it in the shooter's colour. Everyone sees it, whoever shot it.
- Others' shots draw a brief tracer from where they stand along the shot, and play the shot sound there.
- Targets that get away cost nothing.

## A round

- **Who plays:** everyone holding a rifle. Picking one up during a round joins you on 0; putting it back, leaving the balcony or leaving the flat keeps your points on the board.
- **Start:** anyone holding a rifle can click the button when no round is running. A 3-2-1 countdown (`CONFIG.range.countdown`, 3 s) shows on everyone's screen, then the round runs for `CONFIG.range.length` (60 s). Shooting during the countdown does nothing.
- **During it:** a strip at the top of the screen, for everyone in the flat, shows the time left and the live scores, each shooter in their animal's colour, highest first. The targets show for everyone in the flat, so a visitor at a window sees them too.
- **The end:** the final scores show in the strip, bigger, for 10 s, highest first, ties sharing a place; then the strip goes and the button is ready again. A round with nobody shooting still runs to its end.

## Sharing

- A new message kind, **`range`**. Older visitors ignore it: no targets, no tracers.
- **`arm`**: this visitor picked up a rifle or put it back, with their name, so the board can list shooters still on 0 (and keep their names after they leave). Sent on each change and to each newcomer.
- **`start`**: the round id (random), the seed, the time left until the round ends, the shooters in it, and the claims so far (none for a fresh start; a newcomer's catch-up carries them). Times are sent as time left, as draw and guess does, so no clocks need to agree; each browser turns it into its own clock. A browser accepts a start when no round is running, or when the one it holds is showing its final scores. If two starts cross, every browser applies the same rule: starts within `crossing` ms of each other (2 s; pressed at once) keep the lower round id, and starts further apart keep the one that started earlier, so a running round is never replaced by a later press and a newcomer who pressed Start before hearing the catch-up switches to the earlier round. A start also carries the rifle holders the sender knows, and the receiver adds those it knows itself.
- **`shot`**: the round id, the shooter's round time, where the shot came from, its direction, and the target it hit (its index in the schedule), or none. Sent for misses too, for the tracer.
- **A newcomer**, or a visitor whose tab was hidden, gets the running round and its claims from the earliest-arrived visitor who knows it (the party host's rule, `guests.ts`), as the draw game's leader does.
- A newcomer may hear a hit for a round it hasn't heard of yet (the catch-up arrives after it); it keeps up to `pending` such hits and replays them, without a shatter, when the round arrives.
- A shooter who leaves keeps their score; their claims still count.
- Clock skew between browsers is the network delay (tens of milliseconds), which only matters for two shots at one clay; fine.

## Code

Small pure modules, testable without a scene, and the 3D parts apart from them:

- `src/range-flights.ts`: the seeded generator, the round's schedule from a seed, and `flightAt(target, t)`. Pure.
- `src/range-rules.ts`: the hit test along a ray at a round time, resolving claims (earliest wins, ties to the lower id), the scores, the final places with ties. Pure.
- `src/range-game.ts`: the round's state (countdown, running, final scores), starts and shots in and out, checking messages (`isRangeMessage`), catching up a newcomer.
- `src/range-rack.ts`: the rack, the button and the held rifle (its kick and flash), and their targets for the crosshair.
- `src/range-view.ts`: drawing the targets in flight, the shards, the floating points and the tracers.
- The top strip and the touch Fire button in the existing HUD (`ui.ts`, `index.html`, `style.css`); the shot sound in `sound.ts`; wiring in `main.ts` and `interactions.ts` (new target kinds `rack` and `range-button`); `CONFIG.range` in `config.ts`.
- The README: the controls, the touch controls, and a short Shooting range section.

## Testing

- `range-flights.test.ts`: the same seed gives the same schedule and positions, different seeds differ; the mix and the count are about right; every flight stays within its distance and height band while in flight, and is out of sight at its end.
- `range-rules.test.ts`: a ray through a hit zone hits, one just outside misses; the nearer of two targets on a line is hit; a broken or not-yet-launched target can't be hit; claims resolve the same in any order, ties to the lower id; scores and places with ties.
- `range-game.test.ts`: crossing starts settle on the lower id; a start during a round is ignored; a newcomer's catch-up rebuilds the same scores; malformed messages are rejected.
- `interactions.test.ts`: the rack and button prompts, with and without a rifle, and while a round runs.
- In the browser: the rack and button on the Varanda in both kitchen variants; picking up and putting back (and stepping off the balcony); a full round with the countdown, hits, shatters and the final scores; two tabs competing for the same targets.
- The browser check was done in the preview: the rack and button are placed at the railing's east end; the prompts are right; a full round ran with its countdown, hits (10 and 30 points) and final scores; stepping off the balcony puts the rifle back; and the targets were enlarged after it.
