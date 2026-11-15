"""Raster encoders (PNG / JPG / WEBP / JXL) and the option set of every format.

Each encoder takes an uint8 RGBA array plus a dict of options; options that are missing fall back to DEFAULTS.
The same dicts are produced by the "Format: ..." nodes (see format_nodes.py) and consumed by the Save node.
"""

import os
import sys

import numpy as np
from PIL import Image

from .psd_writer import srgb_icc

SUBSAMPLING = {"4:4:4": 0, "4:2:2": 1, "4:2:0": 2}

# Defaults used by the Format nodes and by the Save node when no Format node is connected.
DEFAULTS = {
    "png":  {"compress_level": 6, "optimize": False, "dpi": 0, "embed_srgb": False,
             "alpha": "keep", "background": "#FFFFFF"},
    "jpg":  {"quality": 95, "subsampling": "4:2:0", "progressive": False, "optimize": False,
             "dpi": 0, "embed_srgb": False, "background": "#FFFFFF"},
    "webp": {"lossless": False, "quality": 90, "method": 4, "alpha_quality": 100, "exact": False,
             "embed_srgb": False, "alpha": "keep", "background": "#FFFFFF"},
    "jxl":  {"lossless": True, "quality": 90, "effort": 7, "decoding_speed": 0,
             "alpha": "keep", "background": "#FFFFFF"},
}


def hex_to_rgb(value, fallback=(255, 255, 255)):
    h = str(value or "").strip().lstrip("#")
    try:
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) != 6:
            raise ValueError
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


def require_jxl():
    """Make sure the JPEG XL writer is available in THIS Python (the one running ComfyUI)."""
    try:
        import pillow_jxl  # noqa: F401  (registers the JXL plugin in Pillow)
    except ImportError:
        install_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "install.py")
        raise RuntimeError(
            "JPEG XL needs the 'pillow-jxl-plugin' package in the Python that runs ComfyUI.\n"
            "Install it with:\n"
            f'    "{sys.executable}" -m pip install pillow-jxl-plugin\n'
            "or install every dependency of this pack at once:\n"
            f'    "{sys.executable}" "{install_py}"'
        )


def _flatten(pil_rgba, background):
    """Composite transparency onto a solid colour -> RGB."""
    bg = Image.new("RGB", pil_rgba.size, hex_to_rgb(background))
    bg.paste(pil_rgba, mask=pil_rgba.getchannel("A"))
    return bg


def save_raster(path, rgba, fmt, options=None):
    """Write `rgba` (uint8 HxWx4) to `path` as png / jpg / webp / jxl using `options` (a dict, unknown keys ignored)."""
    fmt = fmt.lower()
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in DEFAULTS:
        raise ValueError(f"Unsupported raster format: {fmt}")
    o = dict(DEFAULTS[fmt])
    o.update({k: v for k, v in (options or {}).items() if k in DEFAULTS[fmt]})

    if fmt == "jxl":
        require_jxl()                       # fail before anything is written

    pil = Image.fromarray(np.ascontiguousarray(rgba))
    if fmt == "jpg" or o.get("alpha") == "flatten":
        pil = _flatten(pil, o["background"])

    icc = srgb_icc() if o.get("embed_srgb") else None
    dpi = int(o.get("dpi") or 0)

    if fmt == "png":
        kw = {"compress_level": int(o["compress_level"]), "optimize": bool(o["optimize"])}
        if dpi:
            kw["dpi"] = (dpi, dpi)
        if icc:
            kw["icc_profile"] = icc
        pil.save(path, format="PNG", **kw)

    elif fmt == "jpg":
        kw = {"quality": int(o["quality"]), "subsampling": SUBSAMPLING.get(o["subsampling"], 2),
              "progressive": bool(o["progressive"]), "optimize": bool(o["optimize"])}
        if dpi:
            kw["dpi"] = (dpi, dpi)
        if icc:
            kw["icc_profile"] = icc
        pil.save(path, format="JPEG", **kw)

    elif fmt == "webp":
        kw = {"lossless": bool(o["lossless"]), "quality": int(o["quality"]), "method": int(o["method"]),
              "alpha_quality": int(o["alpha_quality"]), "exact": bool(o["exact"])}
        if icc:
            kw["icc_profile"] = icc
        pil.save(path, format="WEBP", **kw)

    else:  # jxl
        pil.save(path, format="JXL", lossless=bool(o["lossless"]), quality=int(o["quality"]),
                 effort=int(o["effort"]), decoding_speed=int(o["decoding_speed"]))
