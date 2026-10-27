# A desk for Oksana in the Sala — Design

**Date:** 2026-10-27
**Status:** Implemented in the model (`blender/tools/sala_desk.py`)

## Goal

A small workplace in the Sala for Oksana: a desk, an office chair, and an iMac with its keyboard and mouse. It has to work with the kitchen as it is now (walled off) and with the open plan, so it can't lean on the kitchen wall.

## Where

In the window corner, against the short wall to the left of the Sala's window (the wall the Marquise is behind). Oksana faces that wall, with the window on her left: daylight from the side and no glare on the screen. The window faces roughly north-west, so direct sun only comes in on late summer afternoons.

Other spots were measured and set aside:

- Sliding the whole corner sofa towards the dining table: the desk and chair need about 1.35 m along the room, and the two walkways (storage wall to dining chairs, dining chairs to sofa) only add up to 1.43 m.
- The east wall between the dining table and the TV (with the table 35 cm west): it works, but the iMac sits next to the TV in the sofa's view.
- The storage wall's niche as a built-in desk (with the drawers under it removed and the table 20 cm south): the darkest spot, with her back to the dining table and narrower walkways.

## What changes

**The sofa loses the L.** The section along the window goes: its base, plinth, back frame, seats (the corner one too), back cushions and the arm at its end. The long part stays where it is, against the kitchen side, and gains a south arm like its north one, 20 cm past the seats, so it is a straight sofa about 2.8 m long (y −4.90 to −7.70). The back frame and plinth are cut to that length. The cushions that sat on the return move to the long part. The sofa bed still opens towards the TV as before (the hidden `Sala - sofa bed (opened)` collection lay over the long part already).

**The desk corner** (new collection `Sala - desk by the window`, inside `Furniture - Sala`):

- Desk: 95 × 60 cm, 75 cm high, light oak top on slim black steel legs, against the wall and the window wall.
- iMac 24" (54.7 × 46.1 cm, 14.7 cm deep stand) against the wall, in blue. Its screen is a `web_screen = "monitor"` like the office's, so it switches on with a click and casts baked light (lamp group `sala/monitor`). No pipeline or viewer changes are needed: screens are keyed by room and kind.
- Magic Keyboard and Magic Mouse in front of it, the mouse on her right.
- An office chair: a copy of the Quarto 02 office chair, turned to face the desk, half tucked in.
- A wall socket under the desk.

Nothing else moves: the coffee table, TV, plant, rug, dining table and floor lamp stay. Both kitchen variants show the desk, since it is in `Furniture - Sala`.

## Checks

- Renders of the corner from the Sala and from the sofa, before saving.
- `make export-preview`, then the walkthrough at `?view=Cam_Sala&autostart`, and the iMac switching on.
- The export's own checks (screens, lamp groups, packs). If the new `sala/monitor` group pushes the Sala over `MAX_PACKS`, drop the iMac's baked light rather than raising the limit.
- The final exports (main and `kitchen-wall`) only after the preview has been seen.
