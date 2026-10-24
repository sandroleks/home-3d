"""Which lamp layers each lit surface gets (pure).

A chunk takes its room's switch group as a full RGBM layer and packs the rest: its room's lamp groups, its open-plan
neighbours' groups, and the light that spills in through each door from a lit room behind it. A door leaf packs every
group of both its rooms; a room's movables pack their room's groups and their neighbours' switch groups.
"""


def spill_key(spill):
    return f"spill-{spill['opening']}-{spill['from']}"


def layer_key(layer):
    return layer["group"] if "group" in layer else spill_key(layer["spill"])


def spills(doors):
    """[{opening, from, to}] for every door between two rooms, both ways; leaves of one opening count once."""
    seen, out = set(), []
    for d in doors:
        rooms = d.get("rooms", [])
        if len(rooms) != 2 or d["opening"] in seen:
            continue
        seen.add(d["opening"])
        a, b = rooms
        out += [{"opening": d["opening"], "from": a, "to": b}, {"opening": d["opening"], "from": b, "to": a}]
    return out


def plan(groups, chunks, doors, movable_rooms, neighbours):
    """{surface key: {"light": switch group id or None, "packed": [layer]}}, layer = {"group": id} | {"spill": {...}}.

    groups: [{id, room, kind}]; chunks: [{key, room}]; doors: [{key, rooms, opening}]; movable_rooms: room ids with
    movables; neighbours: {room: [open-plan neighbour rooms]}.
    """
    by_room = {}
    for g in groups:
        by_room.setdefault(g["room"], []).append(g)
    for gs in by_room.values():
        gs.sort(key=lambda g: (g["kind"] != "switch", g["id"]))

    def switch(room):
        return next((g["id"] for g in by_room.get(room, []) if g["kind"] == "switch"), None)

    def every(room):
        return [{"group": g["id"]} for g in by_room.get(room, [])]

    lit = {r for r in by_room if switch(r)}
    into = {}
    for s in spills(doors):
        if s["from"] in lit:
            into.setdefault(s["to"], []).append({"spill": {"opening": s["opening"], "from": s["from"]}})
    out = {}
    for c in chunks:
        room = c["room"]
        own = [{"group": g["id"]} for g in by_room.get(room, []) if g["kind"] == "lamp"]
        near = [layer for n in neighbours.get(room, []) for layer in every(n)]
        out[c["key"]] = {"light": switch(room), "packed": own + near + into.get(room, [])}
    for d in doors:
        out[d["key"]] = {"light": None, "packed": [layer for r in d.get("rooms", []) for layer in every(r)]}
    for room in movable_rooms:
        near = [{"group": switch(n)} for n in neighbours.get(room, []) if switch(n)]
        out[f"movables-{room}"] = {"light": None, "packed": every(room) + near}
    return out
