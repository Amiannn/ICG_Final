// Day-night cycle.
//
// Time of day in [0, 1]. Convention:
//   0.00 = midnight, 0.25 = sunrise, 0.50 = noon, 0.75 = sunset.
//
// Sun rides an arc on the X+Y plane (rises in the +X, sets in -X).
// The moon is opposite to the sun. Whichever is above the horizon dominates;
// at horizon transitions both contribute partially.

function DayNight() {
    this.t = 0.25; // start at sunrise
    this.speed = 0.02; // cycles per second; UI scales this
}

DayNight.prototype.advance = function (dt) {
    this.t = (this.t + dt * this.speed) % 1.0;
    if (this.t < 0) this.t += 1.0;
};

// returns light state for the current frame
DayNight.prototype.sample = function () {
    // sun arc — angle 0 at sunrise (horizon east), π/2 at noon (zenith), π at sunset
    var sunAngle = (this.t - 0.25) * Math.PI * 2; // 0..2π over a full day
    // build sun direction (toward sun) — east-up plane
    var sx = Math.cos(sunAngle);
    var sy = Math.sin(sunAngle);
    var sunDir = [sx, sy, 0.15]; // small Z so light isn't perfectly axial
    // normalize
    var l = Math.hypot(sunDir[0], sunDir[1], sunDir[2]);
    sunDir = [sunDir[0]/l, sunDir[1]/l, sunDir[2]/l];

    // moon = opposite
    var moonDir = [-sunDir[0], -sunDir[1], -sunDir[2]];

    // intensity: smooth ramp around horizon to avoid flicker
    function horizonRamp(y) {
        // y is sin of altitude; -1..1
        // 0 below -0.1, full above 0.15, smooth in between
        return Math.max(0, Math.min(1, (y + 0.1) / 0.25));
    }
    var sunStrength  = horizonRamp(sunDir[1]);
    var moonStrength = horizonRamp(moonDir[1]) * 0.35; // moon is dim

    // sun color: warm at horizon, white at noon
    var horizonness = 1 - sunStrength; // 1 at horizon, 0 at noon
    var sunColor = [
        1.0,
        0.85 + 0.15 * sunStrength - 0.2 * horizonness,
        0.7  + 0.3  * sunStrength - 0.4 * horizonness
    ];
    var moonColor = [0.55, 0.62, 0.85];

    // sky gradient: dawn/day/dusk/night palette
    // pick four key colors and blend by time
    function lerp3(a, b, t) {
        return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
    }
    var night    = { top: [0.04, 0.05, 0.12], bot: [0.10, 0.12, 0.22] };
    var dawnTop  = [0.55, 0.40, 0.55];
    var dawnBot  = [0.95, 0.65, 0.45];
    var day      = { top: [0.30, 0.55, 0.85], bot: [0.70, 0.85, 1.00] };
    var duskTop  = [0.30, 0.18, 0.45];
    var duskBot  = [0.95, 0.50, 0.30];

    var skyTop, skyBot;
    if (this.t < 0.20) {
        var k = this.t / 0.20;
        skyTop = lerp3(night.top, dawnTop, k);
        skyBot = lerp3(night.bot, dawnBot, k);
    } else if (this.t < 0.30) {
        var k = (this.t - 0.20) / 0.10;
        skyTop = lerp3(dawnTop, day.top, k);
        skyBot = lerp3(dawnBot, day.bot, k);
    } else if (this.t < 0.70) {
        skyTop = day.top.slice();
        skyBot = day.bot.slice();
    } else if (this.t < 0.80) {
        var k = (this.t - 0.70) / 0.10;
        skyTop = lerp3(day.top, duskTop, k);
        skyBot = lerp3(day.bot, duskBot, k);
    } else if (this.t < 0.95) {
        var k = (this.t - 0.80) / 0.15;
        skyTop = lerp3(duskTop, night.top, k);
        skyBot = lerp3(duskBot, night.bot, k);
    } else {
        skyTop = night.top.slice();
        skyBot = night.bot.slice();
    }

    // ambient lifts at noon, drops at midnight
    var ambient = 0.18 + 0.32 * sunStrength + 0.05 * moonStrength;

    return {
        sunDir: sunDir,
        moonDir: moonDir,
        sunColor: [sunColor[0]*sunStrength, sunColor[1]*sunStrength, sunColor[2]*sunStrength],
        moonColor: [moonColor[0]*moonStrength, moonColor[1]*moonStrength, moonColor[2]*moonStrength],
        ambient: ambient,
        skyTop: skyTop,
        skyBot: skyBot,
        skyTint: skyBot,
        sunStrength: sunStrength,
        moonStrength: moonStrength
    };
};

DayNight.prototype.formatHHMM = function () {
    var totalMin = Math.floor(this.t * 24 * 60);
    var hh = Math.floor(totalMin / 60);
    var mm = totalMin % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
};
