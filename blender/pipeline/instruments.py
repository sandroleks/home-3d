"""Instruments visitors can play (`web_instrument = "<kind>"`, one of config.INSTRUMENT_KINDS). The manifest says where
each one is, its box (for clicking, or where it hangs) and the middle it sounds from, in three.js space; the viewer
makes the sound itself. A fixed one stays part of the baked room and is played from a panel; one that is also a loose
thing (`web_prop`) is its own node, `prop`, and is picked up to play."""
from . import bpyutil, config, geom


def find(meshes):
    return [o for o in meshes if o.get(config.INSTRUMENT_PROP)]


def spec(name, kind, room, lo, hi):
    """An instrument's manifest entry from its Blender box (lo, hi)."""
    a, b = geom.to_three(tuple(lo)), geom.to_three(tuple(hi))
    r = lambda v: round(float(v), 4) + 0.0  # noqa: E731
    box_lo = [r(min(a[i], b[i])) for i in range(3)]
    box_hi = [r(max(a[i], b[i])) for i in range(3)]
    return {"name": name, "kind": kind, "room": room, "min": box_lo, "max": box_hi,
            "at": [r((box_lo[i] + box_hi[i]) / 2) for i in range(3)]}


def prepare_instruments(objs, floor_index):
    specs = []
    for o in sorted(objs, key=lambda o: o.name):
        kind = str(o[config.INSTRUMENT_PROP])
        if kind not in config.INSTRUMENT_KINDS:
            raise RuntimeError(f"{o.name}: web_instrument must be one of {', '.join(config.INSTRUMENT_KINDS)}")
        co = bpyutil.world_coords(o)
        lo, hi = co.min(0), co.max(0)
        room = floor_index.locate(*geom.to_three_xz((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
        if room is None:
            raise RuntimeError(f"{o.name}: not over a room's floor")
        specs.append(spec(o.name, kind, room, lo, hi))
    return specs


def link_props(specs, prop_specs):
    """Names each loose instrument's node (props.prepare_props renamed it)."""
    nodes = {p["source"]: p["node"] for p in prop_specs}
    for s in specs:
        if s["name"] in nodes:
            s["prop"] = nodes[s["name"]]
