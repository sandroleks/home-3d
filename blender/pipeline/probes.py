"""Reflection probes: each room seen from its middle, once lit by the sky layer and once by its wall switch, as the
lightmaps are. Six perspective faces are rendered in Cycles and resampled here into an equirectangular map in three.js's
convention (the viewer prefilters it), RGBM WebP like the lightmaps.

The numpy half (face_directions, cube_to_equirect, mean_radiance, room_probe) needs no Blender."""
import math
import os

import numpy as np

from . import config, geom, raster

# three.js cube faces: (forward, up) in three.js space. Any order works: cube_to_equirect picks by direction.
FACES = (
    ((1, 0, 0), (0, 1, 0)), ((-1, 0, 0), (0, 1, 0)),
    ((0, 1, 0), (0, 0, -1)), ((0, -1, 0), (0, 0, 1)),
    ((0, 0, 1), (0, 1, 0)), ((0, 0, -1), (0, 1, 0)),
)


def face_basis(forward, up):
    f = np.asarray(forward, dtype=np.float64)
    u = np.asarray(up, dtype=np.float64)
    r = np.cross(f, u)  # a camera looking along f with u up has r on its right (right-handed)
    return f, u, r


def face_directions(n, forward, up):
    """(n, n, 3) unit directions of a 90 degree face's pixel centres, row 0 at the top of the picture."""
    f, u, r = face_basis(forward, up)
    t = (np.arange(n) + 0.5) / n * 2 - 1
    x = t[None, :, None]
    y = -t[:, None, None]
    d = f + x * r + y * u
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def equirect_directions(w, h):
    """(h, w, 3) directions of an equirectangular map's texels in three.js's convention (equirectUv): row 0 looks
    straight down, u = atan2(z, x) / 2pi + 0.5."""
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    phi = (u - 0.5) * 2 * math.pi
    theta = (v - 0.5) * math.pi
    ct = np.cos(theta)[:, None]
    return np.stack([ct * np.cos(phi)[None, :], np.repeat(np.sin(theta)[:, None], w, 1), ct * np.sin(phi)[None, :]], -1)


def _sample(face, a, b):
    """Bilinear lookup in face (n, n, c) at continuous pixel coordinates a (column), b (row)."""
    n = face.shape[0]
    a = np.clip(a - 0.5, 0, n - 1)
    b = np.clip(b - 0.5, 0, n - 1)
    a0 = np.floor(a).astype(int)
    b0 = np.floor(b).astype(int)
    a1 = np.minimum(a0 + 1, n - 1)
    b1 = np.minimum(b0 + 1, n - 1)
    fa = (a - a0)[..., None]
    fb = (b - b0)[..., None]
    top = face[b0, a0] * (1 - fa) + face[b0, a1] * fa
    bottom = face[b1, a0] * (1 - fa) + face[b1, a1] * fa
    return top * (1 - fb) + bottom * fb


def cube_to_equirect(faces, w, h):
    """faces: [(n, n, c)] rendered for FACES, row 0 at the top. Returns (h, w, c), row 0 looking down."""
    dirs = equirect_directions(w, h)
    out = np.zeros((h, w, faces[0].shape[-1]))
    best = np.full((h, w), -np.inf)
    n = faces[0].shape[0]
    for face, (forward, up) in zip(faces, FACES):
        f, u, r = face_basis(forward, up)
        along = dirs @ f
        mine = (along > best) & (along > 0)
        if not mine.any():
            continue
        best = np.where(mine, along, best)
        d = dirs[mine] / along[mine][:, None]
        a = (d @ r + 1) / 2 * n
        b = (1 - d @ u) / 2 * n
        out[mine] = _sample(face, a, b)
    return out


def mean_radiance(equirect):
    """Solid-angle mean of an equirectangular map (h, w, 3)."""
    h = equirect.shape[0]
    theta = ((np.arange(h) + 0.5) / h - 0.5) * math.pi
    wgt = np.cos(theta)[:, None, None]
    return (equirect * wgt).sum(axis=(0, 1)) / (wgt.sum() * equirect.shape[1])


