"""Stage orchestration: prepare (geometry), bake (lighting), export (files + checks)."""
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import (bake, bpyutil, chunks, checks, collision, config, debug_map, doors, export, geom, lamps, layers,
               manifest, movables, openings, packs, proc_materials, props, rooms, scene_select, screens, seats, state,
               surroundings, switches, uvs, variants, windows)


def join_leaf_parts(meshes):
    """Parts tagged web_leaf (French door glass) join the door leaf they name. Returns the meshes without them."""
    parts = {}
    for o in meshes:
        if o.get(config.LEAF_PROP):
            parts.setdefault(o[config.LEAF_PROP], []).append(o)
    keep = [o for o in meshes if not o.get(config.LEAF_PROP)]
    names = {o.name for o in keep}
    for leaf, ps in sorted(parts.items()):
        if leaf not in names:
            raise RuntimeError(f"{ps[0].name}: {config.LEAF_PROP} names {leaf!r}, which isn't a kept mesh")
        bpyutil.join([bpy.data.objects[leaf]] + ps, leaf)
    return keep


def glow_specs(objs):
    """Bulbs and LED strips: their own nodes, glowing with the group their (split) materials name."""
    out = []
    for o in sorted(objs, key=lambda o: o.name):
        groups = {s.material.name.rpartition(" @")[2] for s in o.material_slots if " @" in s.material.name}
        if len(groups) != 1:
            print(f"[glows] WARNING: {o.name} glows with {sorted(groups) or 'no group'}; left out", flush=True)
            continue
        o.name = f"Glow_{geom.slugify(o.name)}"
        out.append({"node": o.name, "group": groups.pop()})
    return out


def movable_atlases(movable_specs, quality):
    """One atlas per room: a square grid of tiles, and the bake passes (movables far enough apart)."""
    by_room = {}
    for m in movable_specs:
        if m["room"] is None:
            raise RuntimeError(f"{m['source']}: the movable is in no room")
        by_room.setdefault(m["room"], []).append(m)
    atlas = {}
    for room, ms in by_room.items():
        cols, tile = movables.atlas_columns(len(ms)), quality.movable_tile
        for k, m in enumerate(ms):
            obj = bpy.data.objects[m["node"]]
            uvs.add_lightmap_uvs(obj, 0, tile, tile, margin_px=1)  # drawers with contents are many small islands
            movables.place_in_tile(obj, k, cols, tile)
        passes = movables.passes([m["centre"] for m in ms], config.MOVABLE_PASS_DISTANCE)
        atlas[f"movables-{room}"] = {"cols": cols, "tile": tile, "size": cols * tile, "passes": passes}
        print(f"[movables] {room}: {len(ms)} in a {cols}x{cols} atlas, {len(passes)} bake passes", flush=True)
    return atlas


