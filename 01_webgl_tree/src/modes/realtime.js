import { cloudUniforms } from "../materials.js";

// Real-time mode: the original Pixel-Bonsai cel pipeline.
// Pulled out of main.js with no behaviour change, so swapping back into this
// mode always produces the same picture as before the refactor.

export const realtimeMode = {
  name: "realtime",
  label: "Real-time",

  init(ctx) {
    // Show grass + dust. Other modes may have hidden these.
    if (ctx.world.grass) ctx.world.grass.visible = true;
    if (ctx.dust && ctx.dust.points) ctx.dust.points.visible = ctx.settings.dust;
  },

  render(ctx, time) {
    const { settings, pixel, lighting, world, dust, pipeline } = ctx;

    if (settings.motion) pixel.drift(time);
    pixel.snapEnabled = settings.snap;
    pixel.resolutionY = settings.verticalResolution;
    pixel.update();

    cloudUniforms.uCloudTime.value = time * 0.015;
    cloudUniforms.uCloudStrength.value = settings.clouds ? 1 : 0;

    lighting.sun.target.position.set(0, 0, 0);
    lighting.sun.target.updateMatrixWorld();

    world.water.setTime(time);
    world.water.material.uniforms.uReflectEnabled.value = settings.water ? 1 : 0;
    dust.setTime(time);

    pipeline.render(ctx.scene, lighting.sun, time, (r, cam) => {
      world.water.updateReflection(r, cam, ctx.scene);
    });
  },

  dispose(_ctx) {
    // Nothing to release; everything we used is owned by main.js / ctx.
  },
};
