"""Cycles reference renders of the viewpoint cameras, to compare with the viewer.

Run through the Makefile (`make render-refs`, or `make render-refs SUN=2026-12-21T10:00`). With --sun the scene
is lit like the viewer at that moment (Lisbon time): the Sun lamp is pointed and sized from the site, the NOAA
position and the typical-month data; the sky is the day bake's flat sky scaled to the typical diffuse light; lamps
and glowing materials are off. Without --sun the scene renders as it is.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from pipeline import config, lamps, sun  # noqa: E402


def light_for(scene, when, climate):
    site = config.SITE
    t = sun.lisbon_to_utc_seconds(when, site["timeZone"])
    az, el = sun.solar_position(t, site["lat"], site["lon"])
    beam, diffuse = sun.typical_irradiance(climate, t)
    lamp = scene.objects["Sun"]
    lamp.rotation_mode = "QUATERNION"
    lamp.rotation_quaternion = Vector(sun.blender_direction(az, el, site["yBearing"])).to_track_quat("Z", "Y")
    lamp.data.energy = sun.sun_strength(beam, el) * config.WATTS_TO_SCENE
    lamp.hide_render = False
    for o in scene.objects:
        if o.type == "LIGHT" and o is not lamp:
            o.hide_render = o.hide_render or not lamps.is_day_fill(o)
    tree = scene.world.node_tree
    bg = next(n for n in tree.nodes if n.type == "BACKGROUND")
    for link in [l for l in tree.links if l.to_socket == bg.inputs["Color"]]:
        tree.links.remove(link)
    baked = bg.inputs["Strength"].default_value
    bg.inputs["Color"].default_value = (*config.SKY_BAKE_COLOR, 1.0)
    r, g, b = config.SKY_BAKE_COLOR
    bg.inputs["Strength"].default_value = diffuse * config.WATTS_TO_SCENE / (math.pi * (0.2126 * r + 0.7152 * g + 0.0722 * b))
    # The window-fill portal lights are part of the sky layer in the viewer: they scale with the sky.
    for o in scene.objects:
        if o.type == "LIGHT" and lamps.is_day_fill(o):
            o.data.energy *= bg.inputs["Strength"].default_value / baked
    for mat in bpy.data.materials:
        for n in (mat.node_tree.nodes if mat.node_tree else []):
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Emission Strength"].default_value = 0.0
            elif n.type == "EMISSION":
                n.inputs["Strength"].default_value = 0.0
    print(f"[refs] {when}: sun az {az:.1f} el {el:.1f}, strength {lamp.data.energy:.3f}, "
          f"sky strength {bg.inputs['Strength'].default_value:.3f}", flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="render_refs")
    p.add_argument("--out", required=True)
    p.add_argument("--sun")
    p.add_argument("--climate")
    args = p.parse_args(argv)
    scene = bpy.context.scene
    suffix = ""
    if args.sun:
        with open(args.climate) as f:
            light_for(scene, args.sun, json.load(f))
        suffix = "_" + args.sun.replace(":", "")
    scene.frame_set(scene.frame_end)
    scene.render.resolution_percentage = 50
    scene.render.image_settings.file_format = "PNG"
    for cam in config.VIEWPOINT_CAMERAS:
        if cam not in scene.objects:
            continue
        scene.camera = scene.objects[cam]
        scene.render.filepath = os.path.abspath(os.path.join(args.out, f"{cam}{suffix}.png"))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
