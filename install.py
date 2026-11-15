"""Install this pack's Python dependencies into the Python that runs this script.

Run it with the SAME Python that runs ComfyUI, so the packages land in the right environment, e.g.
    <ComfyUI>\\venv\\Scripts\\python.exe install.py        (Windows, venv / Stability Matrix)
    <ComfyUI>/venv/bin/python install.py                  (Linux / macOS)
ComfyUI-Manager already installs requirements.txt by itself; this script is for manual installs.
"""

import os
import subprocess
import sys

REQUIREMENTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")

if __name__ == "__main__":
    print(f"[Elementa] Installing dependencies into: {sys.executable}")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS])
    print("[Elementa] Done. Restart ComfyUI.")
