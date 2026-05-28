// Auto-fit orbit camera.
//
// Holds the tree's bounding box and computes a camera distance such that the
// projected box fits inside the rectangular viewport with a small margin.
// Smooth-damps `currentDistance` and `currentTarget` toward their goals so
// the camera glides instead of jumping when the tree grows.

function Camera(canvas) {
    this.fovY = 22 * Math.PI / 180;     // narrow FOV → compressed perspective
    this.aspect = canvas.width / canvas.height;
    this.near = 1;
    this.far = 800;

    this.azimuth = 0.4;        // radians around Y — slight 3-quarter view
    this.elevation = 0.06;     // very low tilt — looking up at the trunk a bit
    this.azimuthRate = 0.02;   // gentle slow orbit

    this.currentTarget = [0, 10, 0];
    this.currentDistance = 80;
    this.goalTarget = [0, 10, 0];
    this.goalDistance = 80;

    this.smooth = 1.8; // higher = snappier
}

Camera.prototype.fit = function (bbox, margin) {
    margin = margin || 1.15;
    var cx = (bbox.min[0] + bbox.max[0]) * 0.5;
    var cy = (bbox.min[1] + bbox.max[1]) * 0.5;
    var cz = (bbox.min[2] + bbox.max[2]) * 0.5;

    var sizeY = (bbox.max[1] - bbox.min[1]);
    var sizeX = (bbox.max[0] - bbox.min[0]);
    var sizeZ = (bbox.max[2] - bbox.min[2]);
    // Use the larger of width/height projection requirement.
    var halfH = sizeY * 0.5 * margin;
    var halfW = Math.max(sizeX, sizeZ) * 0.5 * margin;

    var distH = halfH / Math.tan(this.fovY * 0.5);
    var distW = halfW / (Math.tan(this.fovY * 0.5) * this.aspect);
    var dist = Math.max(distH, distW, 30);

    this.goalTarget = [cx, cy, cz];
    this.goalDistance = dist;
};

Camera.prototype.update = function (dt) {
    // smooth-damp distance + target
    var k = 1 - Math.exp(-this.smooth * dt);
    for (var i = 0; i < 3; i++) {
        this.currentTarget[i] += (this.goalTarget[i] - this.currentTarget[i]) * k;
    }
    this.currentDistance += (this.goalDistance - this.currentDistance) * k;

    // gentle orbit
    this.azimuth += this.azimuthRate * dt;
};

Camera.prototype.eye = function () {
    var d = this.currentDistance;
    var ce = Math.cos(this.elevation);
    var se = Math.sin(this.elevation);
    var ca = Math.cos(this.azimuth);
    var sa = Math.sin(this.azimuth);
    return [
        this.currentTarget[0] + d * ce * sa,
        this.currentTarget[1] + d * se,
        this.currentTarget[2] + d * ce * ca
    ];
};

Camera.prototype.viewMatrix = function (out) {
    var eye = this.eye();
    mat4.identity(out);
    mat4.lookAt(eye, this.currentTarget, [0, 1, 0], out);
    return out;
};

Camera.prototype.projMatrix = function (out) {
    mat4.perspective(this.fovY * 180 / Math.PI, this.aspect, this.near, this.far, out);
    return out;
};
