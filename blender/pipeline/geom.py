"""Pure geometry helpers for the export pipeline (no bpy).

The web app works in three.js space (Y up). A Blender point (x, y, z) becomes
(x, z, -y). Ground-plane values here are three.js (x, z) unless named otherwise.
"""
import math
import re

import numpy as np


def to_three(p):
    x, y, z = p
    return (x, z, -y)


def to_three_xz(x, y):
    return (x, -y)


def from_three_xz(x, z):
    return (x, -z)


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rot_y(v, phi):
    """Rotate a ground-plane vector (x, z) about +Y by phi radians."""
    x, z = v
    c, s = math.cos(phi), math.sin(phi)
    return (x * c + z * s, -x * s + z * c)


def _edge(p, a, b):
    return (p[:, 0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[:, 1] - b[1])


def _segment_distance(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(float(ab @ ab), 1e-12), 0.0, 1.0)
    q = a + t[:, None] * ab
    return np.hypot(p[:, 0] - q[:, 0], p[:, 1] - q[:, 1])


class FloorIndex:
    """Find which room's floor triangles contain a ground-plane point."""

    def __init__(self, rooms):
        """rooms: dict room_id -> flat [x0, z0, x1, z1, x2, z2, ...] triangle list."""
        self.ids = list(rooms)
        tris, owner = [], []
        for k, rid in enumerate(self.ids):
            for t in np.asarray(rooms[rid], dtype=np.float64).reshape(-1, 3, 2):
                area = (t[1, 0] - t[0, 0]) * (t[2, 1] - t[0, 1]) - (t[2, 0] - t[0, 0]) * (t[1, 1] - t[0, 1])
                if abs(area) > 1e-9:
                    tris.append(t)
                    owner.append(k)
        self.tris = np.asarray(tris, dtype=np.float64).reshape(-1, 3, 2)
        self.owner = np.asarray(owner, dtype=np.int64)

    def locate_many(self, pts, max_dist=0.0):
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        out = np.full(len(pts), -1, dtype=np.int64)
        for t, k in zip(self.tris, self.owner):
            d1, d2, d3 = _edge(pts, t[0], t[1]), _edge(pts, t[1], t[2]), _edge(pts, t[2], t[0])
            neg = (d1 < -1e-12) | (d2 < -1e-12) | (d3 < -1e-12)
            pos = (d1 > 1e-12) | (d2 > 1e-12) | (d3 > 1e-12)
            out[~(neg & pos) & (out < 0)] = k
        rest = np.flatnonzero(out < 0)
        if max_dist > 0 and rest.size:
            p = pts[rest]
            best = np.full(rest.size, np.inf)
            owner = np.full(rest.size, -1, dtype=np.int64)
            for t, k in zip(self.tris, self.owner):
                for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                    d = _segment_distance(p, a, b)
                    better = d < best
                    best[better] = d[better]
                    owner[better] = k
            hit = best <= max_dist
            out[rest[hit]] = owner[hit]
        return out

    def locate(self, x, z):
        k = int(self.locate_many([(x, z)])[0])
        return None if k < 0 else self.ids[k]

    def bounds(self):
        flat = self.tris.reshape(-1, 2)
        return (float(flat[:, 0].min()), float(flat[:, 1].min()), float(flat[:, 0].max()), float(flat[:, 1].max()))


def principal_frame(points_xz):
    """Oriented bounding rectangle of ground-plane points.

    Returns (center, u, n, extent_u, extent_n): u is the long axis, made to point
    +x (or +z when vertical) so results are deterministic; n = (-u.z, u.x).
    """
    p = np.asarray(points_xz, dtype=np.float64).reshape(-1, 2)
    c = (p.min(0) + p.max(0)) / 2
    w, v = np.linalg.eigh(np.cov((p - c).T))
    u = v[:, int(np.argmax(w))]
    if u[0] < -1e-9 or (abs(u[0]) <= 1e-9 and u[1] < 0):
        u = -u
    n = np.array([-u[1], u[0]])
    pu, pn = (p - c) @ u, (p - c) @ n
    c = c + u * (pu.max() + pu.min()) / 2 + n * (pn.max() + pn.min()) / 2
    return (
        (float(c[0]), float(c[1])),
        (float(u[0]), float(u[1])),
        (float(n[0]), float(n[1])),
        float(pu.max() - pu.min()),
        float(pn.max() - pn.min()),
    )


def door_rooms(hinge, direction, width, locate, probe=0.3):
    """Rooms on either side of a closed door (three.js ground plane), each once, in side order.

    locate(x, z) -> room id or None; the probes sit `probe` m off the leaf's middle, past the wall.
    """
    mx, mz = hinge[0] + direction[0] * width / 2, hinge[1] + direction[1] * width / 2
    nx, nz = -direction[1], direction[0]
    out = []
    for s in (1, -1):
        room = locate(mx + nx * probe * s, mz + nz * probe * s)
        if room is not None and room not in out:
            out.append(room)
    return out


def open_neighbours(rooms, locate_many, min_shared=0.5, step=0.05, probe=0.02):
    """Rooms whose floors meet with no wall between them (an open-plan kitchen and living room): {room id: [ids]}.

    rooms: {room id: flat [x0, z0, x1, z1, x2, z2, ...] triangles}; locate_many(points) -> floor index per point
    (-1 for none), in the order of `rooms`. Each floor edge is sampled every `step` m and probed `probe` m to either
    side; a pair counts once its shared boundary reaches `min_shared` m. Rooms behind a wall or a door never meet:
    the wall's thickness lies between their floors.
    """
    ids = list(rooms)
    shared = {}
    for rid in ids:
        tris = np.asarray(rooms[rid], dtype=np.float64).reshape(-1, 3, 2)
        for t in tris:
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                length = float(np.hypot(*(b - a)))
                if length < 1e-9:
                    continue
                n = np.array([-(b - a)[1], (b - a)[0]]) / length
                k = max(1, int(length / step))
                pts = a + (b - a) * ((np.arange(k) + 0.5) / k)[:, None]
                left, right = locate_many(pts + n * probe), locate_many(pts - n * probe)
                for i, j in zip(left, right):
                    if i >= 0 and j >= 0 and i != j:
                        pair = (min(i, j), max(i, j))
                        shared[pair] = shared.get(pair, 0.0) + length / k
    out = {}
    # Every shared edge is seen from both floors, so each pair's length is counted twice.
    for (i, j), total in sorted(shared.items()):
        if total / 2 >= min_shared:
            out.setdefault(ids[i], []).append(ids[j])
            out.setdefault(ids[j], []).append(ids[i])
    return out


def choose_door_swing(end_a, end_b, is_blocked, override=None):
    """Pick the hinge end and swing direction for a closed door leaf.

    end_a, end_b: the leaf's two ends on the ground plane.
    is_blocked(x, z): raw occupancy (walls and furniture, not inflated).
    override: optional {"hinge": "a" | "b", "sign": 1 | -1}.
    Prefers the fewest blocked samples in the swept quarter circle, then the most
    blocked samples just behind the open leaf (it should rest against a wall).
    """
    best = None
    for name, hinge, free in (("a", end_a, end_b), ("b", end_b, end_a)):
        dx, dz = free[0] - hinge[0], free[1] - hinge[1]
        width = math.hypot(dx, dz)
        d = (dx / width, dz / width)
        for sign in (1, -1):
            if override and (override.get("hinge", name) != name or override.get("sign", sign) != sign):
                continue
            sweep = 0
            for k in range(1, 10):
                vx, vz = rot_y(d, sign * (math.pi / 2) * k / 9)
                for f in (0.35, 0.65, 0.95):
                    if is_blocked(hinge[0] + vx * width * f, hinge[1] + vz * width * f):
                        sweep += 1
            ox, oz = rot_y(d, sign * math.pi / 2)
            hug = sum(
                1
                for f in (0.25, 0.5, 0.75, 1.0)
                if is_blocked(hinge[0] + ox * width * f - d[0] * 0.12, hinge[1] + oz * width * f - d[1] * 0.12)
            )
            key = (sweep, -hug)
            if best is None or key < best[0]:
                best = (key, dict(hinge=tuple(hinge), dir=d, width=width, sign=sign, hinge_end=name))
    if best is None:
        raise ValueError(f"door override {override} matches no hinge/sign combination")
    return best[1]


def rot_y_angle(d, t):
    """Signed phi with rot_y(d, phi) == t, for unit ground-plane vectors d and t."""
    return math.atan2(t[0] * d[1] - t[1] * d[0], d[0] * t[0] + d[1] * t[1])


def door_from_opening(end_a, end_b, openings, max_dist):
    """Match a leaf modelled open to its doorway.

    end_a, end_b: the leaf's two ends; openings: objects with center, u, width, num.
    The leaf end nearest an opening's jamb end (within max_dist) is the hinge. Returns
    {"opening", "hinge", "dir" (closed: hinge jamb toward the other jamb), "open" (hinge
    to free end as modelled), "angle" (rot_y from dir to open)}, or None if nothing is close.
    """
    best = None
    for op in openings:
        c, u, half = op.center, op.u, op.width / 2
        for jsign in (1, -1):
            jamb = (c[0] + u[0] * half * jsign, c[1] + u[1] * half * jsign)
            for hinge, free in ((end_a, end_b), (end_b, end_a)):
                dist = math.hypot(hinge[0] - jamb[0], hinge[1] - jamb[1])
                if dist <= max_dist and (best is None or dist < best[0]):
                    best = (dist, op, hinge, free, (-u[0] * jsign, -u[1] * jsign))
    if best is None:
        return None
    _, op, hinge, free, d = best
    w = math.hypot(free[0] - hinge[0], free[1] - hinge[1])
    t = ((free[0] - hinge[0]) / w, (free[1] - hinge[1]) / w)
    return {"opening": op, "hinge": tuple(hinge), "dir": d, "open": t, "width": w, "angle": rot_y_angle(d, t)}


def door_pose(match, end_a, end_b, is_blocked, label="leaf", override=None):
    """Closed pose and opening angle for a leaf matched by door_from_opening.

    Modelled open (60°..120°): the modelled pose is the open state and the mesh must be
    rotated by -angle into the doorway (to_closed = angle). Modelled closed (< 30°): keep
    the matched hinge, pick the swing with choose_door_swing (or override["sign"]), no
    rotation. Anything else is an implausible pose and raises.
    """
    deg = abs(math.degrees(match["angle"]))
    if deg < 30:
        hinge_end = "a" if tuple(match["hinge"]) == tuple(end_a) else "b"
        sign = {"sign": override["sign"]} if override and "sign" in override else {}
        c = choose_door_swing(end_a, end_b, is_blocked, {"hinge": hinge_end, **sign})
        return {"hinge": c["hinge"], "dir": c["dir"], "width": c["width"],
                "angle": c["sign"] * math.pi / 2, "to_closed": 0.0, "closed": True}
    if deg < 60 or deg > 120:
        raise RuntimeError(f"{label}: modelled {deg:.0f}° open at opening {match['opening'].num}; "
                           "expected closed (<30°) or open (60°..120°)")
    return {"hinge": match["hinge"], "dir": match["dir"], "width": match["width"],
            "angle": match["angle"], "to_closed": match["angle"], "closed": False}


def yaw_pitch_from_forward(f):
    """three.js camera yaw/pitch (rotation order YXZ) for a forward vector."""
    fx, fy, fz = f
    return (math.atan2(-fx, -fz), math.asin(max(-1.0, min(1.0, fy))))
