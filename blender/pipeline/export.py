"""Camera poses, glTF export and JSON writing."""
import json
import os

import bpy
import numpy as np
from mathutils import Vector

from . import bpyutil, config, geom


def camera_pose(cam):
    m = cam.matrix_world
    pos = geom.to_three(tuple(m.translation))
    fwd = geom.to_three(tuple(m.to_3x3() @ Vector((0.0, 0.0, -1.0))))
    yaw, pitch = geom.yaw_pitch_from_forward(fwd)
    return {
        "name": cam.name,
        "position": [round(v, 4) for v in pos],
        "yaw": round(yaw, 5),
        "pitch": round(pitch, 5),
        "hfov": round(cam.data.angle_x, 5),
    }


def spawn_from(scene, room_list):
    cam = scene.objects.get(config.SPAWN_CAMERA)
    if cam is not None:
        p = camera_pose(cam)
        return {"x": p["position"][0], "z": p["position"][2], "yaw": p["yaw"]}
    c = np.asarray(room_list[0]["floor"]).reshape(-1, 2).mean(0)
    return {"x": round(float(c[0]), 4), "z": round(float(c[1]), 4), "yaw": 0.0}


def viewpoints(scene):
    return [camera_pose(scene.objects[n]) for n in config.VIEWPOINT_CAMERAS if n in scene.objects]


def export_glb(objs, path):
    bpyutil.select_only(objs, objs[0])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="WEBP", export_image_quality=90,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_texcoord_quantization=14, export_cameras=False, export_lights=False,
        export_extras=False, export_yup=True,
    )


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
