import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./layout.ts", import.meta.url), "utf8");

test("window layout hooks hear only their window's record and the settings, not every tab or page update", () => {
  const wholeStore = [...source.matchAll(/useBrowser\(\(s\) => ([a-zA-Z]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(wholeStore.sort(), ["downloadsInSidebarFooter", "sidebarHeaderCollapsed"], "only the hooks that also read the profile order select from the whole store");
  assert.ok(!/s\.(tabs|live|history|peeks)\b/.test(source), "layout reads no per-tab state, so the window watch covers it");
  const hooks = readFileSync(new URL("../browser/hooks.ts", import.meta.url), "utf8");
  assert.match(hooks, /export const useTabsPlace = \(windowId: string\)[^\n]*useWindowSettings\(windowId,/);
});
