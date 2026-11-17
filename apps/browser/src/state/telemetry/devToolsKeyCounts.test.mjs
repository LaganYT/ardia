import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const { takeDevToolsKeyCounts } = await import("./devToolsKeyCounts.ts");

test("each ⇧⌘C a focused Developer Tools keeps is counted for the hour, then the count starts again", () => {
  takeDevToolsKeyCounts();
  stub.emitEvent("engine.devToolsKeyKept", {});
  stub.emitEvent("engine.devToolsKeyKept", {});
  assert.deepEqual(takeDevToolsKeyCounts(), { devtools_keys_kept: 2 });
  assert.deepEqual(takeDevToolsKeyCounts(), { devtools_keys_kept: 0 });
});
