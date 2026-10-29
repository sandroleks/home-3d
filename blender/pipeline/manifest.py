"""Assemble and validate manifest.json (pure)."""
from . import config, layers, packs

VERSION = 3


def floor_area(floor):
    """Area of a flat [x0, z0, x1, z1, x2, z2, ...] triangle list."""
    a = 0.0
    for k in range(0, len(floor) - 5, 6):
        x0, z0, x1, z1, x2, z2 = floor[k:k + 6]
        a += abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2
    return round(a, 3)


def build_manifest(state, baked, eye_height, proxies=None):
    """baked: {"rgbm": {"<key>_<layer>": range}, "packs": {surface key: [pack]}}; proxies: {lamp group id: node}."""
    rgbm, packed = baked["rgbm"], baked["packs"]
    proxies = proxies or {}

    def ref(key, layer):
        name = f"{key}_{layer}"
        return {"file": f"lightmaps/{name}.webp", "range": rgbm[name]} if name in rgbm else None

    def packs(key):
        return [{"file": p["file"], "layers": [dict(l) for l in p["layers"]]} for p in packed.get(key, [])]

    rooms = [
        {"id": r["id"], "name": r["name"], "floor": r["floor"], "switch": state["switches"].get(r["id"]),
         "area": floor_area(r["floor"])}
        for r in state["rooms"]
    ]
    groups = [
        {"id": g["id"], "room": g["room"], "kind": g["kind"], "name": g["name"], "power": g["power"],
         "target": state["switches"].get(g["room"]) if g["kind"] == "switch" else proxies.get(g["id"])}
        for g in state["groups"]
    ]
    chunks = [
        {"node": c["node"], "room": c["room"], "day": ref(c["key"], "day"), "light": ref(c["key"], "light"),
         "packs": packs(c["key"])}
        for c in state["chunks"]
    ]
    doors = [
        {**{k: d[k] for k in ("node", "hinge", "dir", "width", "openAngle", "opening", "slide") if k in d},
         "lightmap": ref(d["key"], "day"), "packs": packs(d["key"])}
        for d in state["doors"]
    ]
    movables = []
    for mv in state["movables"]:
        key = f"movables-{mv['room']}"
        motion = {"slide": ("dir", "distance"), "hinge": ("pivot", "axis", "angle"), "spin": ("pivot", "axis", "rpm")}[mv["kind"]]
        movables.append({"node": mv["node"], "room": mv["room"], "kind": mv["kind"], **{k: mv[k] for k in motion},
                         "lightmap": ref(key, "day"), "packs": packs(key)})
    return {
        "version": VERSION, "eyeHeight": eye_height, "spawn": state["spawn"],
        "rooms": rooms, "groups": groups, "chunks": chunks, "doors": doors, "movables": movables,
        "screens": [{k: v for k, v in s.items() if k != "blender"} for s in state.get("screens", [])],
        "glows": state.get("glows", []), "viewpoints": state["viewpoints"],
        "props": [{k: p[k] for k in ("node", "name", "room", "size", "tips")} for p in state.get("props", [])],
        "instruments": state.get("instruments", []),
        "site": dict(config.SITE),
        "sky": {"irradiance": round(state["sky_irradiance"], 5), "wattsToScene": config.WATTS_TO_SCENE},
        "windows": state["windows"],
    }


def _check_packs(label, ps, group_ids, room_ids, openings):
    errors = []
    if len(ps) > config.MAX_PACKS:
        errors.append(f"{label}: {len(ps)} lamp packs, the viewer binds {config.MAX_PACKS}")
    for p in ps:
        if not 1 <= len(p["layers"]) <= packs.PER_PACK:
            errors.append(f"{label}: {p['file']} packs {len(p['layers'])} layers")
        for l in p["layers"]:
            if "group" in l and l["group"] not in group_ids:
                errors.append(f"{label}: {p['file']} names unknown group {l['group']}")
            if "spill" in l and (l["spill"]["from"] not in room_ids or l["spill"]["opening"] not in openings):
                errors.append(f"{label}: {p['file']} has a spill layer from nowhere ({layers.layer_key(l)})")
            if not l["range"] > 0 or len(l["tint"]) != 3:
                errors.append(f"{label}: {p['file']} has a bad range or tint")
    return errors