def prepare(scene, quality, out_dir, build_dir, stop_after="uvs", variant=None):
    os.makedirs(build_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    # First action: switch to a copy so the source .blend is never written.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(build_dir, "web-export.blend"))
    if variant:
        variants.apply_variant(variant, bpy.context.view_layer)

    surroundings.export_surroundings(scene, bpy.context.view_layer, quality, out_dir)  # before prepare_scene deletes them
    seats.export_seats(scene, bpy.context.view_layer, out_dir)  # before prepare_scene joins and deletes meshes
    meshes, day_lights = scene_select.prepare_scene(scene, bpy.context.view_layer)
    floor_index, room_list = rooms.collect_rooms(meshes, scene)
    window_list = windows.exterior_windows(meshes, floor_index)  # before French door glass joins its leaf
    meshes = join_leaf_parts(meshes)
    ctx = {"meshes": meshes, "day_lights": day_lights, "floor_index": floor_index, "rooms": room_list}
    if stop_after == "select":
        return ctx

    ctx["albedo"] = proc_materials.bake_procedural_albedo(meshes, quality)
    if stop_after == "albedo":
        return ctx

    prop_objs = props.find(meshes)  # after the albedo bake: props need theirs like everything else
    prop_set = set(prop_objs)
    ops, infilled = openings.parse_openings(meshes)
    grid = collision.build_collision([o for o in meshes if o not in prop_set], floor_index, ops)  # props never block
    export.write_json(os.path.join(out_dir, "collision.json"), grid.to_json(config.PLAYER_RADIUS))
    ctx.update(openings=ops, infilled=infilled, grid=grid)
    if stop_after == "collision":
        return ctx

    leaves = [o for o in meshes if o.name.startswith("Door leaf")]
    movable_objs, screen_objs = movables.find(meshes), screens.find(meshes)
    glow_objs = [o for o in meshes if lamps.glow_only(o)]
    special = set(leaves) | set(movable_objs) | set(screen_objs) | set(glow_objs) | prop_set
    static = [o for o in meshes if o not in special]
    door_specs = doors.prepare_doors(leaves, grid, config.DOOR_OVERRIDES, ops, infilled)  # may delete leaves
    for d in door_specs:  # whose lamps light each face of the leaf
        d["rooms"] = geom.door_rooms(d["hinge"], d["dir"], d["width"], floor_index.locate)
    ctx["doors"] = door_specs
    if stop_after == "doors":
        return ctx

    sw = switches.place_switches(room_list, ops, infilled, floor_index, grid,
                                 bpy.data.collections["WEB"], config.SWITCH_OVERRIDES)
    ctx["switches"] = sw
    if stop_after == "switches":
        return ctx

    screen_specs = screens.prepare_screens(screen_objs, floor_index)
    ctx["day_lights"] = sorted(ctx["day_lights"] + screens.add_lights(screen_specs, bpy.data.collections["WEB_LIGHTS"]))
    groups, lost_lamps = lamps.collect_groups(scene, room_list, floor_index, ctx["day_lights"])
    gids = {g["id"] for g in groups}
    screens.set_groups(screen_specs, gids)
    emitters, lost_glows = lamps.split_emitters(static + glow_objs, floor_index, gids)  # before chunking joins them
    fixtures = lamps.fixture_boxes(static + glow_objs, floor_index, gids)
    lost = lost_lamps + lost_glows
    for msg in lost:
        print(f"[lamps] WARNING: {msg} is never lit", flush=True)
    for g in groups:
        print(f"[lamps] {g['id']}: {', '.join(g['lights'])}", flush=True)
    movable_specs = movables.prepare_movables(movable_objs, floor_index)
    prop_specs = props.prepare_props(prop_objs, floor_index)
    glows = glow_specs(glow_objs)

    chunk_list = chunks.build_chunks(static, floor_index)
    open_plan = geom.open_neighbours({r["id"]: r["floor"] for r in room_list}, floor_index.locate_many)
    for c in chunk_list:  # an open-plan neighbour's lamps light this room too, on the neighbour's switches
        c["neighbours"] = [r for r in open_plan.get(c["room"], []) if r in gids]
        if c["neighbours"]:
            print(f"[chunks] {c['node']}: also lit from {', '.join(c['neighbours'])} (open plan)", flush=True)
    ctx["chunks"] = chunk_list
    if stop_after == "chunks":
        return ctx

    for c in chunk_list:
        c["size"] = uvs.add_lightmap_uvs(bpy.data.objects[c["node"]], quality.lightmap_texels_per_m,
                                         quality.lightmap_min, quality.lightmap_max)
    for d in door_specs:
        uvs.add_lightmap_uvs(bpy.data.objects[d["node"]], 0, quality.door_lightmap, quality.door_lightmap)
    atlas = movable_atlases(movable_specs, quality)
    neighbours = {c["room"]: c["neighbours"] for c in chunk_list if c["room"]}
    plan = layers.plan(groups, chunk_list, door_specs, sorted({m["room"] for m in movable_specs}), neighbours)
    for key, p in plan.items():
        most = packs.PER_PACK * config.MAX_PACKS
        if len(p["packed"]) > most:
            print(f"[layers] WARNING: {key} has {len(p['packed'])} lamp layers; the last {len(p['packed']) - most} "
                  "are dropped", flush=True)
            p["packed"] = p["packed"][:most]

    st = {
        "rooms": room_list, "switches": sw, "doors": door_specs, "chunks": chunk_list,
        "door_lightmap_size": quality.door_lightmap,
        "spawn": export.spawn_from(scene, room_list), "viewpoints": export.viewpoints(scene), "day_lights": ctx["day_lights"],
        "groups": groups, "group_emitters": emitters, "fixtures": fixtures, "lost_lamps": lost,
        "movables": movable_specs, "movable_atlas": atlas, "screens": screen_specs, "glows": glows, "props": prop_specs,
        "layers": plan,
        "windows": window_list, "sky_irradiance": bake.sky_irradiance(scene),
    }
    state.save(scene, st)
    switch_points = [(bpy.data.objects[n].location.x, -bpy.data.objects[n].location.y) for n in sw.values()]
    debug_map.save_map(os.path.join(build_dir, "debug_map.png"), grid, door_specs, switch_points, st["spawn"])
    bpy.ops.wm.save_mainfile()
    ctx["state"] = st
    return ctx


def bake_stage(scene, quality, out_dir):
    st = state.load(scene)
    st["baked"] = bake.bake_all(scene, st, quality, out_dir)
    state.save(scene, st)
    bpy.ops.wm.save_mainfile()


def make_proxies(st):
    """Invisible boxes around each lamp's fixtures: the viewer's click targets. Made after the bake, so they never
    block light."""
    mat = bpy.data.materials.get("Web proxy") or bpy.data.materials.new("Web proxy")
    names = {}
    for gid, (lo, hi) in sorted(st["fixtures"].items()):
        name = f"Lamp_{geom.slugify(gid)}"
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(Vector([(a + b) / 2 for a, b in zip(lo, hi)]))
                              @ Matrix.Diagonal((*[b - a for a, b in zip(lo, hi)], 1.0)))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        obj = bpy.data.objects.new(name, me)
        bpy.data.collections["WEB"].objects.link(obj)
        names[gid] = name
    return names


