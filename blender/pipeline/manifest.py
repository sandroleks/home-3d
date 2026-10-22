"""Assemble and validate manifest.json (pure)."""


def build_manifest(state, ranges, eye_height):
    def ref(key, layer):
        name = f"{key}_{layer}"
        return {"file": f"lightmaps/{name}.webp", "range": ranges[name]} if name in ranges else None

    rooms = [
        {"id": r["id"], "name": r["name"], "floor": r["floor"], "switch": state["switches"].get(r["id"])}
        for r in state["rooms"]
    ]
    chunks = [
        {"node": c["node"], "room": c["room"], "day": ref(c["key"], "day"), "light": ref(c["key"], "light")}
        for c in state["chunks"]
    ]
    doors = [
        {**{k: d[k] for k in ("node", "hinge", "dir", "width", "openAngle")}, "lightmap": ref(d["key"], "day")}
        for d in state["doors"]
    ]
    return {
        "version": 1, "eyeHeight": eye_height, "spawn": state["spawn"],
        "rooms": rooms, "chunks": chunks, "doors": doors, "viewpoints": state["viewpoints"],
    }


def validate_manifest(m):
    errors = []
    if m.get("version") != 1:
        errors.append("version must be 1")
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
    return errors
