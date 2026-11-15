"""Dependency-free PSD writer: 8-bit RGB or CMYK, any number of layers (own size + offset, blend mode,
opacity, visibility, Unicode names), embedded ICC profile.

Layer pixel data is ZIP-compressed (Photoshop-native, small); the merged preview image is stored raw.
CMYK: optional ICC conversion (Pillow/littlecms) + the profile is embedded, otherwise an approximate
formula is used and Photoshop will ask which profile to assign.
"""

import os
import struct
import zlib

import numpy as np

# Photoshop blend-mode keys
BLEND_KEYS = {
    "Normal": b"norm", "Multiply": b"mul ", "Screen": b"scrn", "Overlay": b"over",
    "Soft Light": b"sLit", "Hard Light": b"hLit", "Darken": b"dark", "Lighten": b"lite",
    "Color Dodge": b"div ", "Color Burn": b"idiv", "Linear Dodge (Add)": b"lddg", "Linear Burn": b"lbrn",
    "Difference": b"diff", "Exclusion": b"smud",
    "Hue": b"hue ", "Saturation": b"sat ", "Color": b"colr", "Luminosity": b"lum ",
}
BLEND_MODES = list(BLEND_KEYS)


# ---------------------------------------------------------------------------------------------
# small binary helpers
# ---------------------------------------------------------------------------------------------

def _pascal(name):
    b = "".join(c if 32 <= ord(c) < 127 else "_" for c in name).encode("ascii")[:255]
    data = bytes([len(b)]) + b
    return data + b"\0" * ((4 - len(data) % 4) % 4)


def _luni(name):
    u = name.encode("utf-16-be")
    body = struct.pack(">I", len(u) // 2) + u
    body += b"\0" * ((4 - len(body) % 4) % 4)
    return b"8BIM" + b"luni" + struct.pack(">I", len(body)) + body


def _icc_resource(data):
    block = b"8BIM" + struct.pack(">H", 0x040F) + b"\0\0" + struct.pack(">I", len(data)) + data
    if len(data) % 2:
        block += b"\0"
    return struct.pack(">I", len(block)) + block


def srgb_icc():
    from PIL import ImageCms
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


# ---------------------------------------------------------------------------------------------
# colour: RGB -> CMYK
# ---------------------------------------------------------------------------------------------

def make_cmyk_converter(profile_path=None):
    """Returns (convert, icc_bytes). convert(rgb uint8 HxWx3) -> ink coverage uint8 HxWx4 (255 = 100% ink)."""
    if profile_path:
        from PIL import Image, ImageCms
        path = os.path.expanduser(str(profile_path).strip().strip('"'))
        if not os.path.isfile(path):
            raise ValueError(f"CMYK profile not found: {path}")
        try:
            prof = ImageCms.getOpenProfile(path)
        except Exception as e:
            raise ValueError(f"Cannot read ICC profile {path}: {e}")
        if prof.profile.xcolor_space.strip() != "CMYK":
            raise ValueError(f"{os.path.basename(path)} is not a CMYK profile (it is {prof.profile.xcolor_space.strip()})")
        intent = getattr(getattr(ImageCms, "Intent", None), "RELATIVE_COLORIMETRIC", 1)
        flags = getattr(getattr(ImageCms, "Flags", None), "BLACKPOINTCOMPENSATION", 0x2000)
        tr = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), prof, "RGB", "CMYK",
                                     renderingIntent=intent, flags=flags)

        def convert(rgb):
            out = ImageCms.applyTransform(Image.fromarray(np.ascontiguousarray(rgb), "RGB"), tr)
            return np.asarray(out, dtype=np.uint8)

        with open(path, "rb") as f:
            return convert, f.read()

    def naive(rgb):                       # approximate: full black generation, no profile
        f = rgb.astype(np.float32) / 255.0
        k = 1.0 - f.max(axis=-1, keepdims=True)
        d = np.maximum(1.0 - k, 1e-6)
        ink = np.concatenate([(1 - f[..., 0:1] - k) / d, (1 - f[..., 1:2] - k) / d, (1 - f[..., 2:3] - k) / d, k], -1)
        ink = np.where(k >= 0.9999, np.concatenate([np.zeros_like(ink[..., :3]), k], -1), ink)
        return (np.clip(ink, 0, 1) * 255.0 + 0.5).astype(np.uint8)

    return naive, None


# ---------------------------------------------------------------------------------------------
# preview composite (separable blend modes; Hue/Saturation/Color/Luminosity fall back to Normal here -
# Photoshop itself always recomputes the real result from the layers)
# ---------------------------------------------------------------------------------------------

def _blend(mode, cb, cs):
    if mode == "Multiply":
        return cb * cs
    if mode == "Screen":
        return cb + cs - cb * cs
    if mode in ("Overlay", "Hard Light"):
        a, b = (cs, cb) if mode == "Overlay" else (cb, cs)     # overlay(cb,cs) = hardlight(cs,cb)
        return np.where(b <= 0.5, a * 2 * b, a + (2 * b - 1) - a * (2 * b - 1))
    if mode == "Soft Light":
        d = np.where(cb <= 0.25, ((16 * cb - 12) * cb + 4) * cb, np.sqrt(cb))
        return np.where(cs <= 0.5, cb - (1 - 2 * cs) * cb * (1 - cb), cb + (2 * cs - 1) * (d - cb))
    if mode == "Darken":
        return np.minimum(cb, cs)
    if mode == "Lighten":
        return np.maximum(cb, cs)
    if mode == "Difference":
        return np.abs(cb - cs)
    if mode == "Exclusion":
        return cb + cs - 2 * cb * cs
    if mode == "Color Dodge":
        return np.where(cb <= 0, 0.0, np.where(cs >= 1, 1.0, np.minimum(1.0, cb / np.maximum(1 - cs, 1e-6))))
    if mode == "Color Burn":
        return np.where(cb >= 1, 1.0, np.where(cs <= 0, 0.0, 1 - np.minimum(1.0, (1 - cb) / np.maximum(cs, 1e-6))))
    if mode == "Linear Dodge (Add)":
        return np.minimum(1.0, cb + cs)
    if mode == "Linear Burn":
        return np.maximum(0.0, cb + cs - 1)
    return cs


