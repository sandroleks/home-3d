"""Pure numpy image/grid helpers (no bpy)."""
import math

import numpy as np


def texture_size_for_area(area_m2, texels_per_m, lo, hi):
    want = math.sqrt(max(area_m2, 0.0)) * texels_per_m
    size = lo
    while size < want and size < hi:
        size *= 2
    return min(size, hi)


def rgbm_encode(rgb, mask=None, max_range=64.0):
    """Encode linear HDR rgb (h, w, 3) as RGBM. Returns (rgba in [0, 1] on a 1/255 grid, range)."""
    rgb = np.clip(np.asarray(rgb, dtype=np.float64), 0.0, None)
    if mask is None:
        mask = np.ones(rgb.shape[:-1], dtype=bool)
    peak = rgb.max(axis=-1)
    valid = peak[mask]
    top = float(np.percentile(valid, 99.9)) if valid.size else 1.0
    rng = float(min(max(math.ceil(top * 2) / 2, 1.0), max_range))
    m = np.clip(peak / rng, 1.0 / 255.0, 1.0)
    m = np.ceil(m * 255.0) / 255.0
    enc = np.clip(rgb / (m[..., None] * rng), 0.0, 1.0)
    out = np.zeros(rgb.shape[:-1] + (4,), dtype=np.float32)
    out[..., :3] = np.round(enc * 255.0) / 255.0
    out[..., 3] = m
    out[~mask] = 0.0
    return out, rng


def rgbm_decode(rgba, rng):
    rgba = np.asarray(rgba, dtype=np.float64)
    return rgba[..., :3] * rgba[..., 3:4] * rng


def _shift(a, dy, dx):
    """out[y + dy, x + dx] = a[y, x], filling with zeros."""
    out = np.zeros_like(a)
    h, w = a.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


def masked_blur(rgb, mask, sigma):
    """Gaussian blur that only averages pixels where mask is True."""
    rgb = np.asarray(rgb, dtype=np.float64)
    if sigma <= 0:
        return rgb.astype(np.float32)
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    m = mask.astype(np.float64)
    num, den = rgb * m[..., None], m
    for axis in (0, 1):
        num_acc, den_acc = np.zeros_like(num), np.zeros_like(den)
        for i, wgt in zip(range(-r, r + 1), k):
            dy, dx = (i, 0) if axis == 0 else (0, i)
            num_acc += wgt * _shift(num, dy, dx)
            den_acc += wgt * _shift(den, dy, dx)
        num, den = num_acc, den_acc
    out = np.where(den[..., None] > 1e-6, num / np.maximum(den[..., None], 1e-6), 0.0)
    out[~mask] = 0.0
    return out.astype(np.float32)


def dilate(mask, radius_cells):
    out = mask.copy()
    r = int(radius_cells)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r:
                out |= _shift(mask, dy, dx)
    return out


def rle_encode(flags):
    """Run lengths of alternating values, starting with False (row-major)."""
    flags = np.asarray(flags).astype(bool).ravel()
    runs, current, count = [], False, 0
    for v in flags.tolist():
        if v == current:
            count += 1
        else:
            runs.append(count)
            current, count = v, 1
    runs.append(count)
    return runs


def rle_decode(runs, n):
    out = np.zeros(n, dtype=bool)
    pos, value = 0, False
    for run in runs:
        if value:
            out[pos:pos + run] = True
        pos += run
        value = not value
    if pos != n:
        raise ValueError(f"RLE covers {pos} cells, expected {n}")
    return out
