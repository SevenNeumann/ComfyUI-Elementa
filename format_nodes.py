"""Format nodes. Each one outputs IMG_FORMAT - a settings object you plug into the Save node's
`format_settings` input (it then overrides the plain `format` list).

IMG_FORMAT is a dict:  {"format": "psd", ...format specific options...}
"""

import numpy as np
from PIL import Image

from .image_formats import DEFAULTS, SUBSAMPLING, require_jxl
from .psd_writer import BLEND_MODES, write_psd


def tensor_to_rgba(image, mask=None):
    """IMAGE [B,H,W,C] (+ optional MASK used as alpha, like the Save node) -> uint8 HxWx4 (first image of the batch)."""
    t = np.clip(image[0].cpu().numpy(), 0.0, 1.0)
    h, w, c = t.shape
    rgb = (t[..., :3] * 255.0).round().astype(np.uint8)
    native = t[..., 3] if c == 4 else None
    alpha = native
    if mask is not None:
        m = mask[0] if mask.dim() == 3 else mask
        m = np.clip(m.cpu().numpy(), 0.0, 1.0)
        if m.shape != (h, w):
            m = np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)) / 255.0
        alpha = m if native is None else native * m
    if alpha is None:
        alpha = np.ones((h, w), dtype=np.float32)
    return np.dstack((rgb, (alpha * 255.0).round().astype(np.uint8)))


# ---------------------------------------------------------------------------------------------
# PSD
# ---------------------------------------------------------------------------------------------

class PSDLayerNode:
    """One extra PSD layer. Chain several via the `layers` input/output (first node = lowest layer of the group)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "name": ("STRING", {"default": "", "tooltip": "Layer name. Empty = 'Layer 1', 'Layer 2', ... in stack order."}),
                "blend_mode": (BLEND_MODES, {"default": "Normal"}),
                "opacity": ("INT", {"default": 100, "min": 0, "max": 100, "step": 1, "tooltip": "Layer opacity, %."}),
                "x": ("INT", {"default": 0, "min": -16384, "max": 16384, "tooltip": "Left offset on the canvas (the canvas is the size of the main image)."}),
                "y": ("INT", {"default": 0, "min": -16384, "max": 16384, "tooltip": "Top offset on the canvas."}),
                "visible": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Used as the layer's alpha (1 = opaque)."}),
                "layers": ("PSD_LAYERS", {"tooltip": "Previous PSD Layer node(s) - builds a stack. The first one is the lowest."}),
            },
        }

    RETURN_TYPES = ("PSD_LAYERS",)
    RETURN_NAMES = ("layers",)
    FUNCTION = "make"
    CATEGORY = "Elementa/Formats"

    def make(self, image, name, blend_mode, opacity, x, y, visible, mask=None, layers=None):
        chain = list(layers) if layers else []
        chain.append({
            "name": name.strip(), "rgba": tensor_to_rgba(image, mask), "blend": blend_mode,
            "opacity": int(opacity), "x": int(x), "y": int(y), "visible": bool(visible),
        })
        return (chain,)


class PSDFormatNode:
    """Settings for saving a layered Photoshop file. Plug the output into Save -> format_settings."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "color_mode": (["RGB", "CMYK"], {"default": "RGB"}),
                "cmyk_profile": ("STRING", {
                    "default": "",
                    "tooltip": "CMYK only. Path to a CMYK .icc profile (e.g. FOGRA39 / SWOP). The image is converted with it and the profile is embedded. "
                               "Empty = approximate conversion without a profile (Photoshop will ask which profile to assign)."}),
                "compression": (["zip", "raw"], {"default": "zip", "tooltip": "Layer data compression. ZIP = small files (Photoshop reads it natively)."}),
                "main_layer_name": ("STRING", {"default": "", "tooltip": "Name of the main image layer. Empty = the file name."}),
            },
            "optional": {
                "layers_below": ("PSD_LAYERS", {"tooltip": "Layers placed UNDER the main image (e.g. a shadow or a background)."}),
                "layers_above": ("PSD_LAYERS", {"tooltip": "Layers placed ABOVE the main image."}),
            },
        }

    RETURN_TYPES = ("IMG_FORMAT",)
    RETURN_NAMES = ("format_settings",)
    FUNCTION = "make"
    CATEGORY = "Elementa/Formats"

    def make(self, color_mode, cmyk_profile, compression, main_layer_name, layers_below=None, layers_above=None):
        return ({
            "format": "psd",
            "color_mode": color_mode,
            "cmyk_profile": cmyk_profile.strip(),
            "compress": compression == "zip",
            "main_layer_name": main_layer_name.strip(),
            "layers_below": list(layers_below or []),
            "layers_above": list(layers_above or []),
        },)


