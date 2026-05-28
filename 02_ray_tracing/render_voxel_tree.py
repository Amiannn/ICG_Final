#!/usr/bin/env python3
"""Minimal ray tracer for the shared Pixel Bonsai voxel tree state.

This is intentionally small and readable for team collaboration. It traces
axis-aligned voxel cubes from shared/tree_state.json and writes a PNG.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required: pip install Pillow") from exc


@dataclass
class Vec3:
    x: float
    y: float
    z: float

    def __add__(self, other): return Vec3(self.x + other.x, self.y + other.y, self.z + other.z)
    def __sub__(self, other): return Vec3(self.x - other.x, self.y - other.y, self.z - other.z)
    def __mul__(self, s: float): return Vec3(self.x * s, self.y * s, self.z * s)
    def dot(self, other) -> float: return self.x * other.x + self.y * other.y + self.z * other.z
    def length(self) -> float: return math.sqrt(self.dot(self))
    def norm(self):
        l = self.length() or 1.0
        return self * (1.0 / l)


def cross(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x)


@dataclass
class Voxel:
    center: Vec3
    color: tuple[float, float, float]
    half: float

    @property
    def min(self): return Vec3(self.center.x - self.half, self.center.y - self.half, self.center.z - self.half)
    @property
    def max(self): return Vec3(self.center.x + self.half, self.center.y + self.half, self.center.z + self.half)


def intersect_box(origin: Vec3, direction: Vec3, voxel: Voxel):
    tmin = -1e30
    tmax = 1e30
    hit_normal = Vec3(0, 1, 0)
    bmin, bmax = voxel.min, voxel.max
    for axis in ("x", "y", "z"):
        o = getattr(origin, axis)
        d = getattr(direction, axis)
        mn = getattr(bmin, axis)
        mx = getattr(bmax, axis)
        if abs(d) < 1e-8:
            if o < mn or o > mx:
                return None
            continue
        inv = 1.0 / d
        t1 = (mn - o) * inv
        t2 = (mx - o) * inv
        near_normal = Vec3(0, 0, 0)
        setattr(near_normal, axis, -1 if inv > 0 else 1)
        if t1 > t2:
            t1, t2 = t2, t1
            near_normal = Vec3(0, 0, 0)
            setattr(near_normal, axis, 1 if inv > 0 else -1)
        if t1 > tmin:
            tmin = t1
            hit_normal = near_normal
        tmax = min(tmax, t2)
        if tmin > tmax:
            return None
    if tmax < 0:
        return None
    return max(tmin, 0.0), hit_normal


def trace(origin: Vec3, direction: Vec3, voxels: list[Voxel], light_dir: Vec3, ambient: float):
    best = None
    best_voxel = None
    best_normal = None
    for voxel in voxels:
        hit = intersect_box(origin, direction, voxel)
        if hit and (best is None or hit[0] < best):
            best, best_normal, best_voxel = hit[0], hit[1], voxel
    if best_voxel is None:
        t = max(0.0, min(1.0, 0.5 + 0.5 * direction.y))
        return (0.72 - 0.22*t, 0.82 - 0.20*t, 0.95 - 0.14*t)

    hit_pos = origin + direction * best
    n = best_normal
    # Shadow ray: direct light is blocked by any other voxel.
    shadow_origin = hit_pos + n * 0.02
    shadowed = False
    to_light = light_dir * -1.0
    for voxel in voxels:
        if voxel is best_voxel:
            continue
        hit = intersect_box(shadow_origin, to_light, voxel)
        if hit and hit[0] > 0.02:
            shadowed = True
            break

    diffuse = max(0.0, n.dot(to_light))
    if shadowed:
        diffuse *= 0.22
    shade = ambient + (1.0 - ambient) * diffuse
    depth_fog = max(0.0, min(1.0, (best - 18.0) / 38.0))
    r, g, b = best_voxel.color
    sky = (0.72, 0.82, 0.94)
    return tuple((c * shade) * (1-depth_fog) + sky[i] * depth_fog for i, c in enumerate((r, g, b)))


def render(state_path: Path, out_path: Path, width=240, height=160):
    state = json.loads(state_path.read_text())
    half = float(state.get("voxelSize", 1.0)) * 0.5
    voxels = [Voxel(Vec3(*v["position"]), tuple(v["color"]), half) for v in state["voxels"] if v.get("visible", True)]
    cam = state.get("camera", {})
    eye = Vec3(*cam.get("eye", [18, 14, 24]))
    target = Vec3(*cam.get("target", [0, 6, 0]))
    fov = math.radians(float(cam.get("fov", 35)))
    forward = (target - eye).norm()
    right = cross(forward, Vec3(0, 1, 0)).norm()
    up = cross(right, forward).norm()
    light = state.get("light", {})
    light_dir = Vec3(*light.get("direction", [-0.45, -1.0, -0.35])).norm()
    ambient = float(light.get("ambient", 0.28))

    img = Image.new("RGB", (width, height))
    aspect = width / height
    scale = math.tan(fov * 0.5)
    pix = img.load()
    for y in range(height):
        sy = (1 - 2 * ((y + 0.5) / height)) * scale
        for x in range(width):
            sx = (2 * ((x + 0.5) / width) - 1) * scale * aspect
            direction = (forward + right * sx + up * sy).norm()
            color = trace(eye, direction, voxels, light_dir, ambient)
            pix[x, y] = tuple(max(0, min(255, int(c * 255))) for c in color)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("src", nargs="?", type=Path, default=Path("../shared/tree_state.json"))
    parser.add_argument("dst", nargs="?", type=Path, default=Path("../outputs/ray_traced/tree_raytraced.png"))
    parser.add_argument("--width", type=int, default=240)
    parser.add_argument("--height", type=int, default=160)
    args = parser.parse_args()
    render(args.src, args.dst, args.width, args.height)
