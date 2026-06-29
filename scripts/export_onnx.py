"""
Export data/models/ppe.pt to data/models/ppe.onnx and run a parity + timing check.

Usage (from project root, with .venv active):
    python scripts/export_onnx.py

Output:
    data/models/ppe.onnx

After export, update MODEL_PATH in .env:
    MODEL_PATH=data/models/ppe.onnx

To roll back, set MODEL_PATH=data/models/ppe.pt — no code changes needed.
"""

from __future__ import annotations

import pathlib
import sys
import time

import numpy as np

PROJECT_ROOT = pathlib.Path(__file__).parent.parent
PT_PATH = PROJECT_ROOT / "data" / "models" / "ppe.pt"
ONNX_PATH = PROJECT_ROOT / "data" / "models" / "ppe.onnx"
IMGSZ = 640


def main() -> None:
    if not PT_PATH.exists():
        print(f"ERROR: {PT_PATH} not found — nothing to export.", file=sys.stderr)
        sys.exit(1)

    from ultralytics import YOLO

    # ── Export ────────────────────────────────────────────────────────────────
    print(f"Loading {PT_PATH} …")
    pt_model = YOLO(str(PT_PATH))
    print(f"Exporting to ONNX (imgsz={IMGSZ}, half=False, simplify=True) …")
    pt_model.export(format="onnx", imgsz=IMGSZ, half=False, simplify=True)

    if not ONNX_PATH.exists():
        print(
            f"ERROR: expected {ONNX_PATH} after export but it is missing.",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"Export complete → {ONNX_PATH}  ({ONNX_PATH.stat().st_size // 1024} KB)\n")

    # ── Parity + timing ───────────────────────────────────────────────────────
    dummy = np.zeros((IMGSZ, IMGSZ, 3), dtype=np.uint8)

    print(f"{'Format':<8}  {'Load (s)':>10}  {'1st infer (s)':>14}  Class names (first 6)")
    print("-" * 72)

    for label, path in [("pt", str(PT_PATH)), ("onnx", str(ONNX_PATH))]:
        t_load = time.perf_counter()
        m = YOLO(path)
        load_s = time.perf_counter() - t_load

        t_infer = time.perf_counter()
        list(m.predict(dummy, conf=0.25, imgsz=IMGSZ, verbose=False))
        infer_s = time.perf_counter() - t_infer

        names = list(m.names.values())[:6]
        print(f"{label:<8}  {load_s:>10.2f}  {infer_s:>14.2f}  {names}")

    print("\nDone. To use ONNX, set in .env:\n    MODEL_PATH=data/models/ppe.onnx")


if __name__ == "__main__":
    main()
