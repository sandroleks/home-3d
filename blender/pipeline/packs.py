"""Packed lamp layers: up to three 8-bit luminance layers in the RGB of one texture (pure numpy).

Each layer is gamma-encoded against its own range, (L / range)^(1/2.2), and carries a tint: the mean colour of its
light, scaled to unit luminance, which the viewer multiplies back in. Alpha stays opaque: lossless WebP throws away
the colour of fully transparent pixels.
"""
import numpy as np

GAMMA = 2.2
LUMA = np.array([0.2126, 0.7152, 0.0722])
EMPTY = 1e-3  # a layer whose brightest texel is below this adds nothing worth a channel
PER_PACK = 3


def luminance(rgb):
    return np.asarray(rgb, dtype=np.float64) @ LUMA


def layer_meta(rgb, mask):
    """(range, tint) of one layer, or None when it is dark."""
    rgb = np.asarray(rgb, dtype=np.float64)
    lum = luminance(rgb)[mask]
    if lum.size == 0 or lum.max() < EMPTY:
        return None
    rng = float(np.percentile(lum, 99.95))
    rng = max(rng, float(lum.max()) * 0.25, EMPTY)
    tint = rgb[mask].sum(axis=0) / max(float(lum.sum()), 1e-12)
    return float(f"{rng:.5g}"), [round(float(c), 4) for c in tint]


def pack(layers, mask):
    """layers: up to three (h, w, 3) linear rgb arrays on the same UVs. Returns (rgba float32 on a 1/255 grid, metas),
    metas[i] = (range, tint) of channel i."""
    if not 1 <= len(layers) <= PER_PACK:
        raise ValueError(f"a pack holds 1 to {PER_PACK} layers, got {len(layers)}")
    h, w = np.asarray(layers[0]).shape[:2]
    out = np.zeros((h, w, 4), dtype=np.float32)
    metas = []
    for i, rgb in enumerate(layers):
        meta = layer_meta(rgb, mask)
        if meta is None:
            raise ValueError(f"layer {i} is dark; drop it before packing")
        rng, _ = meta
        enc = np.clip(luminance(rgb) / rng, 0.0, 1.0) ** (1.0 / GAMMA)
        out[..., i] = np.round(enc * 255.0) / 255.0
        metas.append(meta)
    out[..., 3] = 1.0
    out[~mask] = 0.0
    return out, metas


def unpack(rgba, metas):
    """The luminance of each packed channel (for tests and checks)."""
    rgba = np.asarray(rgba, dtype=np.float64)
    return [rgba[..., i] ** GAMMA * rng for i, (rng, _) in enumerate(metas)]


def in_packs(items):
    return [items[i:i + PER_PACK] for i in range(0, len(items), PER_PACK)]