def composite_rgba(W, H, layers):
    """Flatten layers (bottom -> top) onto a transparent WxH canvas. Returns uint8 HxWx4."""
    rgb = np.zeros((H, W, 3), np.float32)
    alpha = np.zeros((H, W, 1), np.float32)
    for L in layers:
        if not L.get("visible", True):
            continue
        arr = L["rgba"]
        h, w = arr.shape[:2]
        x, y = int(L.get("x", 0)), int(L.get("y", 0))
        x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
        if x0 >= x1 or y0 >= y1:
            continue
        src = arr[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32) / 255.0
        cs, a_s = src[..., :3], src[..., 3:4] * (float(L.get("opacity", 100)) / 100.0)
        cb, a_b = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
        mixed = _blend(L.get("blend", "Normal"), cb, cs)
        ao = a_s + a_b * (1 - a_s)
        num = (1 - a_s) * a_b * cb + a_s * ((1 - a_b) * cs + a_b * mixed)
        rgb[y0:y1, x0:x1] = np.where(ao > 1e-6, num / np.maximum(ao, 1e-6), 0)
        alpha[y0:y1, x0:x1] = ao
    return (np.clip(np.concatenate([rgb, alpha], -1), 0, 1) * 255.0 + 0.5).astype(np.uint8)


# ---------------------------------------------------------------------------------------------
# writer
# ---------------------------------------------------------------------------------------------

def write_psd(path, size, layers, mode="RGB", cmyk_profile=None, compress=True):
    """size: (W, H) canvas. layers: bottom -> top list of dicts:
         name, rgba (uint8 hxwx4), x=0, y=0, blend="Normal", opacity=100 (%), visible=True
       mode: "RGB" | "CMYK"."""
    W, H = size
    mode = mode.upper()
    cmyk = mode == "CMYK"
    if not layers:
        raise ValueError("PSD needs at least one layer")
    conv, icc = make_cmyk_converter(cmyk_profile) if cmyk else (None, srgb_icc())

    def planes(rgba):
        """-> [(channel id, uint8 HxW plane)] in file order."""
        if cmyk:
            ink = conv(np.ascontiguousarray(rgba[..., :3]))
            return [(i, 255 - ink[..., i]) for i in range(4)] + [(-1, rgba[..., 3])]   # PSD stores CMYK inverted
        return [(0, rgba[..., 0]), (1, rgba[..., 1]), (2, rgba[..., 2]), (-1, rgba[..., 3])]

    recs, blobs = [], []
    for L in layers:
        arr = L["rgba"]
        assert arr.dtype == np.uint8 and arr.ndim == 3 and arr.shape[2] == 4, "layer rgba must be uint8 HxWx4"
        h, w = arr.shape[:2]
        x, y = int(L.get("x", 0)), int(L.get("y", 0))
        chans = planes(arr)
        rec = struct.pack(">iiii", y, x, y + h, x + w) + struct.pack(">H", len(chans))
        for cid, plane in chans:
            raw = np.ascontiguousarray(plane).tobytes()
            comp = struct.pack(">H", 2) + zlib.compress(raw, 6) if compress else struct.pack(">H", 0) + raw
            blobs.append(comp)
            rec += struct.pack(">hI", cid, len(comp))
        opacity = int(round(max(0.0, min(100.0, float(L.get("opacity", 100)))) * 2.55))
        flags = 0 if L.get("visible", True) else 2
        key = BLEND_KEYS.get(L.get("blend", "Normal"), b"norm")
        rec += b"8BIM" + key + bytes([opacity, 0, flags, 0])
        name = str(L.get("name") or "Layer")
        extra = struct.pack(">II", 0, 0) + _pascal(name) + _luni(name)
        rec += struct.pack(">I", len(extra)) + extra
        recs.append(rec)

    layer_info = struct.pack(">h", -len(layers)) + b"".join(recs) + b"".join(blobs)
    if len(layer_info) % 2:
        layer_info += b"\0"
    layer_and_mask = struct.pack(">I", len(layer_info)) + layer_info + struct.pack(">I", 0)

    comp = composite_rgba(W, H, layers)
    merged = b"".join(np.ascontiguousarray(p).tobytes() for _cid, p in planes(comp))

    n_ch = 5 if cmyk else 4
    with open(path, "wb") as f:
        f.write(b"8BPS" + struct.pack(">H", 1) + b"\0" * 6 + struct.pack(">HIIHH", n_ch, H, W, 8, 4 if cmyk else 3))
        f.write(struct.pack(">I", 0))                                   # colour mode data
        f.write(_icc_resource(icc) if icc else struct.pack(">I", 0))    # image resources (ICC profile)
        f.write(struct.pack(">I", len(layer_and_mask)) + layer_and_mask)
        f.write(struct.pack(">H", 0) + merged)                          # merged preview, raw
