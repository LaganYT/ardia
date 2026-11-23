import assert from "node:assert/strict";
import { test } from "node:test";
import { ENGINE_KEPT, engineVeto, FREQUENT_SWITCHES, MINUTE, RECENTLY_AUDIBLE_MS, RECENTLY_SEEN_MS, sleepRules, sleepVeto, tabsToSleep } from "./sleepPolicy.ts";
import { countSwitches } from "./tabSwitches.ts";

const NOW = 1_000_000_000_000;
const idle = (id, minutesAgo, extra = {}) => ({
  id,
  sleepable: true,
  shown: false,
  lastSeenAt: NOW - minutesAgo * MINUTE,
  switches: 0,
  audible: false,
  lastAudibleAt: 0,
  call: false,
  pictureInPicture: false,
  loading: false,
  askAgainAt: 0,
  ...extra,
});
const normal = { tabs: 2, hiddenMs: 30 * MINUTE, pressure: "normal" };

test("rules follow the Memory Saver mode and the Mac's memory, and pressure drops the budget to the mode's floor", () => {
  const sys = (gib, memoryPressure = "normal") => ({ memoryPressure, physicalMemory: gib * 2 ** 30 });
  const on = (memorySaverMode) => ({ memorySaver: true, memorySaverMode });
  assert.deepEqual(sleepRules(on("balanced"), sys(16)), { tabs: 16, hiddenMs: 60 * MINUTE, pressure: "normal", perTick: 4, everyMs: MINUTE });
  assert.equal(sleepRules(on("balanced"), sys(32, "warning")).tabs, 10);
  assert.equal(sleepRules(on("maximum"), sys(32, "critical")).pressure, "critical");
  assert.equal(sleepRules(on("balanced"), sys(16, "bogus")).pressure, "normal", "an unknown level is normal");
  assert.equal(sleepRules({ memorySaver: false, memorySaverMode: "balanced" }, sys(16)), null);
  assert.equal(sleepRules(on("balanced"), null), null);
});

test("every protection vetoes on its own, read against the injected clock", () => {
  const veto = (extra, now = NOW) => sleepVeto(idle("t", 120, extra), now, normal);
  assert.equal(veto({}), null, "an idle web tab may sleep");
  assert.equal(veto({ sleepable: false }), "notSleepable");
  assert.equal(veto({ shown: true }), "shown");
  assert.equal(veto({ call: true }), "call", "camera, microphone or screen share");
  assert.equal(veto({ pictureInPicture: true }), "pictureInPicture");
  assert.equal(veto({ audible: true }), "audible");
  assert.equal(veto({ lastAudibleAt: NOW - RECENTLY_AUDIBLE_MS + 1 }), "recentlyAudible", "sound stopped under a minute ago");
  assert.equal(veto({ lastAudibleAt: NOW - RECENTLY_AUDIBLE_MS }), null, "a minute after the sound stopped it may sleep");
  assert.equal(veto({ switches: FREQUENT_SWITCHES }), "frequentlyUsed");
  assert.equal(veto({ switches: FREQUENT_SWITCHES - 1 }), null);
  assert.equal(veto({ askAgainAt: NOW + 1 }), "keptRecently", "the engine kept it a moment ago");
  assert.equal(veto({ loading: true }), "loading");
  assert.equal(sleepVeto(idle("t", 29), NOW, normal), "recentlySeen", "hidden less than the mode's wait");
  assert.equal(sleepVeto(idle("t", 9), NOW, { hiddenMs: 0, pressure: "normal" }), "recentlySeen", "never under ten minutes at normal pressure, whatever the wait");
  assert.equal(sleepVeto(idle("t", RECENTLY_SEEN_MS / MINUTE), NOW, { hiddenMs: 0, pressure: "normal" }), null);
  assert.equal(sleepVeto(idle("t", 120), NOW + 10 * MINUTE, normal), null, "the clock is the caller's");
});

test("only tabs past the budget are candidates, oldest first, and a vetoed tab gives its place to nobody", () => {
  const tabs = [idle("shown", 500, { shown: true }), idle("a", 40), idle("b", 50), idle("c", 60, { audible: true }), idle("d", 70), idle("e", 5)];
  const plan = tabsToSleep(tabs, NOW, normal);
  assert.deepEqual(plan.sleep, ["d", "b", "a"], "the shown tab and the most recent one fill the budget; c is audible");
  assert.deepEqual(plan.vetoed, [{ id: "c", veto: "audible" }]);
  assert.deepEqual(tabsToSleep(tabs.slice(0, 2), NOW, normal), { sleep: [], vetoed: [] }, "at or under the budget nothing is looked at");
});

test("the engine's reasons map to the protection that matters most", () => {
  assert.equal(engineVeto([]), null);
  assert.equal(engineVeto([7, 26]), "typedInput", "typed text outranks a recent visit");
  assert.equal(engineVeto([ENGINE_KEPT.postedDocument, 26]), "postedDocument");
  assert.equal(engineVeto([ENGINE_KEPT.beforeUnload]), "beforeUnload");
  assert.equal(engineVeto([16]), "call");
  assert.equal(engineVeto([7]), "recentlySeen");
  assert.equal(engineVeto([25]), "other");
  assert.equal(engineVeto([-1]), "notSleepable");
});

test("a tab switch counts once per change of a window's front tab, including a return to a profile page's remembered tab", () => {
  const counts = new Map();
  const tabs = Object.fromEntries(["a", "b", "x"].map((id) => [id, { windowId: "w1" }]));
  const at = (profileId, active) => ({ tabs, windows: { w1: { profileId, activeTabIds: active } } });
  let prev = at("p1", { p1: "a" });
  for (const next of [at("p1", { p1: "b" }), at("p1", { p1: "a" }), at("p2", { p1: "a", p2: "x" }), at("p1", { p1: "a", p2: "x" }), at("p2", { p1: "a", p2: "x" })]) {
    countSwitches(prev, next, counts);
    prev = next;
  }
  assert.deepEqual(Object.fromEntries(counts), { b: 1, a: 2, x: 2 }, "paging back to p2 shows x again without touching activeTabIds, and counts");
  countSwitches(prev, prev, counts);
  assert.equal(counts.get("x"), 2, "the same windows count nothing");
  countSwitches(prev, at("p2", { p1: "b", p2: "x" }), counts);
  assert.equal(counts.get("b"), 1, "a change on a profile page that isn't shown is no visit");
});