def save_psd(path, main_rgba, default_name, settings=None):
    """Write a PSD: [layers_below..., main, layers_above...]. `settings` is an IMG_FORMAT dict (or None -> plain RGB)."""
    s = settings or {}
    h, w = main_rgba.shape[:2]
    main = {"name": s.get("main_layer_name") or default_name, "rgba": main_rgba, "x": 0, "y": 0}
    stack = [(L, False) for L in s.get("layers_below", [])] + [(main, True)] + [(L, False) for L in s.get("layers_above", [])]
    n = 0
    layers = []
    for L, is_main in stack:
        L = dict(L)
        if not is_main and not str(L.get("name") or "").strip():
            n += 1
            L["name"] = f"Layer {n}"          # Photoshop-style auto names for unnamed extra layers
        layers.append(L)
    write_psd(path, (w, h), layers, mode=s.get("color_mode", "RGB"),
              cmyk_profile=s.get("cmyk_profile") or None, compress=s.get("compress", True))


# ---------------------------------------------------------------------------------------------
# PNG / JPG / WEBP / JXL
# ---------------------------------------------------------------------------------------------

_BG_TIP = "Solid colour (HEX) that replaces transparency when the alpha is flattened."
_ALPHA_TIP = "keep = write transparency. flatten = composite onto `background` and drop the alpha channel."
_SRGB_TIP = "Embed an sRGB colour profile (useful for colour-managed workflows; adds ~600 bytes)."
_DPI_TIP = "Print resolution stored in the file. 0 = do not write it."


class _RasterFormatNode:
    """Base for the simple raster Format nodes: their output is {"format": <id>, <options...>}."""
    FORMAT = ""
    RETURN_TYPES = ("IMG_FORMAT",)
    RETURN_NAMES = ("format_settings",)
    FUNCTION = "make"
    CATEGORY = "Elementa/Formats"

    def make(self, **options):
        known = DEFAULTS[self.FORMAT]
        return ({"format": self.FORMAT, **{k: v for k, v in options.items() if k in known}},)


class PNGFormatNode(_RasterFormatNode):
    FORMAT = "png"

    @classmethod
    def INPUT_TYPES(cls):
        d = DEFAULTS["png"]
        return {"required": {
            "compress_level": ("INT", {"default": d["compress_level"], "min": 0, "max": 9,
                                       "tooltip": "0 = fastest / biggest file, 9 = slowest / smallest. Lossless either way."}),
            "optimize": ("BOOLEAN", {"default": d["optimize"], "tooltip": "Extra optimisation pass for a smaller file (slower, overrides compress_level)."}),
            "dpi": ("INT", {"default": d["dpi"], "min": 0, "max": 2400, "tooltip": _DPI_TIP}),
            "embed_srgb": ("BOOLEAN", {"default": d["embed_srgb"], "tooltip": _SRGB_TIP}),
            "alpha": (["keep", "flatten"], {"default": d["alpha"], "tooltip": _ALPHA_TIP}),
            "background": ("STRING", {"default": d["background"], "tooltip": _BG_TIP}),
        }}


