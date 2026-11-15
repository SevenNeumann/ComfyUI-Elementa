# Elementa for ComfyUI

> *Elementa*: the Latin name of Euclid's *Elements*, the book that built geometry from a few pure forms.
> This pack follows the same idea: small, pure building blocks for image pipelines.

Batch loading with a gallery UI, layered PSD export (RGB / CMYK), configurable image formats (PNG, JPG, WEBP, JPEG XL, PSD) and more.
Free and open source (MIT).

## Nodes (so far)
| Menu | Node | What it does |
|---|---|---|
| Elementa/Batch | Auto Folder Batch Loader (AFBL) | Loads a folder one image per run, with a tile/list gallery, selection, shuffle, freeze, progress bar |
| Elementa/Batch | Save Single Image to Folder | Saves PNG / WEBP / JPG / JXL / PSD; connect a Format node to control the format's settings |
| Elementa/Formats | Format: PNG / JPG / WEBP / JXL | Per-format settings (compression, quality, subsampling, lossless, effort, DPI, sRGB profile, alpha flattening ...) |
| Elementa/Formats | Format: PSD, PSD Layer | Layered PSD with extra layers below/above, blend modes, RGB or CMYK (ICC profile) |

How formats work: put a **Format** node next to **Save Single Image** and connect its `format_settings` output to the Save node's
`format_settings` input. When connected, it overrides the plain `format` list.

## Install
**ComfyUI-Manager (once published)**: search for *Elementa*. Dependencies are installed automatically.

**Manual**
```
cd ComfyUI/custom_nodes
git clone https://github.com/SevenNeumann/ComfyUI-Elementa
```
Then install the dependencies **into the Python that runs ComfyUI** (this matters: a different Python means the nodes won't see the packages).
Run the bundled script with that Python:
```powershell
# Windows - ComfyUI with its own venv (e.g. Stability Matrix):
& "<ComfyUI folder>\venv\Scripts\python.exe" "<ComfyUI folder>\custom_nodes\ComfyUI-Elementa\install.py"

# Windows - portable build:
& "<portable folder>\python_embeded\python.exe" "<portable folder>\ComfyUI\custom_nodes\ComfyUI-Elementa\install.py"
```
Linux / macOS: `<ComfyUI>/venv/bin/python custom_nodes/ComfyUI-Elementa/install.py`.
Restart ComfyUI afterwards. If JPEG XL is requested without the package, the node stops with a message that contains the exact command for your Python.

## Development (Windows)
Keep the repo anywhere and link it into ComfyUI (no admin rights needed):
```powershell
New-Item -ItemType Junction -Path "<ComfyUI>\custom_nodes\ComfyUI-Elementa" -Target "<path to this repo>"
```
Python changes need a ComfyUI restart; changes in `web/` only need a browser refresh (Ctrl+F5).

## Notes
- Node IDs are namespaced (`Elementa_*`) so they never collide with other packs.
- Heavy optional dependencies are never forced on you; the nodes tell you what to install when needed.

## License
MIT, see [LICENSE](LICENSE).
