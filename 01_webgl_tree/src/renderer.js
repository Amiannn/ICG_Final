// WebGL renderer.
//
// Single instanced cube draw call for all voxels (tree + ground), plus a
// full-screen sky-gradient pass behind it. ANGLE_instanced_arrays gives us
// per-instance offset+color so tens of thousands of cubes go in one draw.

function Renderer(canvas) {
    this.canvas = canvas;
    var gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }) ||
             canvas.getContext('experimental-webgl');
    if (!gl) { alert('WebGL not supported'); return; }
    this.gl = gl;

    var ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) { alert('ANGLE_instanced_arrays not supported by your browser'); return; }
    this.ext = ext;

    gl.getExtension('OES_standard_derivatives');

    this.voxelProg = this._linkProgram('voxel-vs', 'voxel-fs', [
        'aPos', 'aNormal', 'aIOffset', 'aIColor'
    ], [
        'uMV', 'uP', 'uM',
        'uSunDir', 'uSunColor', 'uMoonDir', 'uMoonColor',
        'uAmbient', 'uSkyTint', 'uViewPos', 'uPosterLevels',
        'uFogNear', 'uFogFar', 'uFogStrength'
    ]);
    this.skyProg = this._linkProgram('sky-vs', 'sky-fs',
        ['aPos'], ['uSkyTop', 'uSkyBot', 'uPosterLevels', 'uSunHeight', 'uTime']);

    var cube = this._buildCube();
    this.cubeVerts = this._makeBuffer(gl.ARRAY_BUFFER, cube.verts);
    this.cubeNorms = this._makeBuffer(gl.ARRAY_BUFFER, cube.normals);
    this.cubeIdx   = this._makeBuffer(gl.ELEMENT_ARRAY_BUFFER, cube.indices);
    this.cubeIndexCount = cube.indices.length;

    this.treeInstBuf = gl.createBuffer();
    this.treeInstCount = 0;

    this.groundInstBuf = gl.createBuffer();
    this.groundInstCount = 0;

    this.skyQuad = this._makeBuffer(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1, -1,  1,
        -1,  1,  1, -1,  1,  1
    ]));

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 1);
}

Renderer.prototype._compile = function (id, type) {
    var gl = this.gl;
    var src = document.getElementById(id).textContent;
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Shader ' + id + ' compile error:', gl.getShaderInfoLog(sh));
    }
    return sh;
};

Renderer.prototype._linkProgram = function (vsId, fsId, attribs, uniforms) {
    var gl = this.gl;
    var vs = this._compile(vsId, gl.VERTEX_SHADER);
    var fs = this._compile(fsId, gl.FRAGMENT_SHADER);
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Link error:', gl.getProgramInfoLog(p));
    }
    var loc = {};
    for (var i = 0; i < attribs.length; i++) {
        loc[attribs[i]] = gl.getAttribLocation(p, attribs[i]);
    }
    for (var j = 0; j < uniforms.length; j++) {
        loc[uniforms[j]] = gl.getUniformLocation(p, uniforms[j]);
    }
    p.loc = loc;
    return p;
};

Renderer.prototype._makeBuffer = function (target, data) {
    var gl = this.gl;
    var b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
};

