import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const frames = new Map();
let nextFrame = 1;
const reported = [];
const windowListeners = new Map();
const documentListeners = new Map();
globalThis.document = { hidden: false, addEventListener: (type, listener) => documentListeners.set(type, listener) };
globalThis.window = {
  innerHeight: 800,
  addEventListener: (type, listener) => windowListeners.set(type, listener),
  removeEventListener: () => {},
};
globalThis.requestAnimationFrame = (callback) => {
  frames.set(nextFrame, callback);
  return nextFrame++;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
globalThis.reportError = (error) => reported.push(error);
globalThis.HTMLIFrameElement ??= class {};

const { subscribeFrames } = await import("./shims/web/gl/clock.ts");
const { paletteColors, PALETTES } = await import("./shims/web/gl/colors.ts");
const { trackHover } = await import("./shims/web/motion/hover.ts");
const { isSoftwareRenderer, MEADOW_POSTERS, MEADOW_POSTER_URLS, meadowToneOf, nearestMeadowPoster } = await import("./shims/web/gl/meadow.ts");
const { backdropFragment, haloFragment, powerUpFragment } = await import("./shims/web/gl/sources.ts");
const { materialFill } = await import("./shims/web/materials.ts");
const { colorRoles } = await import("../../browser/src/components/ui/tokens.ts");
const { parseColor } = await import("./shims/web/chrome.tsx");
const { frameSubscription, measuredSize, MIN_FRAME_INTERVAL, stepAnimation, wantsFrames } = await import("./shims/web/gl/viewClock.ts");

function runFrame(now) {
  const pending = [...frames];
  frames.clear();
  for (const [, callback] of pending) callback(now);
}

test("a ticker that throws is reported and the frame loop keeps animating every other view", () => {
  const ticks = [];
  const stopBroken = subscribeFrames(() => {
    throw new Error("broken view");
  });
  const stopHealthy = subscribeFrames((dt) => ticks.push(dt));
  runFrame(1000);
  runFrame(1016);
  runFrame(1032);
  assert.equal(ticks.length, 3);
  assert.equal(reported.length, 3);
  assert.equal(frames.size, 1);
  stopBroken();
  stopHealthy();
  runFrame(1048);
  assert.equal(frames.size, 0);
});

test("palette names only match the palettes themselves, never properties every object inherits", () => {
  assert.equal(paletteColors(["pink"]).length, PALETTES.pink.length);
  assert.equal(paletteColors(["toString"]), null);
  assert.equal(paletteColors(["constructor"]), null);
  assert.equal(paletteColors(["__proto__"]), null);
  assert.deepEqual(paletteColors(["#FF0000"]), [[1, 0, 0, 1]]);
});

function hoverNode(rect) {
  return { isConnected: true, getBoundingClientRect: () => rect, closest: () => null };
}

function hoverEntry(node, calls, label) {
  return { node: () => node, enter: () => (e) => calls.push(`${label} enter ${e.nativeEvent.clientX},${e.nativeEvent.clientY}`), leave: () => () => calls.push(`${label} leave`), inside: false };
}

test("a hover area that appears under a pointer that has stopped moving gets its enter right away, and its leave once the pointer goes", () => {
  const box = { left: 100, top: 100, right: 200, bottom: 150, width: 100, height: 50 };
  const point = (x, y) => ({ clientX: x, clientY: y, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
  windowListeners.get("pointermove")(point(120, 110));
  const calls = [];
  const stopFirst = trackHover(hoverEntry(hoverNode(box), calls, "first"));
  assert.deepEqual(calls, ["first enter 20,10"]);
  const stopAway = trackHover(hoverEntry(hoverNode({ ...box, left: 300, right: 400 }), calls, "away"));
  assert.deepEqual(calls, ["first enter 20,10"]);
  windowListeners.get("pointermove")(point(130, 112));
  assert.deepEqual(calls, ["first enter 20,10"]);
  windowListeners.get("pointermove")(point(320, 112));
  assert.deepEqual(calls, ["first enter 20,10", "first leave", "away enter 20,12"]);
  stopFirst();
  stopAway();
});

test("a sidebar row gets its leave when the pointer goes straight into a page, from the leave the host sends the shell when the page takes the pointer", () => {
  const box = { left: 0, top: 100, right: 240, bottom: 130, width: 240, height: 30 };
  const point = (x, y) => ({ clientX: x, clientY: y, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
  windowListeners.get("pointermove")(point(200, 110));
  const calls = [];
  const stop = trackHover(hoverEntry(hoverNode(box), calls, "row"));
  assert.deepEqual(calls, ["row enter 200,10"]);
  documentListeners.get("mouseout")({ relatedTarget: { tagName: "DIV" } });
  assert.deepEqual(calls, ["row enter 200,10"]);
  documentListeners.get("mouseout")({ relatedTarget: null });
  assert.deepEqual(calls, ["row enter 200,10", "row leave"]);
  stop();
});

test("the meadow starts on the poster the Mac picks for the window's shape, dawn normally and morning with reduced motion", () => {
  assert.equal(nearestMeadowPoster(1.6, false)?.file, "dawn-laptop-1920.webp");
  assert.equal(nearestMeadowPoster(2, false)?.file, "dawn-wide-1920.webp");
  assert.equal(nearestMeadowPoster(3, false)?.file, "dawn-wider-2400.webp");
  assert.equal(nearestMeadowPoster(1, false)?.file, "dawn-mid-1600.webp");
  assert.equal(nearestMeadowPoster(1.6, true)?.file, "morning-laptop-1625.webp");
  assert.deepEqual(Object.keys(MEADOW_POSTER_URLS).sort(), MEADOW_POSTERS.map((poster) => poster.file).sort());
  for (const url of Object.values(MEADOW_POSTER_URLS)) assert.match(url, /\/packages\/shaders\/ios\/Meadow\/(dawn|morning)-[a-z]+-\d+\.webp$/);
});

test("the meadow reports the text tone and halo the scene sets, and the opening tone until it has set one", () => {
  assert.deepEqual(meadowToneOf("dark", "0.42", false), { tone: "dark", halo: 0.42 });
  assert.deepEqual(meadowToneOf("light", "", true), { tone: "light", halo: 0 });
  assert.deepEqual(meadowToneOf(undefined, "", true), { tone: "dark", halo: 0 });
  assert.deepEqual(meadowToneOf(undefined, "nope", false), { tone: "light", halo: 0 });
  assert.deepEqual(meadowToneOf("sepia", "1", false), { tone: "light", halo: 1 });
});

test("a software renderer keeps the meadow on its still poster instead of drawing the scene on the CPU", () => {
  assert.equal(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"), true);
  assert.equal(isSoftwareRenderer("llvmpipe (LLVM 19.1.7, 256 bits)"), true);
  assert.equal(isSoftwareRenderer("ANGLE (AMD, AMD Radeon Graphics (radeonsi renoir ACO), OpenGL ES 3.2)"), false);
  assert.equal(isSoftwareRenderer("Mesa Intel(R) UHD Graphics 620 (KBL GT2)"), false);
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

test("a light toast keeps a light HUD under its dark text, and the HUD close button keeps a dark plate under its white glyph, with or without page glass", () => {
  const over = (top, bottom) => {
    const [r, g, b, a] = parseColor(top);
    return [0, 1, 2].map((i) => [r, g, b][i] * a + bottom[i] * (1 - a));
  };
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const material = (name, dark, opaque) => {
    const fill = materialFill(name, dark);
    if (!opaque) return fill;
    const [r, g, b] = parseColor(fill);
    return `rgba(${r},${g},${b},1)`;
  };
  const light = colorRoles.light;
  const dark = colorRoles.dark;
  const backdrops = [[255, 255, 255], [128, 128, 128], [0, 0, 0]];
  for (const opaque of [false, true]) {
    for (const page of backdrops) {
      const toast = over(material("hudWindow", false, opaque), over(light.toastFill, page));
      assert.ok(contrast(over(light.textPrimary, toast), toast) >= 7, `light toast text over ${page}, opaque ${opaque}`);
      assert.ok(contrast(over(light.textSecondary, toast), toast) >= 3, `light toast secondary text over ${page}, opaque ${opaque}`);
      const darkToast = over(material("hudWindow", true, opaque), over(dark.toastFill, page));
      assert.ok(contrast(over(dark.textPrimary, darkToast), darkToast) >= 7, `dark toast text over ${page}, opaque ${opaque}`);
      const plate = over(light.hudCloseFill, over(material("hudWindow", true, opaque), page));
      assert.ok(contrast(over(light.hudCloseGlyph, plate), plate) >= 4.5, `light HUD close over ${page}, opaque ${opaque}`);
      const darkPlate = over(dark.hudCloseFill, over(material("hudWindow", true, opaque), page));
      assert.ok(contrast(over(dark.hudCloseGlyph, darkPlate), darkPlate) >= 3, `dark HUD close over ${page}, opaque ${opaque}`);
    }
  }
  const lightPlateOnWhite = over(light.hudCloseFill, over(material("hudWindow", false, false), [255, 255, 255]));
  assert.ok(contrast(over(light.hudCloseGlyph, lightPlateOnWhite), lightPlateOnWhite) < 2, "a light HUD material under the white glyph is what the plate's dark scope avoids");
  assert.match(readFileSync(new URL("../../browser/src/components/ui/ButtonKinds.tsx", import.meta.url), "utf8"), /<ThemeOverride theme=\{themeFor\(HUD_PLATE_THEME\)\}>\s*<VisualEffect material="hudWindow"/);
});
