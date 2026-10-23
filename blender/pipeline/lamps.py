"""Which room each lamp and glowing object belongs to, so a room's light layer switches them with its ceiling light."""
from . import bpyutil, config, geom


def is_day_fill(light_obj):
    """Window fill lights stand in for sky light, so they belong to the day layer."""
    return light_obj.name.startswith(config.DAY_FILL_LIGHT_PREFIX)


def room_lamps(scene, floor_index, on_lights, ceiling_names):
    """({room id: [lamp names]}, [names of lamps in no room]) for the lights that are on in the render.
    Suns, day fill lights and ceiling lights are not lamps."""
    found, lost = {}, []
    for name in on_lights:
        o = scene.objects[name]
        if o.data.type == "SUN" or is_day_fill(o) or name in ceiling_names:
            continue
        p = o.matrix_world.translation
        k = int(floor_index.locate_many([geom.to_three_xz(p.x, p.y)], config.LAMP_ROOM_MAX_DIST)[0])
        if k < 0:
            lost.append(name)
        else:
            found.setdefault(floor_index.ids[k], []).append(name)
    return found, sorted(lost)


def _glows(mat):
    if mat is None or mat.node_tree is None:
        return False
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Emission Strength"].default_value > 0:
            return True
        if n.type == "EMISSION" and n.inputs["Strength"].default_value > 0:
            return True
    return False


def split_emitters(meshes, floor_index):
    """Give every room its own copy of each glowing material its meshes use ('<name> @<room>'), so the bake can light
    one room's lampshades and screens without the others. Works on realized meshes (one mesh per object).
    Returns ({room id: [material names]}, [names of glowing meshes in no room])."""
    copies, found, lost = {}, {}, []
    for o in meshes:
        slots = [i for i, s in enumerate(o.material_slots) if _glows(s.material)]
        if not slots:
            continue
        co = bpyutil.world_coords(o)
        c = (co.min(0) + co.max(0)) / 2
        k = int(floor_index.locate_many([geom.to_three_xz(c[0], c[1])], config.LAMP_ROOM_MAX_DIST)[0])
        if k < 0:
            lost.append(o.name)
            continue
        room = floor_index.ids[k]
        for i in slots:
            mat = o.material_slots[i].material
            key = (mat.name, room)
            if key not in copies:
                copy = mat.copy()
                copy.name = f"{mat.name} @{room}"
                copies[key] = copy
                found.setdefault(room, []).append(copy.name)
            o.data.materials[i] = copies[key]
    return found, sorted(lost)
