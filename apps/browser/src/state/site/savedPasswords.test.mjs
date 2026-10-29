import assert from "node:assert/strict";
import { test } from "node:test";
const { emitAppEvent } = await import("../../test-native/shell.ts");
const { lockPasswords, unlockPasswordsFor, usePasswordUnlocks } = await import("./savedPasswords.ts");

const unlocked = (profile) => !!usePasswordUnlocks.getState().unlocked[profile];

test("unlocked passwords lock again when the Mac locks or sleeps", async () => {
  assert.equal(await unlockPasswordsFor("work"), true);
  assert.equal(await unlockPasswordsFor(""), true);
  assert.ok(unlocked("work") && unlocked(""));
  emitAppEvent({ type: "screenLocked" });
  assert.ok(unlocked("work"), "a quiet screen lock alone isn't the signal; lockedOrAsleep is");
  emitAppEvent({ type: "lockedOrAsleep" });
  assert.ok(!unlocked("work") && !unlocked(""));
  lockPasswords();
});

test("an unlock lasts five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await unlockPasswordsFor("work");
  t.mock.timers.tick(5 * 60_000 - 1);
  assert.ok(unlocked("work"));
  t.mock.timers.tick(1);
  assert.ok(!unlocked("work"));
});