def room_probe(floor, bounds, eye=config.PROBE_HEIGHT):
    """Where a room's probe is taken (three.js space): its floor's area-weighted middle at `eye` m. floor: flat
    [x0, z0, x1, z1, x2, z2, ...] triangles; bounds: (min xyz, max xyz) of the room in three.js space."""
    t = np.asarray(floor, dtype=np.float64).reshape(-1, 3, 2)
    e1, e2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]
    area = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) / 2
    c = (t.mean(axis=1) * area[:, None]).sum(0) / max(area.sum(), 1e-9)
    lo, hi = np.asarray(bounds[0]), np.asarray(bounds[1])
    y = float(np.clip(lo[1] + eye, lo[1] + 0.1, hi[1] - 0.1))
    return [round(float(c[0]), 4), round(y, 4), round(float(c[1]), 4)]


# ---- Blender ----

def _camera(name):
    import bpy

    cam = bpy.data.objects.get(name)
    if cam is None:
        data = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "PERSP"
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.angle = math.pi / 2
    cam.data.clip_start = 0.02
    cam.data.clip_end = 200.0
    return cam


def _look(cam, at, forward, up):
    """Blender cameras look down local -Z with +Y up; at, forward and up in three.js space."""
    from mathutils import Matrix, Vector

    f = Vector(geom.from_three(forward))
    u = Vector(geom.from_three(up))
    r = f.cross(u)
    rot = Matrix((r, u, -f)).transposed()
    cam.matrix_world = Matrix.Translation(Vector(geom.from_three(at))) @ rot.to_4x4()


def _render_faces(scene, cam, at, n, tmp):
    import bpy

    faces = []
    for i, (forward, up) in enumerate(FACES):
        _look(cam, at, forward, up)
        path = os.path.join(tmp, f"probe_face_{i}.exr")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(n * n * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        faces.append(px.reshape(n, n, 4)[::-1, :, :3].astype(np.float64))  # bpy rows run bottom to top
    return faces


class Renderer:
    """Renders the probes for a list of rooms: [{"id", "at"}] in three.js space."""

    def __init__(self, scene, quality, tmp):
        self.scene, self.tmp, self.n = scene, tmp, quality.probe_face
        self.cam = _camera("WEB_PROBE_CAMERA")
        r = scene.render
        self.saved = (scene.camera, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
                      r.image_settings.file_format, r.image_settings.color_depth, scene.cycles.samples,
                      scene.cycles.use_denoising, r.film_transparent, r.use_persistent_data)
        scene.camera = self.cam
        r.resolution_x = r.resolution_y = self.n
        r.resolution_percentage = 100
        r.image_settings.file_format = "OPEN_EXR"
        r.image_settings.color_depth = "32"
        r.film_transparent = False
        r.use_persistent_data = True
        scene.cycles.samples = quality.probe_samples
        scene.cycles.use_denoising = True

    def render(self, at):
        faces = _render_faces(self.scene, self.cam, at, self.n, self.tmp)
        return cube_to_equirect(faces, 4 * self.n, 2 * self.n)

    def restore(self):
        s, r = self.scene, self.scene.render
        (s.camera, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath, r.image_settings.file_format,
         r.image_settings.color_depth, s.cycles.samples, s.cycles.use_denoising, r.film_transparent,
         r.use_persistent_data) = self.saved
        import bpy

        bpy.data.objects.remove(self.cam, do_unlink=True)


def save_probe(equirect, out_dir, name):
    """RGBM WebP next to the lightmaps; returns (file ref, mean radiance)."""
    from . import bake

    rgba, rng = raster.rgbm_encode(equirect)
    path = os.path.join(out_dir, "lightmaps", f"{name}.webp")
    bake.save_rgba(rgba[::-1], path, name)  # save_rgba takes rows bottom to top, as bpy does
    mean = [round(float(v), 6) for v in mean_radiance(equirect)]
    return {"file": f"lightmaps/{name}.webp", "range": rng}, mean
