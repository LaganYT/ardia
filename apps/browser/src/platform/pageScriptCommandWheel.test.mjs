import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.match(/const offerCommandWheel = (\(\{ fx, fy, dy \}\) => \{[\s\S]*?\n {2}\});\n/)?.[1];
assert.ok(source, "page_script.js defines offerCommandWheel");

class FakeWheel {
  constructor(type, init) {
    Object.assign(this, init, { type, defaultPrevented: false });
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

function offer(onWheel, point = { fx: 0.5, fy: 0.25, dy: 30 }) {
  const seen = [];
  const target = { dispatchEvent: (event) => (seen.push(event), onWheel(event)) };
  const run = new Function("innerWidth", "innerHeight", "document", "window", "WheelEvent", `return ${source}`);
  const asked = [];
  const document = { elementFromPoint: (x, y) => (asked.push([x, y]), target), documentElement: target };
  const prevented = run(1000, 800, document, "window", FakeWheel)(point);
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
