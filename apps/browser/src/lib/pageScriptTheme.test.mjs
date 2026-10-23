import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.slice(script.indexOf("  const parse = (css) =>"), script.indexOf("  if (window.visualViewport)"));

function page({ background = "rgb(255,255,255)" } = {}) {
  const reports = [], frames = [], observers = [];
  const element = (nodeName, parentElement, background = "rgba(0,0,0,0)") => ({
    nodeName, nodeType: 1, parentElement, background, attrs: {},
    getAttribute(name) { return this.attrs[name] ?? null; },
  });
  const html = element("HTML", null, "rgb(255,255,255)");
  const head = element("HEAD", html);
  const body = element("BODY", html);
  const app = element("DIV", body);
  let header = element("HEADER", app, background);
  class MutationObserver {
    targets = new Map();
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); }
  }
  const context = {
    document: { documentElement: html, body, head, querySelectorAll: () => [], elementFromPoint: () => header, addEventListener() {} },
    getComputedStyle: (el) => ({ backgroundColor: el.background, position: "static", colorScheme: "light" }),
    MutationObserver, innerWidth: 1000, scrollY: 0,
    setTimeout() {}, clearTimeout() {}, addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    apply: Reflect.apply, raf: (fn) => frames.push(fn),
    guard: (fn) => fn, onReady: (fn) => fn(),
    send: (_kind, data) => reports.push(JSON.parse(JSON.stringify(data))),
  };
  context.window = context;
  runInNewContext(source, context);
  const mutate = (target, attributeName, value) => {
    const oldValue = target.getAttribute(attributeName);
    target.attrs[attributeName] = value;
    for (const observer of observers) {
      const options = observer.targets.get(target);
      if (options?.attributes && options.attributeFilter.includes(attributeName))
        observer.callback([{ type: "attributes", target, attributeName, oldValue }]);
    }
    while (frames.length) frames.shift()();
  };
  return { reports, header, app, body, mutate, frames, observers,
    replaceHeader() {
      const old = header;
      header = element("HEADER", app, "rgb(32,33,36)");
      for (const observer of observers)
        if (observer.targets.get(app)?.childList)
          observer.callback([{ type: "childList", target: app, addedNodes: [header], removedNodes: [old] }]);
      while (frames.length) frames.shift()();
      return header;
    },
  };
}

test("the navbar follows a nested header switching from light to dark and back", () => {
  const p = page();
  assert.equal(p.reports.at(-1).color, "#FFFFFF");
  p.header.background = "rgb(32,33,36)";
  p.mutate(p.header, "class", "dark");
  assert.deepEqual(p.reports.at(-1), { color: "#202124", source: "header" });
  p.header.background = "rgb(255,255,255)";
  p.mutate(p.header, "class", "light");
  assert.equal(p.reports.at(-1).color, "#FFFFFF");
});

test("a header's ancestor can switch its theme", () => {
  const p = page();
  p.header.background = "rgb(32,33,36)";
  p.mutate(p.app, "data-theme", "dark");
  assert.equal(p.reports.at(-1).color, "#202124");
});

test("replacing the sampled header refreshes the color and watches the replacement", () => {
  const p = page();
  const header = p.replaceHeader();
  assert.equal(p.reports.at(-1).color, "#202124");
  header.background = "rgb(255,255,255)";
  p.mutate(header, "style", "background:white");
  assert.equal(p.reports.at(-1).color, "#FFFFFF");
});

test("same-value writes do not queue a style/layout sample", () => {
  const p = page();
  p.mutate(p.header, "class", "dark");
  for (const observer of p.observers) {
    const options = observer.targets.get(p.header);
    if (options?.attributes)
      observer.callback([{ type: "attributes", target: p.header, attributeName: "class", oldValue: "dark" }]);
  }
  assert.equal(p.frames.length, 0);
});

test("a saved dark header is sampled on initial load", () => {
  const p = page({ background: "rgb(32,33,36)" });
  assert.deepEqual(p.reports.at(-1), { color: "#202124", source: "header" });
});

test("a header rendered after the initial page is sampled", () => {
  const p = page({ background: "rgba(0,0,0,0)" });
  assert.equal(p.reports.at(-1).source, "background");
  p.replaceHeader();
  assert.deepEqual(p.reports.at(-1), { color: "#202124", source: "header" });
});
