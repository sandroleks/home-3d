"""Top-down PNG for reviewing collision, door swings, switches and spawn (build/debug_map.png)."""
import math

import numpy as np

from . import geom


def render_map(grid, doors, switch_points, spawn, scale=4):
    """Row 0 of the result is the smallest z (Blender +y, 'north' at the top)."""
    img = np.ones((grid.height, grid.width, 3))
    img[grid.blocked] = 0.8
    img[grid.raw] = 0.35
    img = img.repeat(scale, 0).repeat(scale, 1)

    def dot(x, z, color, r=1):
        i = int((x - grid.x0) / grid.cell * scale)
        j = int((z - grid.z0) / grid.cell * scale)
        img[max(j - r, 0):j + r + 1, max(i - r, 0):i + r + 1] = color

    for d in doors:
        slide = d.get("slide", {"dir": (0.0, 0.0), "distance": 0.0})
        for angle, move, color in ((0.0, 0.0, (0.9, 0.1, 0.1)), (d["openAngle"], slide["distance"], (0.1, 0.7, 0.1))):
            hx, hz = d["hinge"][0] + slide["dir"][0] * move, d["hinge"][1] + slide["dir"][1] * move
            vx, vz = geom.rot_y(d["dir"], angle)
            for k in range(21):
                f = d["width"] * k / 20
                dot(hx + vx * f, hz + vz * f, color, 0)
    for x, z in switch_points:
        dot(x, z, (0.1, 0.3, 0.95), 2)
    dot(spawn["x"], spawn["z"], (0.95, 0.8, 0.1), 3)
    dx, dz = -math.sin(spawn["yaw"]), -math.cos(spawn["yaw"])
    for k in range(1, 9):
        dot(spawn["x"] + dx * 0.05 * k, spawn["z"] + dz * 0.05 * k, (0.95, 0.8, 0.1), 1)
    return img


def save_map(path, grid, doors, switch_points, spawn):
    import bpy

    rgb = render_map(grid, doors, switch_points, spawn)
    h, w, _ = rgb.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = rgb[::-1]  # Blender stores the bottom row first
    img = bpy.data.images.new("debug_map", w, h, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.save(filepath=path)
    bpy.data.images.remove(img)
