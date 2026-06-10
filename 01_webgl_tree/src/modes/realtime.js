import { cloudUniforms, windUniforms } from "../materials.js";

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
    ctx.growthReveal = null; // real-time shows the full ecosystem (no growth reveal)
  },

  render(ctx, time) {
    const { settings, pixel, lighting, world, dust, pipeline } = ctx;

    if (settings.motion) pixel.drift(time);
    pixel.snapEnabled = settings.snap;
    pixel.resolutionY = settings.verticalResolution;
    pixel.update();

    cloudUniforms.uCloudTime.value = time * 0.015;
    cloudUniforms.uCloudStrength.value = settings.clouds ? 0.45 : 0;

    // wind sways the grass + foliage across the whole scene (gustier in rain)
    windUniforms.uWindTime.value = time;
    windUniforms.uWindStrength.value = settings.rain ? 0.2 : 0.11;
    // step the touch interactions (tree-shake wobble + falling leaves)
    if (ctx.interact) ctx.interact.update(time);

    // time-of-day: an external driver (game mode's clock via ctx.tod) wins;
    // otherwise the built-in continuous cycle arcs the sun over ~30s.
    const tod = ctx.tod != null ? ctx.tod : settings.cycle ? ((time / 30) + 0.42) % 1 : null;
    if (tod != null) {
      lighting.setTimeOfDay(tod);
      // night colour-grade follows the cycle's darkness (smooth, not a toggle)
      pipeline.composite.uniforms.uNight.value = 1 - lighting.dayness;
    }

    lighting.sun.target.position.set(0, 0, 0);
    lighting.sun.target.updateMatrixWorld();

    // god rays are a sunshine effect — fade them out at night (and in rain)
    const dayF = settings.cycle || ctx.tod != null ? lighting.dayness : settings.night ? 0 : 1;
    pipeline.godray.uniforms.uStrength.value = 3.6 * Math.max(0, Math.min(1, dayF / 0.25));

    world.water.setTime(time);
    world.water.material.uniforms.uReflectEnabled.value = settings.water ? 1 : 0;
    // the pond darkens to moonlit blue after sunset (it gets no scene lighting);
    // lighting.dayness tracks every time-of-day path (cycle, game clock, Night)
    world.water.material.uniforms.uNight.value = 1 - lighting.dayness;
    dust.setTime(time);
    if (ctx.rainSplash) ctx.rainSplash.setTime(time); // animate rain-impact rings

    // campfire fades in only at night, and is doused by rain
    if (world.campfire) {
      const nightF = settings.cycle ? (1 - lighting.dayness) : (settings.night ? 1 : 0);
      world.campfire.update(time, nightF * (settings.rain ? 0 : 1));
    }

    // ecosystem grows with the tree: in Growth/Morph modes ctx.growthReveal is
    // the growthProgress; in real-time it's null → full meadow.
    const reveal = ctx.growthReveal == null ? 1 : ctx.growthReveal;
    // grass + flowers can be decoupled from tree growth (ctx.groundReveal);
    // otherwise they fill in with the tree like everything else.
    const groundReveal = ctx.groundReveal == null ? reveal : ctx.groundReveal;
    if (world.setGroundReveal) world.setGroundReveal(groundReveal);

    // wildlife appears in clear daylight: when it is sunny they walk / fly IN
    // from off-screen, and when night falls or it rains they head back out
    // (a smooth presence ramp, not a pop). Growth reveal staggers who is in.
    const isDay = settings.cycle || ctx.tod != null ? lighting.dayness > 0.45 : !settings.night;
    const sunny = isDay && !settings.rain;
    if (world.animals) {
      world.animals.group.visible = true;
      world.animals.update(time, sunny, reveal);
    }
    if (world.birds) {
      world.birds.group.visible = true;
      world.birds.update(time, sunny, reveal);
    }

    pipeline.render(ctx.scene, lighting.sun, time, (r, cam) => {
      world.water.updateReflection(r, cam, ctx.scene);
    });
  },

  dispose(_ctx) {
    // Nothing to release; everything we used is owned by main.js / ctx.
  },
};
