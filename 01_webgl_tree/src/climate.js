// Climate presets feed into both the L-system (shape) and renderer (palette).
//
// Smooth interpolation: when the user switches climate, params lerp toward
// the target preset over ~2 seconds, so the tree morphs instead of snapping.
// Bark/leaf color also smoothly cross-fade.
//
// `mainRadiusFalloff` is intentionally separate from `radiusFalloff`: the
// trunk uses the slower main falloff so it stays thick along its length,
// while side branches taper quickly with the regular falloff.

var ClimatePresets = {
    temperate: {
        // tall imposing tree with layered canopy — like the reference image
        trunkLen: 8,
        trunkRadius: 5.0,
        branchAngle: Math.PI * 0.40,   // ~72°  shelves
        branchProb: 0.55,
        branchCount: 3,
        branchStartDepth: 2,
        mainContinueProb: 0.99,
        lengthFalloff: 0.86,
        radiusFalloff: 0.68,           // side branches taper fast
        mainRadiusFalloff: 0.93,       // trunk stays thick
        gravitropism: 0.18,
        bend: 0.10,
        maxDepth: 8,
        minLength: 0.8,
        leafRadius: 4.5,
        leafDensity: 0.85,
        leafColor: [0.30, 0.55, 0.25],
        barkColor: [0.42, 0.28, 0.18],
        growthScale: 1.0,
        skyTint: [0.65, 0.78, 0.95]
    },
    arid: {
        trunkLen: 6,
        trunkRadius: 3.5,
        branchAngle: Math.PI * 0.46,   // ~83°  flat umbrella
        branchProb: 0.55,
        branchCount: 3,
        branchStartDepth: 2,
        mainContinueProb: 0.85,
        lengthFalloff: 0.74,
        radiusFalloff: 0.62,
        mainRadiusFalloff: 0.80,
        gravitropism: 0.04,
        bend: 0.30,
        maxDepth: 7,
        minLength: 0.7,
        leafRadius: 3.0,
        leafDensity: 0.45,
        leafColor: [0.55, 0.62, 0.30],
        barkColor: [0.50, 0.36, 0.22],
        growthScale: 0.7,
        skyTint: [0.92, 0.78, 0.55]
    },
    tropical: {
        trunkLen: 9,
        trunkRadius: 5.5,
        branchAngle: Math.PI * 0.34,
        branchProb: 0.80,
        branchCount: 5,
        branchStartDepth: 3,
        mainContinueProb: 0.99,
        lengthFalloff: 0.90,
        radiusFalloff: 0.70,
        mainRadiusFalloff: 0.95,
        gravitropism: 0.10,
        bend: 0.16,
        maxDepth: 10,
        minLength: 1.0,
        leafRadius: 5.5,
        leafDensity: 0.92,
        leafColor: [0.18, 0.55, 0.22],
        barkColor: [0.30, 0.22, 0.18],
        growthScale: 1.3,
        skyTint: [0.55, 0.82, 0.78]
    },
    snowy: {
        // tall conical, like a spruce — narrow drooping branches
        trunkLen: 7,
        trunkRadius: 4.0,
        branchAngle: Math.PI * 0.50,
        branchProb: 0.85,
        branchCount: 5,
        branchStartDepth: 1,
        mainContinueProb: 0.99,
        lengthFalloff: 0.74,
        radiusFalloff: 0.66,
        mainRadiusFalloff: 0.90,
        gravitropism: -0.08,
        bend: 0.12,
        maxDepth: 10,
        minLength: 0.7,
        leafRadius: 3.0,
        leafDensity: 0.78,
        leafColor: [0.22, 0.45, 0.32],
        barkColor: [0.30, 0.22, 0.18],
        growthScale: 0.8,
        skyTint: [0.75, 0.82, 0.92]
    }
};

function ClimateState() {
    this.current = JSON.parse(JSON.stringify(ClimatePresets.temperate));
    this.target  = JSON.parse(JSON.stringify(ClimatePresets.temperate));
    this.targetName = 'temperate';
    this.lerpRate = 0.6;
}

ClimateState.prototype.setTarget = function (name) {
    if (!ClimatePresets[name]) return;
    this.target = JSON.parse(JSON.stringify(ClimatePresets[name]));
    this.targetName = name;
};

ClimateState.prototype.update = function (dt) {
    var k = Math.min(1, dt * this.lerpRate);
    var changed = false;
    var c = this.current, t = this.target;
    for (var key in t) {
        if (!t.hasOwnProperty(key)) continue;
        if (Array.isArray(t[key])) {
            for (var i = 0; i < t[key].length; i++) {
                var d = t[key][i] - c[key][i];
                if (Math.abs(d) > 1e-4) changed = true;
                c[key][i] += d * k;
            }
        } else {
            var d2 = t[key] - c[key];
            if (Math.abs(d2) > 1e-4) changed = true;
            c[key] += d2 * k;
        }
    }
    return changed;
};
