"""Pure logic: where on the wall beside a room's door the light switch goes."""
import numpy as np


def choose_switch_spot(room_id, room_name, openings, infilled, locate, is_blocked_raw, override=None, offset=0.15):
    override = override or {}
    cands = [o for o in openings if room_name in o.rooms and o.num not in infilled]
    if "door" in override:
        cands = [o for o in cands if o.num == override["door"]]
    cands.sort(key=lambda o: (o.glazed, o.num))
    sides = (override["side"],) if "side" in override else (1, -1)
    for op in cands:
        c, u, n = np.asarray(op.center), np.asarray(op.u), np.asarray(op.n)
        inward = next(
            (s for s in (1, -1) if locate(*(c + n * s * (op.thickness / 2 + 0.3))) == room_id), None
        )
        if inward is None:
            continue
        # "face": "outside" puts the switch on the other room's face of the same opening.
        facing = -inward if override.get("face") == "outside" else inward
        for side in sides:
            along = c + u * side * (op.width / 2 + offset)
            front = along + n * facing * (op.thickness / 2 + 0.25)
            # An explicit side is a reviewed choice: keep it even with furniture in front (e.g. a worktop).
            if not is_blocked_raw(*along) or ("side" not in override and is_blocked_raw(*front)):
                continue
            pos = along + n * facing * (op.thickness / 2 + 0.006)
            return {
                "pos": (round(float(pos[0]), 4), round(float(pos[1]), 4)),
                "u": (float(u[0]), float(u[1])),
                "n": (float(n[0] * facing), float(n[1] * facing)),
                "door": op.num,
            }
    return None
