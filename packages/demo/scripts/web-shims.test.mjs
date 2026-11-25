import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { backdropFragment, haloFragment, powerUpFragment } from "../src/shims/web/gl/sources.ts";
import { frameSubscription, measuredSize, MIN_FRAME_INTERVAL, stepAnimation, wantsFrames } from "../src/shims/web/gl/viewClock.ts";
import { baseStops, GRAIN_SIDE, grainAlpha, overlayStops, padLayers, srgbFromOklab, SWATCH_SAMPLES, swatchColors } from "../src/shims/web/gl/themeSwatch.ts";
import { oklab } from "../src/shims/web/gl/colors.ts";

test("web shims survive ticker failures, reject inherited palettes and enter a view under a still pointer", { timeout: 30_000 }, async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), "ardia-web-shims-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const server = await createServer({
    cacheDir,
    root: fileURLToPath(new URL("../", import.meta.url)),
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    server: { host: "127.0.0.1", port: 0 },
  });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${server.resolvedUrls.local[0]}tests/web-shims.html`);
  await page.getByRole("button", { name: "Run checks" }).click();
  await page.waitForFunction(() => document.getElementById("results")?.textContent);
  const results = JSON.parse(await page.locator("#results").textContent());
  t.diagnostic(JSON.stringify(results));
  assert.deepEqual(results.checks, {
    pointerBeforeSubscriber: true,
    inheritedPalette: true,
    validPalette: true,
    clockSurvivesThrow: true,
    enterOnMount: true,
    fadeLabelStrikethrough: true,
    themeSwatchGradient: true,
    themeSwatchGrain: true,
    colorPad: true,
    themedBackdrop: true,
    darkVisualEffect: true,
    lightToastOnLightHud: true,
    darkToastOnDarkHud: true,
    hudCloseOnDarkHud: true,
    breathe: true,
    holdKeyLookQuiet: true,
  });
});

const near = (actual, expected, slack = 1e-4) => assert.ok(Math.abs(actual - expected) <= slack, `${actual} is not ${expected}`);

test("the demo's theme swatch reads at most three colours and blends the first two in Oklab", () => {
  assert.deepEqual(swatchColors([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5, 9, 9, 9, 9]), [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 0.5]]);
  assert.deepEqual(swatchColors([1, 0, 0]), []);
  const a = [0.79, 0.31, 0.95, 1];
  const b = [0.39, 0.48, 0.95, 1];
  const stops = baseStops([a, b]);
  assert.equal(stops.length, SWATCH_SAMPLES + 1);
  for (const i of [0, 1, 2]) near(stops[0].color[i], a[i], 2e-3);
  for (const i of [0, 1, 2]) near(stops.at(-1).color[i], b[i], 2e-3);
  const [la, lb] = [oklab(a), oklab(b)];
  const middle = srgbFromOklab([(la[0] + lb[0]) / 2, (la[1] + lb[1]) / 2, (la[2] + lb[2]) / 2, 1]);
  assert.deepEqual(stops[SWATCH_SAMPLES / 2].color.map((v) => +v.toFixed(4)), middle.map((v) => +v.toFixed(4)));
  assert.equal(baseStops([a]).length, 2);
  assert.deepEqual(baseStops([]), []);
  assert.deepEqual(overlayStops([a, b]), []);
  assert.deepEqual(overlayStops([a, b, [0, 0, 1, 0.8]]), [{ offset: 0, color: [0, 0, 1, 0] }, { offset: 1, color: [0, 0, 1, 0.8] }]);
});

test("the demo's colour pad and grain tiles match the app's", () => {
  const pad = padLayers(0.5);
  assert.match(pad.wheel, /^conic-gradient\(from 90deg, hsl\(0 100% 50%\) 0deg, /);
  assert.equal(pad.centre, "radial-gradient(closest-side, rgba(128, 128, 128, 1), rgba(128, 128, 128, 0))");
  assert.match(padLayers(2).wheel, /hsl\(360 100% 100%\) 360deg\)$/);
  for (const texture of ["grain", "sand", "denim", "tweed", "unknown"]) {
    const bytes = grainAlpha(texture);
    assert.equal(bytes.length, GRAIN_SIDE * GRAIN_SIDE * 4);
    assert.ok(bytes.some((v, i) => i % 4 === 3 && v > 0), texture);
    assert.ok(bytes.every((v, i) => i % 4 === 3 || v === 0), texture);
  }
  assert.deepEqual(grainAlpha("sand"), grainAlpha("sand"));
  assert.notDeepEqual(grainAlpha("denim"), grainAlpha("tweed"));
});

test("the PowerUp and Halo shaders never call pow where ANGLE's D3D11 backend returns NaN for a zero or negative base", () => {
  const halo = haloFragment;
  const power = powerUpFragment;
  assert.doesNotMatch(halo, /pow\(w,/);
  assert.match(halo, /vec4 w2 = w \* w;\s*w = w2 \* w2;/);
  assert.doesNotMatch(power, /pow\(lms,/);
  assert.match(power, /lms = lms \* lms \* lms;/);
  assert.doesNotMatch(power, /pow\(-2\.0 \* t \+ 2\.0,/);
  assert.match(power, /float u2 = u \* u;\s*return 1\.0 - u2 \* u2 \* 0\.5;/);
  assert.doesNotMatch(power, /pow\(abs\(crossPos/);
  assert.match(power, /float bend = \(1\.0 - b2 \* b2 \* b\) \* -0\.0500000007;/);
  for (const division of power.matchAll(/[^\n]*\/ edge[^\n]*/g)) assert.match(division[0], /edge > 0\.0 \?/);
  assert.match(power, /\/ edge/);
  for (const source of [halo, power, backdropFragment]) {
    for (const call of source.matchAll(/pow\(([^,]+),/g)) assert.match(call[1], /^(2\.0|a|ac|abs\([^)]*\))$/, `pow(${call[1]}, …) may see a base of zero or below`);
  }
});

test("a GL view sizes its canvas from the first layout instead of waiting at 300 by 150 for the resize observer", () => {
  assert.deepEqual(measuredSize(200, 100, 2), { css: [200, 100], pixels: [400, 200] });
  assert.deepEqual(measuredSize(100.4, 50.2, 1.5), { css: [100.4, 50.2], pixels: [151, 75] });
  assert.deepEqual(measuredSize(80, 40, 0), { css: [80, 40], pixels: [80, 40] });
  assert.equal(measuredSize(0, 100, 2), null);
  assert.equal(measuredSize(100, 0, 2), null);
});

test("an animated GL view holds its clock at zero until it has a size, then plays every frame and stops on the last one", () => {
  const clock = { css: [0, 0], time: 0, started: false, pending: 0 };
  assert.equal(stepAnimation(clock, 0.5, 1), "unmeasured");
  assert.equal(stepAnimation(clock, 0.5, 1), "unmeasured");
  assert.deepEqual([clock.time, clock.started, clock.pending], [0, false, 0]);
  clock.css = [120, 60];
  assert.equal(stepAnimation(clock, 0.5, 1), "draw");
  assert.deepEqual([clock.time, clock.started], [0, true]);
  assert.equal(stepAnimation(clock, 0.001, 1), "skip");
  assert.equal(clock.time, 0);
  assert.equal(stepAnimation(clock, MIN_FRAME_INTERVAL, 1), "draw");
  assert.ok(Math.abs(clock.time - (0.001 + MIN_FRAME_INTERVAL)) < 1e-9);
  assert.equal(stepAnimation(clock, 5, 1), "finish");
  assert.equal(clock.time, 1);
});

test("an onscreen GL view with no size holds no frame subscription, and takes one only once it is measured", () => {
  let subscribed = 0;
  let unsubscribed = 0;
  const frames = frameSubscription(() => {
    subscribed++;
    return () => unsubscribed++;
  });
  const clock = { css: [0, 0], done: false };
  const sync = (visible) => frames.sync(wantsFrames(visible, clock.css, clock.done));
  sync(true);
  sync(true);
  assert.equal(frames.active(), false);
  assert.equal(subscribed, 0);
  clock.css = [0, 40];
  sync(true);
  assert.equal(frames.active(), false);
  clock.css = [120, 40];
  sync(true);
  sync(true);
  assert.deepEqual([frames.active(), subscribed, unsubscribed], [true, 1, 0]);
  clock.css = [0, 0];
  sync(true);
  assert.deepEqual([frames.active(), subscribed, unsubscribed], [false, 1, 1]);
  clock.css = [120, 40];
  sync(false);
  assert.equal(frames.active(), false);
  sync(true);
  assert.deepEqual([frames.active(), subscribed], [true, 2]);
  clock.done = true;
  sync(true);
  assert.deepEqual([frames.active(), subscribed, unsubscribed], [false, 2, 2]);
});