class JPGFormatNode(_RasterFormatNode):
    FORMAT = "jpg"

    @classmethod
    def INPUT_TYPES(cls):
        d = DEFAULTS["jpg"]
        return {"required": {
            "quality": ("INT", {"default": d["quality"], "min": 1, "max": 100, "tooltip": "1-100. 90-95 is visually clean; above 95 the file grows a lot for little gain."}),
            "subsampling": (list(SUBSAMPLING), {"default": d["subsampling"], "tooltip": "Chroma subsampling. 4:4:4 = best colour detail (bigger file), 4:2:0 = smallest."}),
            "progressive": ("BOOLEAN", {"default": d["progressive"], "tooltip": "Progressive JPEG (renders in passes when loading on the web)."}),
            "optimize": ("BOOLEAN", {"default": d["optimize"], "tooltip": "Optimised Huffman tables: a slightly smaller file, same quality."}),
            "dpi": ("INT", {"default": d["dpi"], "min": 0, "max": 2400, "tooltip": _DPI_TIP}),
            "embed_srgb": ("BOOLEAN", {"default": d["embed_srgb"], "tooltip": _SRGB_TIP}),
            "background": ("STRING", {"default": d["background"], "tooltip": "JPG has no transparency: this HEX colour fills it."}),
        }}


class WEBPFormatNode(_RasterFormatNode):
    FORMAT = "webp"

    @classmethod
    def INPUT_TYPES(cls):
        d = DEFAULTS["webp"]
        return {"required": {
            "lossless": ("BOOLEAN", {"default": d["lossless"], "tooltip": "Lossless WebP. With it ON, `quality` only trades speed for file size."}),
            "quality": ("INT", {"default": d["quality"], "min": 0, "max": 100, "tooltip": "Lossy: image quality. Lossless: compression effort."}),
            "method": ("INT", {"default": d["method"], "min": 0, "max": 6, "tooltip": "Encoder effort: 0 = fast, 6 = slowest / smallest."}),
            "alpha_quality": ("INT", {"default": d["alpha_quality"], "min": 0, "max": 100, "tooltip": "Quality of the transparency channel (lossy mode)."}),
            "exact": ("BOOLEAN", {"default": d["exact"], "tooltip": "Keep the RGB values under fully transparent pixels (bigger file). Off = better compression."}),
            "embed_srgb": ("BOOLEAN", {"default": d["embed_srgb"], "tooltip": _SRGB_TIP}),
            "alpha": (["keep", "flatten"], {"default": d["alpha"], "tooltip": _ALPHA_TIP}),
            "background": ("STRING", {"default": d["background"], "tooltip": _BG_TIP}),
        }}


class JXLFormatNode(_RasterFormatNode):
    FORMAT = "jxl"

    @classmethod
    def INPUT_TYPES(cls):
        d = DEFAULTS["jxl"]
        return {"required": {
            "lossless": ("BOOLEAN", {"default": d["lossless"], "tooltip": "Mathematically lossless JPEG XL. `quality` is ignored while this is ON."}),
            "quality": ("INT", {"default": d["quality"], "min": 1, "max": 100, "tooltip": "Lossy quality (used only when lossless is OFF). ~90 is visually transparent."}),
            "effort": ("INT", {"default": d["effort"], "min": 1, "max": 9, "tooltip": "Encoder effort: 1 = fastest, 9 = slowest / smallest. 7 is a good balance."}),
            "decoding_speed": ("INT", {"default": d["decoding_speed"], "min": 0, "max": 4, "tooltip": "0 = best compression, 4 = fastest decoding (slightly bigger files)."}),
            "alpha": (["keep", "flatten"], {"default": d["alpha"], "tooltip": _ALPHA_TIP}),
            "background": ("STRING", {"default": d["background"], "tooltip": _BG_TIP}),
        }}

    def make(self, **options):
        require_jxl()          # fail fast, with the exact install command for THIS Python
        return super().make(**options)


NODE_CLASS_MAPPINGS = {
    "Elementa_PSDLayer": PSDLayerNode,
    "Elementa_FormatPSD": PSDFormatNode,
    "Elementa_FormatPNG": PNGFormatNode,
    "Elementa_FormatJPG": JPGFormatNode,
    "Elementa_FormatWEBP": WEBPFormatNode,
    "Elementa_FormatJXL": JXLFormatNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "Elementa_PSDLayer": "PSD Layer",
    "Elementa_FormatPSD": "Format: PSD",
    "Elementa_FormatPNG": "Format: PNG",
    "Elementa_FormatJPG": "Format: JPG",
    "Elementa_FormatWEBP": "Format: WEBP",
    "Elementa_FormatJXL": "Format: JXL (JPEG XL)",
}