Renderer.prototype._buildCube = function () {
    // 6 faces × 4 verts, each face has its own normal so lighting is flat per-face
    var verts = [], normals = [], indices = [];
    var faces = [
        { n: [ 1, 0, 0], u: [0, 0,-1], v: [0, 1, 0] },
        { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { n: [ 0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
        { n: [ 0,-1, 0], u: [1, 0, 0], v: [0, 0,-1] },
        { n: [ 0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { n: [ 0, 0,-1], u: [-1,0, 0], v: [0, 1, 0] }
    ];
    for (var f = 0; f < 6; f++) {
        var fa = faces[f];
        var cx = fa.n[0] * 0.5, cy = fa.n[1] * 0.5, cz = fa.n[2] * 0.5;
        var corners = [
            [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]
        ];
        for (var c = 0; c < 4; c++) {
            var s = corners[c][0], t = corners[c][1];
            verts.push(cx + fa.u[0]*s + fa.v[0]*t,
                       cy + fa.u[1]*s + fa.v[1]*t,
                       cz + fa.u[2]*s + fa.v[2]*t);
            normals.push(fa.n[0], fa.n[1], fa.n[2]);
        }
        var b = f * 4;
        indices.push(b, b+1, b+2, b, b+2, b+3);
    }
    return {
        verts: new Float32Array(verts),
        normals: new Float32Array(normals),
        indices: new Uint16Array(indices)
    };
};

Renderer.prototype.uploadTreeInstances = function (instArr, count) {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.treeInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instArr, gl.DYNAMIC_DRAW);
    this.treeInstCount = count;
};

Renderer.prototype.buildGround = function (size, color) {
    // flat carpet of voxels, single static upload
    var arr = [];
    for (var x = -size; x <= size; x++) {
        for (var z = -size; z <= size; z++) {
            // checker variation
            var k = (((x + z) & 1) === 0) ? 1.0 : 0.85;
            // edge fade
            var d = Math.max(Math.abs(x), Math.abs(z)) / size;
            var f = 1 - d * 0.25;
            arr.push(x, -1, z,
                     color[0] * k * f, color[1] * k * f, color[2] * k * f);
        }
    }
    var data = new Float32Array(arr);
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.groundInstCount = arr.length / 6;
};

Renderer.prototype._setInstanceAttribs = function (prog, buf) {
    var gl = this.gl, ext = this.ext;
    var stride = 6 * 4; // 6 floats per instance
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(prog.loc.aIOffset);
    gl.vertexAttribPointer(prog.loc.aIOffset, 3, gl.FLOAT, false, stride, 0);
    ext.vertexAttribDivisorANGLE(prog.loc.aIOffset, 1);
    gl.enableVertexAttribArray(prog.loc.aIColor);
    gl.vertexAttribPointer(prog.loc.aIColor, 3, gl.FLOAT, false, stride, 12);
    ext.vertexAttribDivisorANGLE(prog.loc.aIColor, 1);
};

Renderer.prototype._clearInstanceDivisors = function (prog) {
    var ext = this.ext;
    ext.vertexAttribDivisorANGLE(prog.loc.aIOffset, 0);
    ext.vertexAttribDivisorANGLE(prog.loc.aIColor, 0);
};

Renderer.prototype.render = function (frame) {
    var gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- sky pass ----
    if (frame.showSky) {
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.useProgram(this.skyProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.skyQuad);
        gl.enableVertexAttribArray(this.skyProg.loc.aPos);
        gl.vertexAttribPointer(this.skyProg.loc.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform3fv(this.skyProg.loc.uSkyTop, frame.light.skyTop);
        gl.uniform3fv(this.skyProg.loc.uSkyBot, frame.light.skyBot);
        gl.uniform1f (this.skyProg.loc.uPosterLevels, frame.posterLevels);
        gl.uniform1f (this.skyProg.loc.uSunHeight, frame.light.sunDir[1]);
        gl.uniform1f (this.skyProg.loc.uTime, frame.timeSec);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disableVertexAttribArray(this.skyProg.loc.aPos);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
    }

    // ---- voxel instanced pass ----
    var prog = this.voxelProg;
    gl.useProgram(prog);

    // bind cube vertex/normal attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVerts);
    gl.enableVertexAttribArray(prog.loc.aPos);
    gl.vertexAttribPointer(prog.loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeNorms);
    gl.enableVertexAttribArray(prog.loc.aNormal);
    gl.vertexAttribPointer(prog.loc.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIdx);

    // matrices and lighting uniforms
    gl.uniformMatrix4fv(prog.loc.uMV, false, frame.mv);
    gl.uniformMatrix4fv(prog.loc.uP,  false, frame.p);
    gl.uniformMatrix4fv(prog.loc.uM,  false, frame.m);
    gl.uniform3fv(prog.loc.uSunDir,    frame.light.sunDir);
    gl.uniform3fv(prog.loc.uSunColor,  frame.light.sunColor);
    gl.uniform3fv(prog.loc.uMoonDir,   frame.light.moonDir);
    gl.uniform3fv(prog.loc.uMoonColor, frame.light.moonColor);
    gl.uniform1f (prog.loc.uAmbient,   frame.light.ambient);
    gl.uniform3fv(prog.loc.uSkyTint,   frame.light.skyTint);
    gl.uniform3fv(prog.loc.uViewPos,   frame.eye);
    gl.uniform1f (prog.loc.uPosterLevels, frame.posterLevels);
    gl.uniform1f (prog.loc.uFogNear, frame.fogNear || 60.0);
    gl.uniform1f (prog.loc.uFogFar,  frame.fogFar  || 160.0);
    gl.uniform1f (prog.loc.uFogStrength, frame.fogStrength || 0.6);

    // ground pass
    if (frame.showGround && this.groundInstCount > 0) {
        this._setInstanceAttribs(prog, this.groundInstBuf);
        this.ext.drawElementsInstancedANGLE(
            gl.TRIANGLES, this.cubeIndexCount, gl.UNSIGNED_SHORT, 0, this.groundInstCount);
    }

    // tree pass
    if (this.treeInstCount > 0) {
        this._setInstanceAttribs(prog, this.treeInstBuf);
        this.ext.drawElementsInstancedANGLE(
            gl.TRIANGLES, this.cubeIndexCount, gl.UNSIGNED_SHORT, 0, this.treeInstCount);
    }

    this._clearInstanceDivisors(prog);
};
