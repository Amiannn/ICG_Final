import * as THREE from "three";

// Pixel-perfect orthographic camera.
//
// Moving an ortho camera through a low-res scene makes pixels swim and creep.
// The fix (from the article) is two-stage:
//   1. Snap the camera to a view-aligned, texel-sized grid -> kills creep, but
//      motion becomes steppy.
//   2. Record the snap error and shift the final upscaled image back by that
//      sub-pixel amount in screen space -> motion is smooth again.
//
// This class owns stage 1 and exposes the snap error (in texels) for the
// pipeline's final pass to apply stage 2.

export class PixelCamera {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100);
    this.viewHeight = 36; // world units visible vertically (fits the full cedar + pond above the HUD)
    // target height frames the scene high on the phone screen, so the pond in
    // the foreground stays above (not behind) the bottom HUD cluster
    this.target = new THREE.Vector3(1.8, 2.8, 1.0);
    // Iso offset from target to eye. baseEyeOffset is the fixed-Y rig; eyeOffset
    // is baseEyeOffset rotated around Y by `yaw` so the user can drag the view
    // horizontally. Rotation can't be texel-snapped, so expect a touch of swim
    // while dragging — it settles once the yaw stops changing.
    this.baseEyeOffset = new THREE.Vector3(13, 4.3, 13); // low eye, just enough angle that the ground fills the lower frame
    this.eyeOffset = this.baseEyeOffset.clone();
    this.yaw = 0;
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this.desiredTarget = this.target.clone();
    this.desiredPosition = this.target.clone().add(this.eyeOffset);
    // default framing: yawed so the pond sits at the lower-left of the tree
    this.setYaw(0.0);

    this.snapEnabled = true;
    this.resolutionY = 270;

    this.snapError = new THREE.Vector2(); // texels, fed to final composite

    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._snapped = new THREE.Vector3();
  }

  setAspect(aspect) {
    const halfH = this.viewHeight * 0.5;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  // world size of one screen texel along the camera's up axis
  texelWorldSize() {
    return (this.camera.top - this.camera.bottom) / this.resolutionY;
  }

  // Gentle orbital drift so the snapping/jitter behaviour is visible.
  drift(time) {
    // Gentle pan around the cedar; the eye follows at a fixed offset so the
    // viewing angle stays locked (pure translation, which snaps cleanly).
    this.desiredTarget.set(
      1.8 + Math.sin(time * 0.16) * 1.5,
      2.8,
      1.0 + Math.cos(time * 0.12) * 1.2,
    );
    this.desiredPosition.copy(this.desiredTarget).add(this.eyeOffset);
  }

  setYaw(yaw) {
    this.yaw = yaw;
    this.eyeOffset.copy(this.baseEyeOffset).applyAxisAngle(this._yAxis, yaw);
    this.desiredPosition.copy(this.desiredTarget).add(this.eyeOffset);
  }

  update() {
    const cam = this.camera;
    cam.position.copy(this.desiredPosition);
    cam.lookAt(this.desiredTarget);
    cam.updateMatrixWorld();

    if (!this.snapEnabled) {
      this.snapError.set(0, 0);
      return;
    }

    // Camera basis vectors in world space.
    cam.matrixWorld.extractBasis(this._right, this._up, this._fwd);

    const texel = this.texelWorldSize();
    const base = this.desiredPosition;
    const rDist = base.dot(this._right);
    const uDist = base.dot(this._up);
    const rSnap = Math.round(rDist / texel) * texel;
    const uSnap = Math.round(uDist / texel) * texel;
    const rErr = rDist - rSnap;
    const uErr = uDist - uSnap;

    // Shift both eye and target by the same vector so the view direction is
    // preserved while the eye lands on the texel grid.
    this._snapped
      .copy(base)
      .addScaledVector(this._right, -rErr)
      .addScaledVector(this._up, -uErr);
    cam.position.copy(this._snapped);
    cam.lookAt(
      this.desiredTarget.x - rErr * this._right.x - uErr * this._up.x,
      this.desiredTarget.y - rErr * this._right.y - uErr * this._up.y,
      this.desiredTarget.z - rErr * this._right.z - uErr * this._up.z,
    );
    cam.updateMatrixWorld();

    // Snap error expressed in texels, for the sub-pixel screen-space shift.
    this.snapError.set(rErr / texel, uErr / texel);
  }
}
