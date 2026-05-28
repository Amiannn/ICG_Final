// L-system tree skeleton generator.
//
// Produces:
//   - segments: list of {start, end, radius, spawnTime, parentIdx, kind}
//   - leaves:   list of {pos, radius, spawnTime, color}
//
// Notes:
//   * spawnTime drives smooth growth. The renderer interpolates each segment's
//     `end` position over [spawnTime, spawnTime+1) of age — no popping.
//   * Each side branch is given a random subtreeMaxDepth so branches terminate
//     with leaves at varied heights, producing the layered canopy "shelves"
//     instead of a single ball of leaves at the very top.
//   * Trunk uses a slower mainRadiusFalloff than side branches, so the trunk
//     stays thick all the way up while branches taper quickly.
//   * Roots are stamped at depth 0 — short flared segments going down/outward
//     from the base.

function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function v3(x, y, z) { return [x, y, z]; }
function v3add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function v3scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function v3cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function v3norm(a) {
    var l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0]/l, a[1]/l, a[2]/l];
}
function v3dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

function rotAxis(v, k, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var dot = v3dot(k, v);
    var crs = v3cross(k, v);
    return [
        v[0]*c + crs[0]*s + k[0]*dot*(1-c),
        v[1]*c + crs[1]*s + k[1]*dot*(1-c),
        v[2]*c + crs[2]*s + k[2]*dot*(1-c)
    ];
}

function LSystem(params, seed) {
    this.params = params;
    this.rng = makeRng(seed >>> 0);
    this.segments = [];
    this.leaves = [];
    this.maxSpawnTime = 0;
}

LSystem.prototype.generate = function () {
    this.segments = [];
    this.leaves = [];
    this.maxSpawnTime = 0;

    var p = this.params;
    var up    = v3(0, 1, 0);
    var right = v3(1, 0, 0);
    var fwd   = v3(0, 0, 1);

    // root flare at the base
    this._growRoots();

    this._grow({
        pos: v3(0, 0, 0),
        h: up, l: right, u: fwd,
        depth: 0,
        length: p.trunkLen,
        radius: p.trunkRadius,
        spawnTime: 0,
        parentIdx: -1,
        isMain: true,
        subtreeMaxDepth: p.maxDepth
    });

    return {
        segments: this.segments,
        leaves: this.leaves,
        maxSpawnTime: this.maxSpawnTime
    };
};

LSystem.prototype._growRoots = function () {
    var p = this.params;
    var rng = this.rng;
    var nRoots = 6 + Math.floor(rng() * 3);
    for (var i = 0; i < nRoots; i++) {
        var angle = (i / nRoots + (rng() - 0.5) * 0.25) * Math.PI * 2;
        var r = p.trunkRadius * (0.55 + rng() * 0.30);
        var len = p.trunkLen * (0.35 + rng() * 0.25);
        var dy = -0.45 - rng() * 0.40;
        var horiz = Math.sqrt(Math.max(0, 1 - dy * dy));
        var dx = Math.cos(angle) * horiz;
        var dz = Math.sin(angle) * horiz;
        var endPos = [dx * len, dy * len, dz * len];
        // Roots spawn at time 0 (visible from sapling stage)
        this.segments.push({
            start: v3(0, p.trunkRadius * 0.15, 0),
            end: endPos,
            radius: r,
            depth: 0,
            spawnTime: 0,
            parentIdx: -1,
            kind: 'root'
        });
    }
};

LSystem.prototype._grow = function (s) {
    var p = this.params;
    var rng = this.rng;
    var maxD = (s.subtreeMaxDepth !== undefined) ? s.subtreeMaxDepth : p.maxDepth;

    if (s.depth >= maxD || s.length < p.minLength) {
        // terminal — drop a leaf cluster
        if (p.leafDensity > 0.01) {
            var jitter = 0.7 + 0.6 * rng();
            this.leaves.push({
                pos: s.pos.slice(),
                radius: p.leafRadius * jitter,
                spawnTime: s.spawnTime + 0.4,
                color: p.leafColor
            });
        }
        return;
    }

    // bend along this segment to break linearity
    var bendL = (rng() - 0.5) * p.bend;
    var bendU = (rng() - 0.5) * p.bend;
    var h = v3norm(rotAxis(rotAxis(s.h, s.l, bendL), s.u, bendU));
    var l = v3norm(v3cross(h, s.u));
    var u = v3norm(v3cross(l, h));

    var endPos = v3add(s.pos, v3scale(h, s.length));
    var segIdx = this.segments.length;
    this.segments.push({
        start: s.pos.slice(),
        end: endPos,
        radius: s.radius,
        depth: s.depth,
        spawnTime: s.spawnTime,
        parentIdx: s.parentIdx,
        kind: s.isMain ? 'trunk' : 'branch'
    });
    if (s.spawnTime > this.maxSpawnTime) this.maxSpawnTime = s.spawnTime;

    var nextSpawn = s.spawnTime + 1;

    // main axis continuation
    if (s.isMain || rng() < p.mainContinueProb) {
        var nh = h;
        if (!s.isMain) {
            var bias = p.gravitropism;
            nh = v3norm([
                h[0] * (1 - bias),
                h[1] * (1 - bias) + bias,
                h[2] * (1 - bias)
            ]);
        }
        var falloff = s.isMain ? p.mainRadiusFalloff : p.radiusFalloff;
        this._grow({
            pos: endPos,
            h: nh, l: l, u: u,
            depth: s.depth + 1,
            length: s.length * p.lengthFalloff,
            radius: Math.max(0.5, s.radius * falloff),
            spawnTime: nextSpawn,
            parentIdx: segIdx,
            isMain: s.isMain,
            subtreeMaxDepth: maxD
        });
    }

    // side branches with randomized subtree depth → layered canopy
    if (s.depth >= p.branchStartDepth) {
        var n = p.branchCount;
        for (var i = 0; i < n; i++) {
            if (rng() > p.branchProb) continue;

            var pitch = p.branchAngle * (0.7 + rng() * 0.6);
            var roll  = (i / n + rng() * 0.4) * Math.PI * 2;

            var nh = rotAxis(h, l, pitch);
            nh = rotAxis(nh, h, roll);
            nh = v3norm(nh);
            if (nh[1] < -0.1) nh[1] = -0.1;
            nh = v3norm(nh);
            var nl = v3norm(v3cross(nh, u));
            var nu = v3norm(v3cross(nl, nh));

            // each side branch gets a random remaining depth, capped by parent's subtree
            var minSub = s.depth + 2;
            var maxSub = Math.min(maxD, s.depth + 2 + Math.floor(rng() * 3));
            var subDepth = Math.max(minSub, maxSub);

            this._grow({
                pos: endPos,
                h: nh, l: nl, u: nu,
                depth: s.depth + 1,
                length: s.length * p.lengthFalloff * (0.7 + rng() * 0.4),
                radius: Math.max(0.5, s.radius * p.radiusFalloff * 0.78),
                spawnTime: nextSpawn,
                parentIdx: segIdx,
                isMain: false,
                subtreeMaxDepth: subDepth
            });
        }
    }
};
