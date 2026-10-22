"""Stage orchestration: prepare (geometry), bake (lighting), export (files + checks)."""
import os

import bpy

from . import (bake, chunks, checks, collision, config, debug_map, doors, export, manifest,
               openings, proc_materials, rooms, scene_select, state, switches, uvs)


def prepare(scene, quality, out_dir, build_dir, stop_after="uvs"):
    os.makedirs(build_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    # First action: switch to a copy so the source .blend is never written.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(build_dir, "web-export.blend"))

    meshes, day_lights = scene_select.prepare_scene(scene, bpy.context.view_layer)
    floor_index, room_list = rooms.collect_rooms(meshes, scene)
    ctx = {"meshes": meshes, "day_lights": day_lights, "floor_index": floor_index, "rooms": room_list}
    if stop_after == "select":
        return ctx

    ctx["albedo"] = proc_materials.bake_procedural_albedo(meshes, quality)
    if stop_after == "albedo":
        return ctx

    ops, infilled = openings.parse_openings(meshes)
    grid = collision.build_collision(meshes, floor_index, ops)
    export.write_json(os.path.join(out_dir, "collision.json"), grid.to_json(config.PLAYER_RADIUS))
    ctx.update(openings=ops, infilled=infilled, grid=grid)
    if stop_after == "collision":
        return ctx

    leaves = [o for o in meshes if o.name.startswith("Door leaf")]
    door_specs = doors.prepare_doors(leaves, grid, config.DOOR_OVERRIDES)
    ctx["doors"] = door_specs
    if stop_after == "doors":
        return ctx

    sw = switches.place_switches(room_list, ops, infilled, floor_index, grid,
                                 bpy.data.collections["WEB"], config.SWITCH_OVERRIDES)
    ctx["switches"] = sw
    if stop_after == "switches":
        return ctx

    door_names = {d["node"] for d in door_specs}
    static = [o for o in meshes if o.name not in door_names]
    chunk_list = chunks.build_chunks(static, floor_index)
    ctx["chunks"] = chunk_list
    if stop_after == "chunks":
        return ctx

    for c in chunk_list:
        c["size"] = uvs.add_lightmap_uvs(bpy.data.objects[c["node"]], quality.lightmap_texels_per_m,
                                         quality.lightmap_min, quality.lightmap_max)
    for d in door_specs:
        uvs.add_lightmap_uvs(bpy.data.objects[d["node"]], 0, quality.door_lightmap, quality.door_lightmap)

    st = {
        "rooms": room_list, "switches": sw, "doors": door_specs, "chunks": chunk_list,
        "door_lightmap_size": quality.door_lightmap, "day_lights": day_lights,
        "spawn": export.spawn_from(scene, room_list), "viewpoints": export.viewpoints(scene),
    }
    state.save(scene, st)
    switch_points = [(bpy.data.objects[n].location.x, -bpy.data.objects[n].location.y) for n in sw.values()]
    debug_map.save_map(os.path.join(build_dir, "debug_map.png"), grid, door_specs, switch_points, st["spawn"])
    bpy.ops.wm.save_mainfile()
    ctx["state"] = st
    return ctx


def bake_stage(scene, quality, out_dir):
    st = state.load(scene)
    st["ranges"] = bake.bake_all(scene, st, quality, out_dir)
    state.save(scene, st)
    bpy.ops.wm.save_mainfile()


def export_stage(scene, out_dir, expected_doors, budget):
    st = state.load(scene)
    names = [c["node"] for c in st["chunks"]] + [d["node"] for d in st["doors"]] + list(st["switches"].values())
    export.export_glb([bpy.data.objects[n] for n in names], os.path.join(out_dir, "apartment.glb"))
    m = manifest.build_manifest(st, st["ranges"], config.EYE_HEIGHT)
    export.write_json(os.path.join(out_dir, "manifest.json"), m)
    return checks.check_scene(st) + checks.check_outputs(out_dir, m, budget, expected_doors)


def run_all(quality_name, out_dir, build_dir, expected_doors=config.EXPECTED_DOOR_COUNT,
            budget=config.FIRST_VIEW_BUDGET_BYTES):
    quality = config.QUALITY[quality_name]
    scene = bpy.context.scene
    out_dir, build_dir = os.path.abspath(out_dir), os.path.abspath(build_dir)
    prepare(scene, quality, out_dir, build_dir)
    bake_stage(scene, quality, out_dir)
    return export_stage(scene, out_dir, expected_doors, budget)
