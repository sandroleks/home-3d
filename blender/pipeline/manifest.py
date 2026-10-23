"""Assemble and validate manifest.json (pure)."""
from . import config


def floor_area(floor):
    """Area of a flat [x0, z0, x1, z1, x2, z2, ...] triangle list."""
    a = 0.0
    for k in range(0, len(floor) - 5, 6):
        x0, z0, x1, z1, x2, z2 = floor[k:k + 6]
        a += abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2
    return round(a, 3)


def build_manifest(state, ranges, eye_height):
    def ref(key, layer):
        name = f"{key}_{layer}"
        return {"file": f"lightmaps/{name}.webp", "range": ranges[name]} if name in ranges else None

    rooms = [
        {"id": r["id"], "name": r["name"], "floor": r["floor"], "switch": state["switches"].get(r["id"]),
         "area": floor_area(r["floor"])}
        for r in state["rooms"]
    ]
    chunks = [
        {"node": c["node"], "room": c["room"], "day": ref(c["key"], "day"), "light": ref(c["key"], "light")}
        for c in state["chunks"]
    ]
    doors = [
        {**{k: d[k] for k in ("node", "hinge", "dir", "width", "openAngle")}, "lightmap": ref(d["key"], "day"),
         "lights": [{"room": r, **ref(d["key"], f"light-{r}")} for r in d.get("rooms", []) if ref(d["key"], f"light-{r}")]}
        for d in state["doors"]
    ]
    return {
        "version": 2, "eyeHeight": eye_height, "spawn": state["spawn"],
        "rooms": rooms, "chunks": chunks, "doors": doors, "viewpoints": state["viewpoints"],
        "site": dict(config.SITE),
        "sky": {"irradiance": round(state["sky_irradiance"], 5), "wattsToScene": config.WATTS_TO_SCENE},
        "windows": state["windows"],
    }


def validate_manifest(m):
    errors = []
    if m.get("version") != 2:
        errors.append("version must be 2")
    switched = {r["id"] for r in m["rooms"] if r["switch"]}
    for i, c in enumerate(m["chunks"]):
        label = f"chunks[{i}] ({c['node']})"
        if c["day"] is None:
            errors.append(f"{label}: missing day lightmap")
        if c["room"] in switched and c["light"] is None:
            errors.append(f"{label}: room has a switch but no light lightmap")
    for i, d in enumerate(m["doors"]):
        if d["lightmap"] is None:
            errors.append(f"doors[{i}] ({d['node']}): missing lightmap")
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
    room_ids = {r["id"] for r in m["rooms"]}
    if not m["windows"]:
        errors.append("no exterior windows: name the glass 'Window N (Exterior / Room) glass'")
    for i, w in enumerate(m["windows"]):
        if w["room"] not in room_ids:
            errors.append(f"windows[{i}]: unknown room {w['room']}")
    if not m["sky"]["irradiance"] > 0:
        errors.append("sky.irradiance must be positive")
    return errors
