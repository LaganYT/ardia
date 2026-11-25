import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { KEY_REPEAT_IGNORED_COMMANDS } = await import("./commandInteraction.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Mac, Windows and WebUI key handlers ignore autorepeat for the same commands", () => {
  const shared = [...KEY_REPEAT_IGNORED_COMMANDS].sort();
  assert.deepEqual(shared, ["focusCommandBar"]);
  const mac = source("../../../../../packages/shell/ios/UpdaterCore/KeyRepeatGate.swift").match(/ignoredCommands: Set<String> = \[([^\]]*)\]/)?.[1];
  assert.deepEqual([...(mac ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(), shared, "KeyRepeatGate.swift");
  const windows = source("../../../windows/Ardia/MenuKeyboard.h").match(/IgnoresKeyRepeat\(std::string const &command\) noexcept \{ return ([^}]*)\}/)?.[1];
  assert.deepEqual([...(windows ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(), shared, "MenuKeyboard.h");
});