def export_stage(scene, out_dir, expected_doors, budget):
    st = state.load(scene)
    proxies = make_proxies(st)
    names = ([c["node"] for c in st["chunks"]] + [d["node"] for d in st["doors"]] + list(st["switches"].values())
             + [m["node"] for m in st["movables"]] + [s["node"] for s in st["screens"]] + [g["node"] for g in st["glows"]]
             + [p["node"] for p in st.get("props", [])] + list(proxies.values()))
    export.export_glb([bpy.data.objects[n] for n in names], os.path.join(out_dir, "apartment.glb"))
    m = manifest.build_manifest(st, st["baked"], config.EYE_HEIGHT, proxies)
    export.write_json(os.path.join(out_dir, "manifest.json"), m)
    return checks.check_scene(st) + checks.check_outputs(out_dir, m, budget, expected_doors)


def run_all(quality_name, out_dir, build_dir, expected_doors=config.EXPECTED_DOOR_COUNT,
            budget=config.FIRST_VIEW_BUDGET_BYTES, variant=None):
    quality = config.QUALITY[quality_name]
    scene = bpy.context.scene
    out_dir, build_dir = os.path.abspath(out_dir), os.path.abspath(build_dir)
    if variant:
        expected_doors = config.VARIANTS[variant].get("expected_doors", expected_doors)
    prepare(scene, quality, out_dir, build_dir, variant=variant)
    bake_stage(scene, quality, out_dir)
    return export_stage(scene, out_dir, expected_doors, budget)
