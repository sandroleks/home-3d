"""Light groups: each room's wall switch, and lamps that switch on their own.

A room with a ceiling light has a switch group (id: the room id) holding the ceiling light and every lamp in the room
without a lamp group. A light tagged `web_lamp = "<name>"` joins the lamp group `<room>/<name>` instead, as do glowing
meshes and fixtures with the same tag in the same room.
"""
from . import bpyutil, config, geom


def is_day_fill(light_obj):
    """Window fill lights stand in for sky light, so they belong to the day layer."""
    return light_obj.name.startswith(config.DAY_FILL_LIGHT_PREFIX)


def _room_at(floor_index, x, y):
    k = int(floor_index.locate_many([geom.to_three_xz(x, y)], config.LAMP_ROOM_MAX_DIST)[0])
    return None if k < 0 else floor_index.ids[k]


def _centre(obj):
    co = bpyutil.world_coords(obj)
    return (co.min(0) + co.max(0)) / 2


def lamp_group_id(room, name):
    return f"{room}/{geom.slugify(name)}"


def collect_groups(scene, room_list, floor_index, on_lights):
    """([{id, room, kind: "switch" | "lamp", name, lights, power}], [messages about lamps no switch reaches]).
    Suns and day fill lights are in no group."""
    groups = {}
    for r in room_list:
        if r["light"]:
            groups[r["id"]] = {"id": r["id"], "room": r["id"], "kind": "switch", "name": "light", "lights": [r["light"]]}
    lost = []
    ceilings = {r["light"] for r in room_list if r["light"]}
    for name in sorted(on_lights):
        o = scene.objects[name]
        if o.data.type == "SUN" or is_day_fill(o) or name in ceilings:
            continue
        p = o.matrix_world.translation
        room = _room_at(floor_index, p.x, p.y)
        if room is None:
            lost.append(f"{name} (in no room)")
            continue
        if room not in groups:
            lost.append(f"{name} (in {room}, which has no ceiling light)")
            continue
        lamp = o.get(config.LAMP_PROP)
        if not lamp:
            groups[room]["lights"].append(name)
            continue
        gid = lamp_group_id(room, lamp)
        groups.setdefault(gid, {"id": gid, "room": room, "kind": "lamp", "name": str(lamp), "lights": []})
        groups[gid]["lights"].append(name)
    for g in groups.values():
        g["power"] = round(sum(scene.objects[n].data.energy for n in g["lights"]), 3)
    order = sorted(groups.values(), key=lambda g: (g["room"], g["kind"] != "switch", g["id"]))
    return order, lost


def group_for(obj, room, group_ids):
    """The group a mesh in `room` follows: its lamp group when tagged and that group exists, else the room's switch."""
    lamp = obj.get(config.LAMP_PROP)
    if lamp:
        gid = lamp_group_id(room, lamp)
        if gid in group_ids:
            return gid
    return room


def _glows(mat):
    if mat is None or mat.node_tree is None:
        return False
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Emission Strength"].default_value > 0:
            return True
        if n.type == "EMISSION" and n.inputs["Strength"].default_value > 0:
            return True
    return False


def glow_only(obj):
    """Bulbs and LED strips: every material glows and the mesh casts no shadow, so it never blocks its own lamp. These
    are exported on their own, unlit, glowing with their group."""
    return (not obj.visible_shadow) and bool(obj.material_slots) and all(_glows(s.material) for s in obj.material_slots)


def split_emitters(meshes, floor_index, group_ids):
    """Give every group its own copy of each glowing material its meshes use ('<name> @<group id>'), so the bake can
    light one group's lampshades without the others. Works on realized meshes (one mesh per object). Screens never
    glow in a bake and are skipped. Returns ({group id: [material names]}, [messages about glowing meshes no switch
    reaches])."""
    copies, found, lost = {}, {}, []
    for o in meshes:
        if o.get(config.SCREEN_PROP):
            continue
        slots = [i for i, s in enumerate(o.material_slots) if _glows(s.material)]
        if not slots:
            continue
        c = _centre(o)
        room = _room_at(floor_index, c[0], c[1])
        if room is None:
            lost.append(f"{o.name} (in no room)")
            continue
        if room not in group_ids:
            lost.append(f"{o.name} (in {room}, which has no ceiling light)")
            continue
        gid = group_for(o, room, group_ids)
        for i in slots:
            mat = o.material_slots[i].material
            key = (mat.name, gid)
            if key not in copies:
                copy = mat.copy()
                copy.name = f"{mat.name} @{gid}"
                copies[key] = copy
                found.setdefault(gid, []).append(copy.name)
            o.data.materials[i] = copies[key]
    return found, sorted(lost)


def fixture_boxes(meshes, floor_index, group_ids, pad=0.03):
    """{lamp group id: [[x0, y0, z0], [x1, y1, z1]]}: the Blender-space box around each group's tagged meshes, a click
    target for the lamp."""
    boxes = {}
    for o in meshes:
        if not o.get(config.LAMP_PROP):
            continue
        co = bpyutil.world_coords(o)
        lo, hi = co.min(0), co.max(0)
        room = _room_at(floor_index, (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
        gid = lamp_group_id(room, o[config.LAMP_PROP]) if room else None
        if gid not in group_ids:
            continue
        if gid in boxes:
            lo = [min(a, b) for a, b in zip(lo, boxes[gid][0])]
            hi = [max(a, b) for a, b in zip(hi, boxes[gid][1])]
        boxes[gid] = [[float(v) for v in lo], [float(v) for v in hi]]
    return {g: [[round(v - pad, 4) for v in lo], [round(v + pad, 4) for v in hi]] for g, (lo, hi) in boxes.items()}
