import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.match(/const offerCommandWheel = (\(\{[^}]*\}\) => \{[\s\S]*?\n {2}\});\n/)?.[1];
assert.ok(source, "page_script.js defines offerCommandWheel");

class FakeWheel {
  constructor(type, init) {
    Object.assign(this, init, { type, defaultPrevented: false });
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

const NOW = 1000000;

function offer(onWheel, point = { fx: 0.5, fy: 0.25, dy: 30, until: NOW + 150, shift: false, ctrl: false, alt: false }) {
  const seen = [];
  const target = { dispatchEvent: (event) => (seen.push(event), onWheel(event)) };
  const run = new Function("innerWidth", "innerHeight", "document", "window", "WheelEvent", "apply", "dateNow", "Date", `return ${source}`);
  const asked = [];
  const document = { elementFromPoint: (x, y) => (asked.push([x, y]), target), documentElement: target };
  const prevented = run(1000, 800, document, "window", FakeWheel, (fn) => fn(), () => NOW, Date)(point);
  return { prevented, seen, asked };
}

test("the page gets a ⌘-wheel event at the pointer, deltaY the way a browser reports it", () => {
  const { seen, asked } = offer(() => {});
  assert.deepEqual(asked, [[500, 200]]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "wheel");
  assert.equal(seen[0].metaKey, true);
  assert.equal(seen[0].cancelable, true);
  assert.equal(seen[0].deltaY, -30);
  assert.equal(seen[0].clientX, 500);
  assert.equal(seen[0].clientY, 200);
});

test("a page that calls preventDefault keeps the scroll: the browser doesn't zoom", () => {
  assert.equal(offer((event) => event.preventDefault()).prevented, true);
});

test("a page that ignores it leaves the zoom to the browser", () => {
  assert.equal(offer(() => {}).prevented, false);
});

test("the other modifier keys held with ⌘ reach the page", () => {
  const { seen } = offer(() => {}, { fx: 0.5, fy: 0.25, dy: 30, until: NOW + 150, shift: true, ctrl: false, alt: true });
  assert.equal(seen[0].shiftKey, true);
  assert.equal(seen[0].ctrlKey, false);
  assert.equal(seen[0].altKey, true);
});

test("an offer that arrives after the browser's deadline is dropped, not dispatched", () => {
  const { prevented, seen } = offer(() => {}, { fx: 0.5, fy: 0.25, dy: 30, until: NOW - 1, shift: false, ctrl: false, alt: false });
  assert.equal(prevented, null);
  assert.equal(seen.length, 0);
});
