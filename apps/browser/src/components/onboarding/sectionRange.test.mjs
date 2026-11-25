import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTo, rangeOf } from "./sectionRange.ts";

test("a question that fits is centred and has no room to scroll", () => {
  assert.deepEqual(rangeOf({ y: 1000, h: 200 }, 600, 32), { lo: 800, hi: 800 });
});

test("a taller question scrolls from its top edge to its bottom edge", () => {
  assert.deepEqual(rangeOf({ y: 1000, h: 700 }, 600, 32), { lo: 968, hi: 1132 });
});

test("nothing is measured yet, so there is no range", () => {
  assert.equal(rangeOf(undefined, 600, 32), null);
  assert.equal(rangeOf({ y: 0, h: 10 }, 0, 32), null);
});

test("positions clamp into the range", () => {
  assert.equal(clampTo(10, { lo: 20, hi: 30 }), 20);
  assert.equal(clampTo(40, { lo: 20, hi: 30 }), 30);
});
