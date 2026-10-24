"""Close each door leaf into its doorway, move its origin to the hinge, and record how it opens.

The real file models leaves open (90° into the room). A leaf is matched to the opening whose
jamb end is nearest one of its ends; that end is the hinge, the modelled pose becomes the open
state, and the mesh is rotated into the doorway so it is baked closed. A matched leaf modelled
closed keeps its hinge and gets its swing from geom.choose_door_swing (see geom.door_pose); a "sign" in
DOOR_OVERRIDES picks the swing instead. A leaf that matches no opening falls back to the swing heuristic
(DOOR_OVERRIDES applies there). An opening takes two leaves (French doors, "Door leaf 4a" and "4b") when each is
narrower than two thirds of it. A leaf tagged `web_move = "slide"` (web_dir, web_dist) is a sliding door: modelled
closed, it slides along web_dir instead of swinging.
"""
import math
import re

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import bpyutil, config, geom

NUM_RE = re.compile(r"(\d+)([a-z]?)")
HINGE_MATCH_DIST = 0.25
PAIR_SHARE = 2 / 3


def _number(name):
    m = NUM_RE.search(name)
    return int(m.group(1)) if m else 0


def _label(name):
    """'4a' for 'Door leaf 4a', '1' for 'Door leaf 1'."""
    m = NUM_RE.search(name)
    return f"{m.group(1)}{m.group(2)}" if m else "0"


def prepare_doors(door_objs, grid, overrides, openings, infilled):
    specs, used = [], {}
    for obj in sorted(door_objs, key=lambda o: (_number(o.name), _label(o.name))):
        n, label = _number(obj.name), _label(obj.name)
        co = bpyutil.world_coords(obj)
        pts = np.stack([co[:, 0], -co[:, 1]], axis=1)
        center, u, _, width, _ = geom.principal_frame(pts)
        ends = sorted(
            [(center[0] - u[0] * width / 2, center[1] - u[1] * width / 2),
             (center[0] + u[0] * width / 2, center[1] + u[1] * width / 2)],
            key=lambda p: (round(p[0], 3), round(p[1], 3)),
        )
        match = geom.door_from_opening(ends[0], ends[1], openings, HINGE_MATCH_DIST)
        if match and match["opening"].num in infilled:
            print(f"[doors] {obj.name}: opening {match['opening'].num} is infilled; leaf removed", flush=True)
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if match:
            num = match["opening"].num
            half = match["width"] < match["opening"].width * PAIR_SHARE
            if num in used and (len(used[num]) > 1 or not (half and used[num][0][1])):
                raise RuntimeError(f"door leaves {used[num][0][0]!r} and {obj.name!r} both match opening {num}")
            used.setdefault(num, []).append((obj.name, half))
            if obj.get(config.MOVE_PROP) == "slide":
                choice = geom.slide_pose(ends[0], ends[1], geom.to_three_xz(*obj["web_dir"][:2]), float(obj["web_dist"]))
                angle, to_closed = 0.0, 0.0
                how = f"opening {num}, slides {choice['slide']['distance']} m"
            else:
                choice = geom.door_pose(match, ends[0], ends[1], lambda x, z: grid.is_blocked(x, z, raw=True),
                                        obj.name, overrides.get(obj.name))
                angle, to_closed = choice["angle"], choice["to_closed"]
                how = f"opening {num}" + (" (modelled closed; swing heuristic)" if choice["closed"] else "")
        else:
            choice = geom.choose_door_swing(
                ends[0], ends[1], lambda x, z: grid.is_blocked(x, z, raw=True), overrides.get(obj.name)
            )
            angle, to_closed = choice["sign"] * math.pi / 2, 0.0  # assumed modelled closed
            how = "fallback swing heuristic"
            num = None
        hx, hz = choice["hinge"]
        bx, by = geom.from_three_xz(hx, hz)
        hinge = Vector((bx, by, float(co[:, 2].min())))
        # Into the closed pose: rotation about three.js Y equals rotation about Blender Z.
        obj.data.transform(Matrix.Rotation(-to_closed, 4, "Z") @ Matrix.Translation(-hinge))
        obj.location = hinge
        obj.name = f"Door_{label}"
        specs.append({
            "node": obj.name,
            "key": f"door-{label}",
            "opening": num if num is not None else n,
            "hinge": [round(hx, 4), round(hz, 4)],
            "dir": [round(choice["dir"][0], 5), round(choice["dir"][1], 5)],
            "width": round(choice["width"], 4),
            "openAngle": round(angle, 5),
            **({"slide": choice["slide"]} if "slide" in choice else {}),
        })
        print(f"[doors] {obj.name}: {how}, hinge {specs[-1]['hinge']} dir {specs[-1]['dir']} "
              f"open {math.degrees(angle):.1f}°", flush=True)
    return specs