def validate_manifest(m):
    errors = []
    if m.get("version") != VERSION:
        errors.append(f"version must be {VERSION}")
    switched = {r["id"] for r in m["rooms"] if r["switch"]}
    group_ids = {g["id"] for g in m["groups"]}
    room_ids = {r["id"] for r in m["rooms"]}
    openings = {d["opening"] for d in m["doors"]}
    for g in m["groups"]:
        if g["room"] not in room_ids:
            errors.append(f"group {g['id']}: unknown room {g['room']}")
        if g["kind"] == "switch" and g["id"] != g["room"]:
            errors.append(f"group {g['id']}: a switch group's id is its room's")
    for i, c in enumerate(m["chunks"]):
        label = f"chunks[{i}] ({c['node']})"
        if c["day"] is None:
            errors.append(f"{label}: missing day lightmap")
        if c["room"] in switched and c["light"] is None:
            errors.append(f"{label}: room has a switch but no light lightmap")
        errors += _check_packs(label, c["packs"], group_ids, room_ids, openings)
    for i, d in enumerate(m["doors"]):
        if d["lightmap"] is None:
            errors.append(f"doors[{i}] ({d['node']}): missing lightmap")
        errors += _check_packs(f"doors[{i}] ({d['node']})", d["packs"], group_ids, room_ids, openings)
    for i, mv in enumerate(m["movables"]):
        label = f"movables[{i}] ({mv['node']})"
        if mv["lightmap"] is None:
            errors.append(f"{label}: missing lightmap")
        if mv["room"] not in room_ids:
            errors.append(f"{label}: unknown room {mv['room']}")
        errors += _check_packs(label, mv["packs"], group_ids, room_ids, openings)
    for i, s in enumerate(m["screens"]):
        if s["group"] is not None and s["group"] not in group_ids:
            errors.append(f"screens[{i}] ({s['node']}): unknown group {s['group']}")
    for i, g in enumerate(m["glows"]):
        if g["group"] not in group_ids:
            errors.append(f"glows[{i}] ({g['node']}): unknown group {g['group']}")
    for i, p in enumerate(m["props"]):
        label = f"props[{i}] ({p['node']})"
        if p["room"] is not None and p["room"] not in room_ids:
            errors.append(f"{label}: unknown room {p['room']}")
        size = p["size"]
        if not (len(size) == 3 and all(isinstance(v, (int, float)) and v > 0 for v in size)):
            errors.append(f"{label}: size must be three positive numbers")
        if not p["name"]:
            errors.append(f"{label}: no name")
    for i, ins in enumerate(m["instruments"]):
        label = f"instruments[{i}] ({ins['name']})"
        if ins["room"] not in room_ids:
            errors.append(f"{label}: unknown room {ins['room']}")
        if ins["kind"] not in config.INSTRUMENT_KINDS:
            errors.append(f"{label}: unknown kind {ins['kind']}")
        if not all(ins["min"][k] < ins["max"][k] for k in range(3)):
            errors.append(f"{label}: an empty box")
        if ins.get("prop") is not None and ins["prop"] not in {p["node"] for p in m["props"]}:
            errors.append(f"{label}: unknown prop {ins['prop']}")
    if len({ins["name"] for ins in m["instruments"]}) != len(m["instruments"]):
        errors.append("two instruments share a name")
    chunk_rooms = {c["room"] for c in m["chunks"]}
    lit_rooms = {c["room"] for c in m["chunks"] if c["light"]}
    for r in m["rooms"]:
        if r["id"] not in chunk_rooms:
            errors.append(f"room {r['id']}: no chunk")
        if r["id"] in lit_rooms and not r["switch"]:
            errors.append(f"room {r['id']}: has a light layer but no switch")
    for k in ("x", "z", "yaw"):
        if not isinstance(m["spawn"].get(k), (int, float)):
            errors.append(f"spawn.{k} must be a number")
    if not m["windows"]:
        errors.append("no exterior windows: name the glass 'Window N (Exterior / Room) glass'")
    for i, w in enumerate(m["windows"]):
        if w["room"] not in room_ids:
            errors.append(f"windows[{i}]: unknown room {w['room']}")
    if not m["sky"]["irradiance"] > 0:
        errors.append("sky.irradiance must be positive")
    return errors
