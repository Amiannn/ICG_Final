// Voxelizer: skeleton (segments + leaf clusters) → voxel instance buffer.
//
// Animated growth: segments and leaf clusters carry a `spawnTime`. The
// voxelizer takes the current age `t` and:
//   - skips elements where t < spawnTime
//   - for elements with spawnTime <= t < spawnTime + 1, draws partial geometry
//     (segment end is lerped, leaf radius is scaled)
// This produces smooth growth animation without re-running the L-system.

function Voxelizer() {
    this.voxels = new Map();
}

Voxelizer.prototype.clear = function () { this.voxels.clear(); };

Voxelizer.prototype._stamp = function (x, y, z, color, priority) {
    var key = (x | 0) * 1000000 + (y | 0) * 1000 + (z | 0);
    // shifted to keep negatives behaving — coords centered around origin
    var k = (x + 256) * 1000000 + (y + 256) * 1000 + (z + 256);
    var existing = this.voxels.get(k);
    if (!existing || priority > existing.p) {
        this.voxels.set(k, { x: x, y: y, z: z, c: color, p: priority });
    }
};

Voxelizer.prototype._rasterCylinder = function (start, end, radius, baseColor, rng) {
    var dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2];
    var len = Math.hypot(dx, dy, dz);
    if (len < 0.001) return;

    // sample along the line; each sample stamps a sphere
    var step = Math.max(0.35, radius * 0.6);
    var nSteps = Math.max(1, Math.ceil(len / step));
    var r = Math.max(0.5, radius);
    var rInt = Math.ceil(r);

    for (var i = 0; i <= nSteps; i++) {
        var t = i / nSteps;
        var cx = Math.round(start[0] + dx * t);
        var cy = Math.round(start[1] + dy * t);
        var cz = Math.round(start[2] + dz * t);

        for (var ox = -rInt; ox <= rInt; ox++) {
            for (var oy = -rInt; oy <= rInt; oy++) {
                for (var oz = -rInt; oz <= rInt; oz++) {
                    var d2 = ox * ox + oy * oy + oz * oz;
                    if (d2 > r * r) continue;
                    // bark color noise
                    var n = ((Math.abs(cx + cy * 7 + cz * 13 + ox * 3 + oy * 5 + oz * 11)) % 17) / 17;
                    var s = 0.85 + n * 0.3;
                    this._stamp(cx + ox, cy + oy, cz + oz,
                        [baseColor[0] * s, baseColor[1] * s, baseColor[2] * s], 2);
                }
            }
        }
    }
};

Voxelizer.prototype._rasterLeafBlob = function (center, radius, baseColor, density, rng) {
    var r = Math.max(1, radius);
    var rInt = Math.ceil(r);
    var cx = Math.round(center[0]), cy = Math.round(center[1]), cz = Math.round(center[2]);
    for (var ox = -rInt; ox <= rInt; ox++) {
        for (var oy = -rInt; oy <= rInt; oy++) {
            for (var oz = -rInt; oz <= rInt; oz++) {
                var d2 = ox * ox + oy * oy + oz * oz;
                if (d2 > r * r) continue;
                // density falloff toward edge
                var d = Math.sqrt(d2) / r;
                var p = density * (1.0 - d * 0.4);
                if (rng() > p) continue;
                var n = rng() * 0.5 - 0.25;
                var c = [
                    Math.max(0, Math.min(1, baseColor[0] + n * 0.4)),
                    Math.max(0, Math.min(1, baseColor[1] + n * 0.5)),
                    Math.max(0, Math.min(1, baseColor[2] + n * 0.3))
                ];
                this._stamp(cx + ox, cy + oy, cz + oz, c, 1);
            }
        }
    }
};

Voxelizer.prototype.voxelizeTree = function (skeleton, age, climate, seed) {
    this.clear();
    var rng = makeRng(seed >>> 0);
    var bark = climate.barkColor;

    var segs = skeleton.segments;
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (age < s.spawnTime) continue;
        var grow = Math.min(1, age - s.spawnTime); // 0..1 over one growth tick
        var end = [
            s.start[0] + (s.end[0] - s.start[0]) * grow,
            s.start[1] + (s.end[1] - s.start[1]) * grow,
            s.start[2] + (s.end[2] - s.start[2]) * grow
        ];
        // radius also tapers in slightly while growing
        var rad = s.radius * (0.5 + 0.5 * grow);
        this._rasterCylinder(s.start, end, rad, bark, rng);
    }

    var leaves = skeleton.leaves;
    for (var j = 0; j < leaves.length; j++) {
        var lf = leaves[j];
        if (age < lf.spawnTime) continue;
        var grow = Math.min(1, age - lf.spawnTime);
        var lr = lf.radius * grow;
        if (lr < 0.5) continue;
        this._rasterLeafBlob(lf.pos, lr, lf.color, climate.leafDensity, rng);
    }
};

Voxelizer.prototype.toInstanceArray = function () {
    var n = this.voxels.size;
    var arr = new Float32Array(n * 6);
    var i = 0;
    this.voxels.forEach(function (v) {
        arr[i * 6 + 0] = v.x;
        arr[i * 6 + 1] = v.y;
        arr[i * 6 + 2] = v.z;
        arr[i * 6 + 3] = v.c[0];
        arr[i * 6 + 4] = v.c[1];
        arr[i * 6 + 5] = v.c[2];
        i++;
    });
    return { data: arr, count: n };
};

Voxelizer.prototype.boundingBox = function () {
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    this.voxels.forEach(function (v) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    });
    if (!isFinite(minX)) {
        return { min: [0, 0, 0], max: [1, 1, 1] };
    }
    return {
        min: [minX - 0.5, minY - 0.5, minZ - 0.5],
        max: [maxX + 0.5, maxY + 0.5, maxZ + 0.5]
    };
};
