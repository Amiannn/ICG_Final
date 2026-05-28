// Main entry: orchestrates L-system → voxelizer → renderer per frame.

var gl, renderer, camera, lsys, voxer, climate, daynight;
var seed = 12345;
var skeleton = null;
var age = 0.0;        // current growth age (0..maxSpawnTime+1)
var growthSpeed = 0.20;
var autoGrow = true;
var autoTime = true;
var manualAge = 0;
var posterLevels = 4;
var lastTime = 0;
var fpsAcc = 0, fpsFrames = 0, fpsDisplay = 0;

var mvMatrix = mat4.create();
var pMatrix  = mat4.create();
var mMatrix  = mat4.create();

function $(id) { return document.getElementById(id); }

function regenerateTree() {
    seed = (Math.random() * 0xffffffff) >>> 0;
    rebuildSkeleton();
}

function rebuildSkeleton() {
    var p = climate.current;
    lsys = new LSystem({
        trunkLen: p.trunkLen,
        trunkRadius: p.trunkRadius,
        branchAngle: p.branchAngle,
        branchProb: p.branchProb,
        branchCount: Math.round(p.branchCount),
        branchStartDepth: Math.round(p.branchStartDepth),
        mainContinueProb: p.mainContinueProb,
        lengthFalloff: p.lengthFalloff,
        radiusFalloff: p.radiusFalloff,
        mainRadiusFalloff: p.mainRadiusFalloff,
        gravitropism: p.gravitropism,
        bend: p.bend,
        maxDepth: Math.round(p.maxDepth),
        minLength: p.minLength,
        leafRadius: p.leafRadius,
        leafDensity: p.leafDensity,
        leafColor: p.leafColor.slice(),
        barkColor: p.barkColor.slice()
    }, seed);
    skeleton = lsys.generate();
}

function onClimateChange() {
    var name = $('climateSelect').value;
    climate.setTarget(name);
    // when switching to a very different climate, regenerate skeleton too
    // (keeps shape change feeling deliberate). This will gently re-roll.
    seed = ((seed * 1103515245 + 12345) >>> 0) ^ name.length;
    rebuildSkeleton();
}

function maxAge() {
    return (skeleton ? skeleton.maxSpawnTime : 0) + 1.5;
}

function ageLabel() {
    var m = maxAge();
    var f = age / m;
    if (f < 0.15) return 'SAPLING';
    if (f < 0.45) return 'YOUNG';
    if (f < 0.85) return 'MATURE';
    return 'ANCIENT';
}

function webGLStart() {
    var canvas = $('ICG-canvas');
    renderer = new Renderer(canvas);
    if (!renderer.gl) return;
    gl = renderer.gl;

    camera = new Camera(canvas);
    climate = new ClimateState();
    daynight = new DayNight();
    voxer = new Voxelizer();

    // build static ground
    renderer.buildGround(28, [0.30, 0.42, 0.22]);

    rebuildSkeleton();
    lastTime = performance.now();
    requestAnimationFrame(tick);
}

function readUI(dt) {
    growthSpeed = parseInt($('growthSpeed').value, 10) / 100;
    $('growthSpeedVal').textContent = growthSpeed.toFixed(2);

    autoGrow = $('autoGrow').checked;
    autoTime = $('autoTime').checked;

    var ts = parseInt($('timeSpeed').value, 10) / 100;
    daynight.speed = ts * 0.05; // 1 full cycle takes 20s at speed=1.0
    $('timeSpeedVal').textContent = ts.toFixed(2);

    if (autoTime) {
        $('timeSlider').value = Math.floor(daynight.t * 1000);
    } else {
        daynight.t = parseInt($('timeSlider').value, 10) / 1000;
    }
    $('timeVal').textContent = daynight.formatHHMM();

    if (autoGrow) {
        var growMul = climate.current.growthScale || 1.0;
        age = Math.min(maxAge(), age + dt * growthSpeed * growMul * 4);
        $('ageSlider').value = Math.round(age / maxAge() * 100);
    } else {
        var pct = parseInt($('ageSlider').value, 10) / 100;
        age = pct * maxAge();
    }
    $('ageVal').textContent = Math.floor(age * 10) / 10;

    posterLevels = parseInt($('posterLevels').value, 10);
    $('posterVal').textContent = posterLevels;
}

function tick(now) {
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    readUI(dt);

    // climate lerps toward target; if it changes meaningfully, rebuild
    var changed = climate.update(dt);
    // we don't rebuild every frame just for interpolation; only color/density
    // are read live each voxelize pass. shape rebuild only on explicit climate
    // switch (handled in onClimateChange).

    if (autoTime) daynight.advance(dt);

    // voxelize at current age (cheap enough at our scale)
    voxer.voxelizeTree(skeleton, age, climate.current, seed);
    var inst = voxer.toInstanceArray();
    renderer.uploadTreeInstances(inst.data, inst.count);

    // auto-fit camera
    var bbox = voxer.boundingBox();
    camera.fit(bbox, 1.25);
    camera.update(dt);

    // matrices
    mat4.identity(mMatrix);
    camera.viewMatrix(mvMatrix);
    camera.projMatrix(pMatrix);

    // light
    var light = daynight.sample();
    // tint ambient skewed by climate.skyTint so the foliage feels regional
    var skyMix = climate.current.skyTint;
    light.skyTint = [
        light.skyTint[0] * 0.7 + skyMix[0] * 0.3,
        light.skyTint[1] * 0.7 + skyMix[1] * 0.3,
        light.skyTint[2] * 0.7 + skyMix[2] * 0.3
    ];

    // render
    renderer.render({
        mv: mvMatrix,
        p:  pMatrix,
        m:  mMatrix,
        eye: camera.eye(),
        light: light,
        posterLevels: posterLevels,
        showGround: $('showGround').checked,
        showSky: $('showSky').checked,
        timeSec: now / 1000,
        fogNear: 70,
        fogFar: 180,
        fogStrength: 0.55
    });

    // HUD + stats
    $('hud').textContent = ageLabel() + '  ' + climate.targetName.toUpperCase();
    $('statVoxels').textContent = 'voxels: ' + inst.count;
    $('statBranches').textContent = 'branches: ' + (skeleton ? skeleton.segments.length : 0);

    fpsAcc += dt; fpsFrames += 1;
    if (fpsAcc >= 0.5) {
        fpsDisplay = Math.round(fpsFrames / fpsAcc);
        fpsAcc = 0; fpsFrames = 0;
        $('statFps').textContent = 'fps: ' + fpsDisplay;
    }

    requestAnimationFrame(tick);
}
