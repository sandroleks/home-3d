"""Seamless texture tiles made from noise (pure numpy, no bpy): periodic by construction, so they repeat without
seams. Used for materials shared by many objects (oak), which would otherwise each bake their own small texture."""
import numpy as np


def periodic_noise(size, scale_u, scale_v, seed):
    """(size, size) noise that wraps at the edges, mean 0 and std 1. scale_u, scale_v: feature size as a share of the
    tile along each axis (columns, rows); unequal scales stretch it (grain)."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((size, size))
    ku = np.fft.fftfreq(size)[None, :] * size * scale_u
    kv = np.fft.fftfreq(size)[:, None] * size * scale_v
    filt = np.exp(-(ku * ku + kv * kv))
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    out -= out.mean()
    return out / max(out.std(), 1e-12)


def wood_height(size, seed=7):
    """Grain along the rows' direction (v): long fine streaks, broader bands and a few dark lines, 0..1."""
    fine = periodic_noise(size, 0.004, 0.08, seed)
    broad = periodic_noise(size, 0.02, 0.25, seed + 1)
    warp = periodic_noise(size, 0.03, 0.2, seed + 2)
    u = np.arange(size)[None, :] / size
    lines = np.cos(2 * np.pi * (u * 9 + 0.08 * warp))  # nine figure lines across the tile, wandering
    lines = np.clip((lines - 0.86) / 0.14, 0, 1)
    h = 0.45 * fine + 0.35 * broad - 1.2 * lines
    h -= h.min()
    return h / max(h.max(), 1e-12)


def colourise(height, mean_rgb, contrast):
    """Linear RGB (size, size, 3) whose mean is mean_rgb: lighter and darker around it with height, darker parts a
    little richer (wood darkens toward saturation)."""
    mean = np.asarray(mean_rgb, dtype=np.float64)
    d = (height - height.mean())[..., None] * 2 * contrast
    rich = np.power(np.clip(mean, 1e-4, 1), 1.0 + np.clip(-d, 0, None))  # toward saturated where darker
    out = np.where(d < 0, rich * (1 + d), mean * (1 + d))
    out = np.clip(out, 0, 1)
    return np.clip(out * (mean / np.clip(out.reshape(-1, 3).mean(0), 1e-6, None)), 0, 1)


def normal_from_height(height, strength):
    """Tangent-space normal map (size, size, 3) in 0..1 (OpenGL: +Y up, rows bottom to top) from a wrapping height
    field; strength scales the slopes."""
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5 * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def box_uvs(co, normals, size, tile_m):
    """Per-face-corner UVs for a box projection in the object's own axes: each face takes the two axes across its
    normal, scaled to the object's size (m) over tile_m, with v along the longer of the two object dimensions (wood
    grain runs along a board). co: (n, 3) corners in object space; normals: (n, 3) their face normals; size: the
    object's world size per local axis (scale). Returns (n, 2), shifted near 0."""
    co = np.asarray(co, dtype=np.float64) * np.asarray(size)[None, :]
    nrm = np.abs(np.asarray(normals, dtype=np.float64))
    dims = co.max(0) - co.min(0) if len(co) else np.zeros(3)
    axis = nrm.argmax(1)
    uv = np.zeros((len(co), 2))
    for a in range(3):
        sel = axis == a
        if not sel.any():
            continue
        others = [b for b in range(3) if b != a]
        v_axis = max(others, key=lambda b: dims[b])
        u_axis = others[0] if others[1] == v_axis else others[1]
        uv[sel, 0] = co[sel, u_axis] / tile_m
        uv[sel, 1] = co[sel, v_axis] / tile_m
    if len(uv):
        uv -= np.floor(uv.min(0))
    return uv
