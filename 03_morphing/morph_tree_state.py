#!/usr/bin/env python3
"""Morph / recolor a shared Pixel Bonsai tree state."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PALETTES = {
    "spring": {"leaf": [0.42, 0.72, 0.34], "trunk": [0.43, 0.29, 0.18], "branch": [0.38, 0.24, 0.14]},
    "summer": {"leaf": [0.26, 0.55, 0.24], "trunk": [0.42, 0.27, 0.15], "branch": [0.36, 0.22, 0.12]},
    "autumn": {"leaf": [0.78, 0.42, 0.16], "trunk": [0.38, 0.23, 0.13], "branch": [0.34, 0.20, 0.12]},
    "winter": {"leaf": [0.76, 0.86, 0.88], "trunk": [0.32, 0.24, 0.20], "branch": [0.30, 0.22, 0.18]},
}


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(a, b, t):
    return [round(lerp(float(a[i]), float(b[i]), t), 4) for i in range(3)]


def morph(src: Path, dst: Path, season: str, t: float, age: float | None):
    data = json.loads(src.read_text())
    if season not in PALETTES:
        raise SystemExit(f"unknown season {season}; choose {', '.join(PALETTES)}")
    palette = PALETTES[season]
    t = max(0.0, min(1.0, t))
    for voxel in data["voxels"]:
        part = voxel.get("part", "leaf")
        target = palette.get(part, voxel["color"])
        voxel["color"] = lerp_color(voxel["color"], target, t)
        if age is not None:
            # Simple growth morph: hide top/detail voxels by pushing their alpha-like marker.
            # Renderers can choose to ignore voxels with visible=false.
            voxel["visible"] = voxel["position"][1] <= 1 + age * 13
    data["season"] = season if t >= 1.0 else f"morph_to_{season}_{t:.2f}"
    if age is not None:
        data["age"] = max(0.0, min(1.0, age))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, indent=2))
    print(f"wrote {dst}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("dst", type=Path)
    parser.add_argument("--season", default="autumn", choices=sorted(PALETTES))
    parser.add_argument("--t", type=float, default=1.0, help="0 keeps source colors, 1 reaches target season")
    parser.add_argument("--age", type=float, default=None, help="optional growth age 0..1")
    args = parser.parse_args()
    morph(args.src, args.dst, args.season, args.t, args.age)
