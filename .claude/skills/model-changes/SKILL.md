---
name: model-changes
description: Change what visitors see in the apartment walkthrough — the 3D model, furniture, walls, doors, lights, materials, colours, brightness, the view through the windows, door/switch placement or spawn point — and get it exported, checked and live. Use this whenever the user asks to move, add, remove, recolour, relight or otherwise alter anything in the apartment or the viewer's look, asks whether a change needs Blender, wants to re-export or re-bake, or wants the site updated with a new version of Untitled.blend, even if they don't mention Blender or the export.
---

# Changing the model and the visuals

The human-facing version of this workflow is `docs/changing-the-model.md`. Read it when you need the detail on a step; this file is the order to work in and the traps to avoid.

## 1. Decide where the change lives

Lighting and surface colours are baked in Blender into lightmaps and textures that fit the exact geometry and UVs they were baked on. So:

- **Viewer only (no Blender, no export):** overall brightness/contrast (`exposure`, `lightmapScale`, `envIntensity` in `web/src/config.ts`; tone mapping in `web/src/main.ts`), sky colour, FOV, speeds, timings, reach, on-screen room names (`roomNames`), glass look (`makeGlass` in `web/src/scene-setup.ts`).
- **Viewer material trial:** a tint or texture swap can be done in `prepareMeshes` (`web/src/scene-setup.ts`) keyed by material name. Tell the user the bounced light stays baked with the old colour, so a large change looks slightly off until the change is made in Blender and re-baked. Offer it as a quick preview, not the final fix.
- **Pipeline overrides (re-export, no model edit):** light switch position (`SWITCH_OVERRIDES`), door hinge/swing (`DOOR_OVERRIDES`), expected door count, bake quality — all in `blender/pipeline/config.py`.
- **Blender (re-export):** geometry, furniture, lights, sun, real material changes, cameras (spawn is `Cam_Entrada`; viewpoints `Cam_Sala`, `Cam_Kitchen`, `Cam_Bedroom`), the neighbourhood (`Exterior - neighbourhood`).

Never edit `web/public/assets/` by hand: it is all generated and the next export overwrites it.

If it's unclear which bucket a request falls into (e.g. "make the living room cosier"), say what each option would change and let the user pick before touching anything.

## 2. Edit the model (Blender route)

The source file is `~/Documents/Untitled.blend`. The user may edit it by hand; otherwise drive their running Blender through the `blender` MCP tools.

1. `get_addon_status`, then `get_scene_info`. Confirm with `execute_blender_code` that `bpy.data.filepath` is `~/Documents/Untitled.blend`. If a different file is open, stop and ask — edits to the wrong file never reach the export.
2. Go to the final frame first (`scene.frame_set(scene.frame_end)`). The export uses the final frame of the build-up animation. If an object you move has `animation_data`, update its keyframes too, or the animation will put it back.
3. Make the change with `execute_blender_code`. Follow the MCP server's rules (find nodes by type, read enum values rather than hardcoding them).
4. Keep the names the pipeline relies on (README, "Naming the pipeline relies on"): `Floor - <Room>`, `Ceiling light <Room>`, `Door N (A / B) lintel`, `Glazed Door N …`, `Door N infill`, `Door leaf N`, the `Cam_*` cameras. New objects copied from existing ones get `.001` suffixes; check that doesn't turn a door part into something the export ignores, or vice versa. Adding or removing an interactive door means updating `EXPECTED_DOOR_COUNT`.
5. If you add image textures, pack them (`bpy.ops.file.pack_all()`); the export runs on a staged copy and can't follow external paths.
6. Show the result with `look` and ask the user if it's right. Only then save (`bpy.ops.wm.save_mainfile()`). Saving overwrites their source file. The earlier version is then only in Blender's `.blend1` backup and in the `Untitled.blend` committed to the repo.

Do not use the MCP Blender to export, render, or open or write files in the project. The Makefile stages everything in `/private/tmp` for a reason: a Blender launched from Claude that reaches into `~/Documents` makes macOS block the session's file access. Exports always go through `make`.

## 3. Export

From the project root (in a worktree, that's the worktree root):

```bash
cp ~/Documents/Untitled.blend .
make export-preview
```

- `export-preview` (~1 min) to check a change. Run it first.
- `export-surroundings` (~30 s) when only the neighbourhood changed; no bake, other assets untouched.
- `export-final` (~35 min on GPU) for what gets published. Run it in the background and tell the user it's running. Don't start it until the user has seen the preview and agreed. If the GPU bake hangs, the user quits Blender and retries, or use `WEB_BAKE_DEVICE=CPU make export-final` (much slower).

Read the end of the output. `Export OK` means assets were replaced; `EXPORT CHECKS FAILED` lists reasons and leaves the old assets in place. Usual causes: a renamed object, a door count mismatch, an unpacked texture. Fix the cause rather than loosening a check.

## 4. Check

1. If rooms, doors or switches could be affected, read `build/debug_map.png` (red = closed door, green = open door, blue = switch, yellow = spawn). Fix misplaced doors or switches with the overrides in `blender/pipeline/config.py` and re-export.
2. If `web/node_modules` is missing (fresh worktrees), run `npm ci` in `web/` first. Open the viewer with `preview_start` (`walkthrough` in `.claude/launch.json`) at a viewpoint near the change, e.g. `http://localhost:5173/?view=Cam_Sala&autostart`, and screenshot it for the user. `?debug=lightmap` isolates the baked lighting when something looks too dark or blotchy.
3. For a lighting question, `make render-refs` renders the viewpoints in Cycles into `build/ref/` for side-by-side comparison.
4. Run `make web-test` if viewer code changed, `make test-blender` if pipeline code changed.

## 5. Publish

Only final-quality assets go live; never commit preview-export assets. After `make export-final`, commit `Untitled.blend` and the changed files in `web/public/assets/` (together, so the repo's `.blend` matches the assets), when the user asks for a commit. Commit messages start with the area, e.g. `Assets: re-export with the sofa moved (final quality)`. Pushing to `main` redeploys on Vercel; that goes through a PR unless the user says otherwise.
