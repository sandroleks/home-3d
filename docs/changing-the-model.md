# Changing the model and the visuals

How to change what visitors see in the walkthrough. Start by working out which kind of change it is, because that decides whether Blender and a re-export are needed.

## Which kind of change is it?

The lighting is baked in Blender (Cycles) into lightmaps, and each lightmap fits the exact geometry and UVs it was baked on. Surface colours are baked into textures too. Anything that changes geometry, lights or materials therefore goes through Blender and a re-export. Anything about how the viewer *displays* those assets can be changed in the web code alone.

| You want to… | Where | Re-export? |
| --- | --- | --- |
| Make the whole scene brighter or darker, change contrast, sky colour, field of view | `web/src/config.ts` (`exposure`, `lightmapScale`, `envIntensity`, `skyColor`, `verticalFov`), `web/src/main.ts` (tone mapping) | No |
| Change walking speed, mouse sensitivity, door or light-fade timing, how far you can reach | `web/src/config.ts` | No |
| Rename rooms on screen | `roomNames` in `web/src/config.ts` | No |
| Change how glass looks | `makeGlass` in `web/src/scene-setup.ts` | No |
| Tint or swap one material, as a quick trial | Code in `prepareMeshes` (`web/src/scene-setup.ts`), keyed by material name | No, but see the caveat below |
| Move, add or remove walls, furniture, doors or windows | Blender | Yes |
| Change a light, the sun, or a material for real | Blender | Yes |
| Change the neighbourhood seen through the windows | Blender (`Exterior - neighbourhood` collection) | Only `make export-surroundings` (about 30 seconds) |
| Move a light switch, flip a door's hinge or swing | `SWITCH_OVERRIDES`, `DOOR_OVERRIDES` in `blender/pipeline/config.py` | Yes |
| Change where visitors start or the viewpoints | The `Cam_Entrada` / `Cam_Sala` / `Cam_Kitchen` / `Cam_Bedroom` cameras in Blender | Yes |

**Caveat for material changes in the viewer.** The light bouncing off a surface was baked with its old colour. A subtle tint looks right. A big change (a white wall turned deep red) won't colour the walls and floor next to it the way it would after a re-bake. Use viewer-side material changes to try ideas out, then make the real change in Blender.

**Don't hand-edit `web/public/assets/`.** `manifest.json`, `collision.json`, the `.glb` files and the lightmaps are all generated, and the next export overwrites them.

## Changing the model in Blender

There are two ways to make the edit. Either way the result is the same: an updated `~/Documents/Untitled.blend`.

**By hand.** Open `~/Documents/Untitled.blend` in Blender, make the change, save.

**With Claude.** With Blender open and the MCP add-on running, ask Claude in this project for the change, for example "move the sofa 50 cm towards the window" or "make the kitchen ceiling light warmer". Claude edits the open scene, shows you a render of the result, and saves once you're happy with it. The project skill in `.claude/skills/model-changes/` holds the steps Claude follows.

Things that keep the export working, whichever way you edit:

- **Keep the names the pipeline relies on** (floors, doorways, door parts, ceiling lights, cameras). The full list is in the README under [Naming the pipeline relies on](../README.md#naming-the-pipeline-relies-on). A rename can silently drop a room, door or switch.
- **Pack external textures:** File > External Data > Pack Resources. The export runs on a copy elsewhere and can't follow links to image files.
- **Mind the build-up animation.** The export uses the scene's final frame. If you move an object that is keyframed, the animation puts it back unless you update its keys, so check your change on the last frame.

## Exporting

Copy the saved file into the project, then export from the project folder:

```bash
cp ~/Documents/Untitled.blend .
```

| Command | Time | Use it for |
| --- | --- | --- |
| `make export-preview` | about 1 minute | Checking a change. Low-quality lighting. |
| `make export-final` | about 35 minutes on the GPU | What gets published. |
| `make export-surroundings` | about 30 seconds | Only the view through the windows changed. |

The export never writes to either `.blend`. It runs Blender on a staged copy in `/private/tmp` with factory settings, so your add-ons don't load.

The export checks its own output. It ends with `Export OK` or with `EXPORT CHECKS FAILED` and the reasons. When it fails, the previous assets stay as they were. The usual causes are a renamed object (see the naming list), a door count that no longer matches `EXPECTED_DOOR_COUNT` in `blender/pipeline/config.py` after adding or removing a door, and an unpacked texture.

If the GPU bake hangs, quit Blender and try again, or bake on the CPU (much slower):

```bash
WEB_BAKE_DEVICE=CPU make export-final
```

## Checking the result

1. **Floor plan.** Open `build/debug_map.png` after any change to rooms, doors or switches. Red is a closed door, green an open door, blue a light switch, yellow the spawn point. If a switch or door is in the wrong place, fix it with the overrides in `blender/pipeline/config.py` and export again.
2. **In the viewer.** `cd web && npm run dev`, then open http://localhost:5173. Useful URL options:
   - `?view=Cam_Sala&autostart` (or `Cam_Kitchen`, `Cam_Bedroom`) jumps straight to a viewpoint.
   - `?debug=lightmap` shows the baked lighting alone, without textures. Useful when something looks too dark or blotchy.
3. **Against Blender.** `make render-refs` renders the three viewpoints in Cycles into `build/ref/`. Compare them with the same `?view=` in the viewer.
4. **Tests,** when code changed: `make web-test` for the viewer, `make test-blender` for the export pipeline.

## Publishing

Only a final export goes live; preview assets are for checking. After `make export-final`, commit `Untitled.blend` and the changed files in `web/public/assets/`, then push. Every push to `main` redeploys the site on Vercel. Commits in this repo start with the area, for example `Assets: re-export the model (final quality)`.
