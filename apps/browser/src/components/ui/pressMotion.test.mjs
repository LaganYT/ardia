import assert from "node:assert/strict";
import { test } from "node:test";
const { buttonMotion, pressMotion, pressReleaseDelay, springSpec, hoverFade } = await import("./motion.ts");

function overshoot({ damping }) {
  return damping >= 1 ? 0 : Math.exp((-Math.PI * damping) / Math.sqrt(1 - damping * damping));
}

function settleMs({ response, damping }, within) {
  const omega = (2 * Math.PI) / response;
  for (let ms = 0; ms < 2000; ms++) {
    const t = ms / 1000;
    const left = damping >= 1 ? Math.exp(-omega * t) * (1 + omega * t) : Math.exp(-damping * omega * t) / Math.sqrt(1 - damping * damping);
    if (left <= within) return ms;
  }
  return Infinity;
}

test("a click shorter than the press still shows the whole dip", () => {
  assert.equal(pressReleaseDelay(0), pressMotion.shortestMs);
  assert.equal(pressReleaseDelay(30), pressMotion.shortestMs - 30);
  assert.equal(pressReleaseDelay(pressMotion.shortestMs), 0);
  assert.equal(pressReleaseDelay(900), 0);
  assert.ok(settleMs(springSpec.press, 0.1) <= pressMotion.shortestMs, "the press spring is nearly down by the time a held-back release starts");
});

test("pressing goes straight down and letting go bounces back a little", () => {
  assert.equal(overshoot(springSpec.press), 0);
  const bounce = overshoot(springSpec.release);
  assert.ok(bounce > 0.08 && bounce < 0.2, `release overshoot ${bounce}`);
  assert.ok(settleMs(springSpec.release, 0.02) < 450, "the bounce is over within 450 ms");
});

test("bigger things shrink less", () => {
  assert.ok(buttonMotion.iconPressScale < buttonMotion.tilePressScale);
  assert.ok(buttonMotion.tilePressScale < buttonMotion.controlPressScale);
  assert.ok(buttonMotion.controlPressScale <= buttonMotion.rowPressScale);
  assert.ok(buttonMotion.rowPressScale < 1);
});

test("a hover lights at once and fades away", () => {
  assert.ok(hoverFade.show.duration <= 60);
  assert.ok(hoverFade.hide.duration >= 3 * hoverFade.show.duration);
});
