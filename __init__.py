import asyncio
import io
import json
import os
import random
import re

import numpy as np
import torch
from PIL import Image, ImageOps

from .image_formats import save_raster
from .format_nodes import save_psd, NODE_CLASS_MAPPINGS as _FMT_NODES, NODE_DISPLAY_NAME_MAPPINGS as _FMT_NAMES

# Without this line ComfyUI does NOT load the JS files from web/
WEB_DIRECTORY = "./web"

# ----------------------------------------------------------------------------
# Shared helpers
# ----------------------------------------------------------------------------

FILETYPE_EXTS = {
    "png": (".png",),
    "jpg": (".jpg", ".jpeg"),
    "webp": (".webp",),
    "bmp": (".bmp",),
    "gif": (".gif",),
    "tiff": (".tif", ".tiff"),
}
FILETYPE_CHOICES = ["all"] + list(FILETYPE_EXTS.keys())
_ALL_EXTS = tuple(sorted({e for v in FILETYPE_EXTS.values() for e in v}))


def _exts_for(filetype):
    if not filetype or filetype == "all":
        return _ALL_EXTS
    return FILETYPE_EXTS.get(filetype, _ALL_EXTS)


def natural_sort_key(s):
    """Natural sort key: img2.png comes before img10.png."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def _clean_path(p):
    return (p or "").strip().strip('"').strip("'")


_RES_CACHE = {}
SORT_CHOICES = ["name", "date", "format", "resolution"]


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def _img_size(path):
    """(w, h) without fully decoding the image; cached by (path, mtime)."""
    key = (path, _mtime(path))
    v = _RES_CACHE.get(key)
    if v is None:
        try:
            with Image.open(path) as im:
                v = im.size
        except Exception:
            v = (0, 0)
        _RES_CACHE[key] = v
    return v


def list_images(folder, include_subfolders=False, filetype="all", reverse=False, sort_by="name"):
    """Absolute paths in sort order (NOT shuffled).
    sort_by: name | date | format | resolution. No glob (it breaks on [ ])."""
    folder = _clean_path(folder)
    if not folder or not os.path.isdir(folder):
        return []

    exts = _exts_for(filetype)
    found = []
    if include_subfolders:
        for root, _d, names in os.walk(folder):
            found += [os.path.join(root, n) for n in names if n.lower().endswith(exts)]
    else:
        try:
            names = os.listdir(folder)
        except OSError:
            return []
        found = [
            os.path.join(folder, n)
            for n in names
            if n.lower().endswith(exts) and os.path.isfile(os.path.join(folder, n))
        ]

    def nat(p):
        return natural_sort_key(os.path.relpath(p, folder))

    if sort_by == "date":
        key = lambda p: (_mtime(p), nat(p))
    elif sort_by == "format":
        key = lambda p: (os.path.splitext(p)[1].lower(), nat(p))
    elif sort_by == "resolution":
        def key(p):
            w, h = _img_size(p)
            return (w * h, w, nat(p))
    else:
        key = nat

    found.sort(key=key)
    if reverse:
        found.reverse()
    return found


def apply_shuffle(files, seed):
    """seed > 0 -> deterministic shuffle (identical for the UI and the node)."""
    seed = int(seed or 0)
    if seed <= 0:
        return list(files)
    out = list(files)
    random.Random(seed).shuffle(out)
    return out


def _rel(folder, path):
    return os.path.relpath(path, _clean_path(folder)).replace("\\", "/")


def _parse_selection(raw):
    """Formats of selected_files_json:
      {"excluded": [...], "order": [...]}  order present -> run ONLY these files, in this order
      {"excluded": [...]}                  everything except the listed files
      ["a.png", ...]                       legacy: only the listed files
      [] / garbage                         everything
    Returns (mode, data): "ordered" -> list, otherwise a set."""
    try:
        data = json.loads(raw or "[]")
    except Exception:
        data = []
    if isinstance(data, dict):
        if isinstance(data.get("order"), list):
            return "ordered", list(data["order"])
        return "excluded", set(data.get("excluded") or [])
    if isinstance(data, list) and data:
        return "included", set(data)
    return "excluded", set()


# ----------------------------------------------------------------------------
# NODE 1: loader
# ----------------------------------------------------------------------------

class AutoFolderImageLoader:

    @classmethod
    def INPUT_TYPES(cls):
        # New widgets are appended at the END so older workflows don't shift.
        return {
            "required": {
                "folder_path": ("STRING", {"default": "C:/my_images"}),
                "index": ("INT", {
                    "default": 0, "min": 0, "max": 0x7FFFFFFF, "step": 1,
                }),
                "reset_to_first": ("BOOLEAN", {"default": False}),
                "selected_files_json": ("STRING", {"default": "[]", "multiline": True}),
                "include_subfolders": ("BOOLEAN", {"default": False}),
                "filetype": (FILETYPE_CHOICES, {"default": "all"}),
                "reverse": ("BOOLEAN", {"default": False}),
                "sort_by": (SORT_CHOICES, {"default": "name"}),
                "shuffle_seed": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("image", "mask", "filename", "index", "total", "file_path")
    FUNCTION = "load_next_image"
    CATEGORY = "Elementa/Batch"

    @classmethod
    def IS_CHANGED(cls, folder_path, index, reset_to_first, selected_files_json="[]",
                   include_subfolders=False, filetype="all", reverse=False,
                   sort_by="name", shuffle_seed=0):
        return (f"{folder_path}|{index}|{reset_to_first}|{selected_files_json}|{include_subfolders}"
                f"|{filetype}|{reverse}|{sort_by}|{shuffle_seed}")

    def load_next_image(self, folder_path, index, reset_to_first, selected_files_json="[]",
                        include_subfolders=False, filetype="all", reverse=False,
                        sort_by="name", shuffle_seed=0):
        base_files = list_images(folder_path, include_subfolders, filetype, reverse, sort_by)
        if not base_files:
            raise ValueError(f"Folder '{folder_path}' has no matching files or does not exist.")

        mode, sel = _parse_selection(selected_files_json)
        if mode == "ordered":      # selection order: shuffle is ignored
            by_rel = {_rel(folder_path, f): f for f in base_files}
            files = [by_rel[r] for r in sel if r in by_rel]
        else:
            all_files = apply_shuffle(base_files, shuffle_seed)
            if mode == "included":   # legacy format
                files = [f for f in all_files
                         if _rel(folder_path, f) in sel or os.path.basename(f) in sel]
            else:
                files = [f for f in all_files if _rel(folder_path, f) not in sel]

        total = len(files)
        if total == 0:
            raise ValueError("No files are selected - select at least one file.")

        pos = 0 if reset_to_first else int(index) % total
        path = os.path.abspath(files[pos])
        stem = os.path.splitext(os.path.basename(path))[0]

        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im).convert("RGBA")
            arr = np.array(im).astype(np.float32) / 255.0

        rgb = torch.from_numpy(arr[:, :, :3]).unsqueeze(0)
        alpha = torch.from_numpy(arr[:, :, 3]).unsqueeze(0)   # alpha as is (1 = opaque)

        return {
            "ui": {"batch_info": [{"name": os.path.basename(path), "rel": _rel(folder_path, path), "path": path, "index": pos, "total": total}]},
            "result": (rgb, alpha, stem, pos + 1, total, path),
        }


# ----------------------------------------------------------------------------
# NODE 2: save
# ----------------------------------------------------------------------------

class SaveSingleImageToFolder:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "output_folder": ("STRING", {"default": "C:/processed_output"}),
                "filename": ("STRING", {"forceInput": True}),
                "prefix": ("STRING", {"default": ""}),
                "suffix": ("STRING", {"default": "_cutout"}),
                "format": (["png", "webp", "jpg", "psd", "jxl"], {"default": "png"}),
                "if_exists": (["overwrite", "increment", "skip"], {"default": "overwrite"}),
            },
            "optional": {
                "mask": ("MASK",),
                "format_settings": ("IMG_FORMAT", {"tooltip": "From a Format node (PNG / JPG / WEBP / JXL / PSD). When connected it overrides the `format` list and carries that format's settings."}),
            },
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save_image"
    CATEGORY = "Elementa/Batch"

    def save_image(self, image, output_folder, filename, prefix, suffix, format,
                   if_exists="overwrite", mask=None, format_settings=None):
        fs = format_settings if isinstance(format_settings, dict) else None
        if fs:
            format = fs.get("format", format)
        output_folder = _clean_path(output_folder)
        os.makedirs(output_folder, exist_ok=True)

        t = np.clip(image[0].cpu().numpy(), 0.0, 1.0)
        h, w, ch = t.shape
        rgb = (t[..., :3] * 255.0).round().astype(np.uint8)
        native = t[..., 3] if ch == 4 else None

        alpha = native
        if mask is not None:
            m = mask[0] if mask.dim() == 3 else mask
            m = np.clip(m.cpu().numpy(), 0.0, 1.0)
            if m.shape != (h, w):   # mask of a different size
                m = np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)) / 255.0
            alpha = m if native is None else native * m
        if alpha is None:
            alpha = np.ones((h, w), dtype=np.float32)

        rgba = np.dstack((rgb, (alpha * 255.0).round().astype(np.uint8)))

        base = f"{prefix}{filename}{suffix}"
        ext = "jpg" if format.lower() in ("jpg", "jpeg") else format.lower()
        path = os.path.join(output_folder, f"{base}.{ext}")

        if os.path.exists(path):
            if if_exists == "skip":
                return {}
            if if_exists == "increment":
                n = 1
                while os.path.exists(os.path.join(output_folder, f"{base}_{n}.{ext}")):
                    n += 1
                path = os.path.join(output_folder, f"{base}_{n}.{ext}")

        stem = os.path.splitext(os.path.basename(path))[0]
        if ext == "psd":                       # layered PSD (settings from a Format: PSD node, if connected)
            save_psd(path, rgba, stem, fs)
        else:                                  # png / jpg / webp / jxl with the options of the connected Format node
            save_raster(path, rgba, ext, fs)
        return {}


# ----------------------------------------------------------------------------
# API for the frontend
# ----------------------------------------------------------------------------

def _make_thumb(full):
    with Image.open(full) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((256, 256))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=82)
        return buf.getvalue()



# ----------------------------------------------------------------------------
# Server-side folder picker
# ----------------------------------------------------------------------------

def _list_roots():
    roots = []
    if os.name == "nt":
        import string
        for c in string.ascii_uppercase:
            d = f"{c}:\\"
            if os.path.exists(d):
                roots.append({"name": d, "path": d})
    else:
        roots.append({"name": "/", "path": "/"})
    home = os.path.expanduser("~")
    if os.path.isdir(home):
        roots.append({"name": f"~  ({home})", "path": home})
    return roots


def browse_dir(path, filetype="all"):
    path = _clean_path(path)
    if not path or not os.path.isdir(path):
        return {"cwd": "", "parent": None, "is_roots": True, "dirs": _list_roots(), "image_count": 0}
    norm = os.path.normpath(path)
    parent = os.path.dirname(norm)
    if parent == norm:
        parent = ""
    dirs = []
    try:
        for name in os.listdir(norm):
            full = os.path.join(norm, name)
            try:
                if os.path.isdir(full):
                    dirs.append({"name": name, "path": full})
            except OSError:
                continue
    except OSError:
        pass
    dirs.sort(key=lambda d: natural_sort_key(d["name"]))
    return {"cwd": norm, "parent": parent, "is_roots": False, "dirs": dirs,
            "image_count": len(list_images(norm, False, filetype, False))}

try:
    from aiohttp import web
    from server import PromptServer

    def _compute_list(d):
        folder = _clean_path(d.get("folder_path", ""))
        files = list_images(folder, bool(d.get("include_subfolders")), d.get("filetype", "all"),
                            bool(d.get("reverse")), d.get("sort_by", "name"))
        seed = int(d.get("shuffle_seed") or 0)
        rel = [_rel(folder, f) for f in files]
        run = [_rel(folder, f) for f in apply_shuffle(files, seed)] if seed > 0 else None
        return {"count": len(rel), "files": rel, "run": run}

    @PromptServer.instance.routes.post("/elementa/list_files")
    async def _list_files(request):
        try:
            d = await request.json() or {}
            res = await asyncio.get_running_loop().run_in_executor(None, _compute_list, d)
            return web.json_response(res)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/elementa/thumb")
    async def _thumb(request):
        base = os.path.realpath(_clean_path(request.query.get("folder", "")))
        full = os.path.realpath(os.path.join(base, request.query.get("file", "")))
        try:
            inside = os.path.commonpath([base, full]) == base
        except ValueError:
            inside = False
        # safety: only inside the chosen folder and only images
        if not inside or not full.lower().endswith(_ALL_EXTS) or not os.path.isfile(full):
            return web.Response(status=404)
        try:
            data = await asyncio.get_running_loop().run_in_executor(None, _make_thumb, full)
            return web.Response(body=data, content_type="image/jpeg",
                                headers={"Cache-Control": "max-age=60"})
        except Exception as e:
            return web.Response(status=500, text=str(e))

    @PromptServer.instance.routes.post("/elementa/browse")
    async def _browse(request):
        try:
            d = await request.json() or {}
            return web.json_response(browse_dir(d.get("path", ""), d.get("filetype", "all")))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

except Exception as e:
    print(f"[Elementa] API error: {e}")


NODE_CLASS_MAPPINGS = {
    "Elementa_BatchLoader": AutoFolderImageLoader,
    "Elementa_SaveImage": SaveSingleImageToFolder,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "Elementa_BatchLoader": "Auto Folder Batch Loader - AFBL",
    "Elementa_SaveImage": "💾 Save Single Image to Folder",
}

NODE_CLASS_MAPPINGS.update(_FMT_NODES)
NODE_DISPLAY_NAME_MAPPINGS.update(_FMT_NAMES)
