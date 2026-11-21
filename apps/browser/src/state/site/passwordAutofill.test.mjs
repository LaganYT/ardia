import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { setConsentPeriod } = await import("../telemetry/consentPeriod.ts");
const { takeRetiredPasswordManagerCounts } = await import("../telemetry/retiredPasswordManagerCounts.ts");

const S = () => useBrowser.getState();
const RECORD = "password-manager.json";
const record = (heldOff, restored) => JSON.stringify({ offerToSaveHeldOff: heldOff, ...(restored ? { offerToSaveRestored: restored } : {}), version: 1 });
const saved = () => (stub.docs.get(RECORD) ? JSON.parse(stub.docs.get(RECORD)) : null);
const EMPTY = { offerToSaveHeldOff: [], version: 1 };
const toggle = (profile) => stub.profileToggles.user.get(profile)?.passwords;
const profile = (id, passwordManager, extra = {}) => ({ id, name: id, color: "plum", icon: null, createdAt: 0, ...(passwordManager === undefined ? {} : { passwordManager }), ...extra });
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
let launches = 0;
const launch = async () => {
  const restore = await import(`./passwordAutofill.ts?launch=${++launches}`);
  await restore.restoreRetiredPasswordManagers();
  await tick();
  return restore;
};

setConsentPeriod(true, "test-epoch");

test("every profile keeps an explicit ardia choice, and an offer to save Ardia turned off comes back over two launches", async () => {
  S().hydrate({ profiles: { default: profile("default", "plugin:apple-passwords"), work: profile("work", "none"), shared: profile("shared", undefined, { dataId: "work" }), c: profile("c", "ardia") }, profileOrder: ["default", "work", "shared", "c"] });
  stub.profileToggles.user.set("", { passwords: false });
  stub.profileToggles.user.set("work", { passwords: false });
  stub.profileToggles.user.set("mine", { passwords: false });
  stub.docs.set(RECORD, record(["", "work"]));
  takeRetiredPasswordManagerCounts();
  await launch();
  for (const id of ["default", "work", "shared", "c"]) assert.equal(S().profiles[id].passwordManager, "ardia", `${id} reads as Ardia to an older build too`);
  assert.equal(toggle(""), true);
  assert.equal(toggle("work"), true, "a profile sharing work's data is restored once, through work's engine profile");
  assert.equal(toggle("mine"), false, "an off Ardia didn't make is left alone");
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["", "work"], offerToSaveRestored: ["", "work"], version: 1 }, "the record stays until a later launch reads the value back");
  assert.deepEqual(takeRetiredPasswordManagerCounts(), { password_manager_profiles_moved_back: 2 });
  await launch();
  assert.deepEqual(saved(), EMPTY, "the next launch finds it on and clears the record, as an empty journal saved like any other");
  assert.deepEqual(takeRetiredPasswordManagerCounts(), { password_manager_offer_to_save_restored: 2 });
});

test("with no held-off record, a profile that never chose is left as it is: no store change and no write at launch", async () => {
  S().hydrate({ profiles: { default: profile("default", undefined), work: profile("work", undefined) }, profileOrder: ["default", "work"] });
  stub.docs.delete(RECORD);
  const profilesBefore = S().profiles;
  let changes = 0;
  const stop = useBrowser.subscribe(() => changes++);
  takeRetiredPasswordManagerCounts();
  await launch();
  stop();
  assert.equal(S().profiles, profilesBefore, "the profiles are the same object, so nothing is saved");
  assert.equal(changes, 0);
  assert.equal(stub.docs.has(RECORD), false, "no record is written");
  assert.deepEqual(takeRetiredPasswordManagerCounts(), {});
  S().hydrate({ profiles: { default: profile("default", "plugin:apple-passwords"), work: profile("work", undefined) }, profileOrder: ["default", "work"] });
  await launch();
  assert.equal(S().profiles.default.passwordManager, "ardia", "an explicit retired choice still moves back");
  assert.equal(S().profiles.work.passwordManager, undefined, "with nothing held off, an unset profile needs no stamp");
  takeRetiredPasswordManagerCounts();
});

test("with Apple Passwords still on in plugins.json and nothing held off, an unset profile is saved as Ardia so a rollback to 0.2.47 can't pick the plugin", async () => {
  S().hydrate({ profiles: { default: profile("default", undefined), work: profile("work", "ardia") }, profileOrder: ["default", "work"] });
  stub.docs.delete(RECORD);
  stub.docs.set("plugins.json", JSON.stringify({ plugins: { "apple-passwords": { enabled: true, approved: "d8476938b3d33c28cb5494dd4fe670accce05a3f61b1d458c737a8f43505824e", values: {}, applied: {} } }, version: 1 }));
  try {
    await launch();
    assert.equal(S().profiles.default.passwordManager, "ardia");
    assert.equal(stub.docs.has(RECORD), false, "no journal is made for it");
  } finally {
    stub.docs.delete("plugins.json");
    takeRetiredPasswordManagerCounts();
  }
});

test("a crash between the write and the record update sets it again next launch, and a value lost before it reached disk is set again", async () => {
  stub.docs.set(RECORD, record(["work"]));
  stub.profileToggles.user.set("work", { passwords: true });
  await launch();
  assert.deepEqual(saved().offerToSaveRestored, ["work"], "set again and marked, harmlessly");
  stub.profileToggles.user.set("work", { passwords: false });
  await launch();
  assert.equal(toggle("work"), true, "the pref Chrome never wrote is set again");
  assert.deepEqual(saved().offerToSaveRestored, ["work"], "and confirmed only on a later launch");
  await launch();
  assert.deepEqual(saved(), EMPTY);
  takeRetiredPasswordManagerCounts();
});

test("a profile that can't be read keeps its record, and an engine id with no profile is dropped without touching the engine", async () => {
  stub.docs.set(RECORD, record(["work", "gone"], ["work"]));
  stub.profileToggles.unloadable.add("work");
  await launch();
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["work"], offerToSaveRestored: ["work"], version: 1 }, "a failed read isn't taken for success, and the orphan is gone");
  assert.equal(stub.profileToggles.user.has("gone"), false, "no profile was made for it");
  assert.equal(takeRetiredPasswordManagerCounts().password_manager_offer_to_save_restore_failures, 1);
  stub.profileToggles.unloadable.delete("work");
  await launch();
  assert.deepEqual(saved(), EMPTY);
  takeRetiredPasswordManagerCounts();
});

test("your own switch wins: a change during a pending restore drops the record first, and an Off whose record can't be updated isn't made", async () => {
  stub.docs.set(RECORD, record(["work"]));
  stub.profileToggles.user.set("work", { passwords: false });
  const { setPasswordAutofillFor } = await import("../settings/paneData.ts");
  const restore = await import(`./passwordAutofill.ts?launch=${++launches}`);
  const done = restore.restoreRetiredPasswordManagers();
  await setPasswordAutofillFor("work", false);
  await done;
  await tick();
  assert.equal(toggle("work"), false, "you chose after the update, so Ardia doesn't undo it");
  assert.deepEqual(saved(), EMPTY);
  stub.docs.set(RECORD, record(["", "work"]));
  stub.profileToggles.user.set("work", { passwords: true });
  stub.refusedSaves.on = true;
  await setPasswordAutofillFor("work", false);
  stub.refusedSaves.on = false;
  assert.equal(toggle("work"), true, "the Off waits until the record can say so, so a restart can't undo it");
  await setPasswordAutofillFor("work", false);
  assert.equal(toggle("work"), false);
  assert.deepEqual(saved().offerToSaveHeldOff, [""]);
  stub.docs.delete(RECORD);
});

test("a record from a newer Ardia is left alone", async () => {
  stub.docs.set(RECORD, JSON.stringify({ offerToSaveHeldOff: ["work"], version: 9 }));
  stub.profileToggles.user.set("work", { passwords: false });
  await launch();
  assert.equal(toggle("work"), false);
  assert.ok(stub.docs.get(RECORD));
  stub.docs.delete(RECORD);
});

test("with two profiles and one failing read, a retry in the same launch never confirms what that launch wrote", async () => {
  stub.docs.set(RECORD, record(["", "work"]));
  stub.profileToggles.user.set("", { passwords: false });
  stub.profileToggles.user.set("work", { passwords: false });
  stub.profileToggles.unloadable.add("work");
  const restore = await import(`./passwordAutofill.ts?launch=${++launches}`);
  restore.RESTORE_RETRY.firstMs = 5;
  await restore.restoreRetiredPasswordManagers();
  await tick();
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["", "work"], offerToSaveRestored: [""], version: 1 });
  stub.profileToggles.unloadable.delete("work");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["", "work"], offerToSaveRestored: ["", "work"], version: 1 }, "the retry sets work and keeps Personal's marker: neither is confirmed by its own launch");
  await launch();
  assert.deepEqual(saved(), EMPTY, "a later cold launch confirms both");
  takeRetiredPasswordManagerCounts();
});

test("a Settings Off on the last entry saves an empty journal through the acknowledged save, never a native delete", async () => {
  stub.docs.set(RECORD, record(["work"]));
  stub.profileToggles.user.set("work", { passwords: true });
  const documents = stub.shellNativeModules.ArdiaDocuments;
  const remove = documents.removeDocument;
  let removed = 0;
  documents.removeDocument = (name) => (removed++, remove(name));
  stub.heldSaves.on = true;
  try {
    const { setPasswordAutofillFor } = await import("../settings/paneData.ts");
    const off = setPasswordAutofillFor("work", false);
    await tick();
    assert.equal(toggle("work"), true, "the Off waits for the journal's save to be acknowledged");
    stub.heldSaves.on = false;
    for (const land of stub.heldSaves.queue.splice(0)) land();
    await off;
    assert.equal(toggle("work"), false);
    assert.deepEqual(saved(), EMPTY);
    assert.equal(removed, 0);
  } finally {
    stub.heldSaves.on = false;
    documents.removeDocument = remove;
  }
});

test("a Settings On that fails keeps the pending restore", async () => {
  stub.docs.set(RECORD, record(["work"]));
  stub.profileToggles.user.set("work", { passwords: false });
  stub.profileToggles.unloadable.add("work");
  try {
    const { setPasswordAutofillFor } = await import("../settings/paneData.ts");
    await setPasswordAutofillFor("work", true);
    assert.deepEqual(saved().offerToSaveHeldOff, ["work"], "the restore is still owed");
  } finally {
    stub.profileToggles.unloadable.delete("work");
  }
  await launch();
  assert.equal(toggle("work"), true);
  await launch();
  assert.deepEqual(saved(), EMPTY);
  stub.docs.delete(RECORD);
  takeRetiredPasswordManagerCounts();
});

test("a Settings On during a pending restore keeps the entry for a cold launch to confirm, so a crash before Chrome's flush loses nothing", async () => {
  stub.docs.set(RECORD, record(["work"]));
  stub.profileToggles.user.set("work", { passwords: false });
  const { setPasswordAutofillFor } = await import("../settings/paneData.ts");
  await setPasswordAutofillFor("work", true);
  assert.equal(toggle("work"), true);
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["work"], offerToSaveRestored: ["work"], version: 1 }, "Chrome only acknowledged it in memory, so the entry stays");
  stub.profileToggles.user.set("work", { passwords: false });
  await launch();
  assert.equal(toggle("work"), true, "after a crash before the flush, the next launch sets it again");
  assert.deepEqual(saved().offerToSaveHeldOff, ["work"]);
  await launch();
  assert.deepEqual(saved(), EMPTY, "and a later launch that reads it on clears it");
  stub.docs.delete(RECORD);
  takeRetiredPasswordManagerCounts();
});

test("a write that doesn't take after a crash-before-flush is tried again in the same launch, and still only a later launch confirms it", async () => {
  stub.docs.set(RECORD, record(["work"], ["work"]));
  stub.profileToggles.user.set("work", { passwords: false });
  stub.profileToggles.extension.set("work", { passwords: false });
  const restore = await import(`./passwordAutofill.ts?launch=${++launches}`);
  restore.RESTORE_RETRY.firstMs = 5;
  await restore.restoreRetiredPasswordManagers();
  await tick();
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["work"], offerToSaveRestored: ["work"], version: 1 }, "the first write read back off, so nothing is confirmed");
  stub.profileToggles.extension.delete("work");
  stub.profileToggles.user.set("work", { passwords: false });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(toggle("work"), true, "the retry writes again instead of treating the failed write as done");
  assert.deepEqual(saved(), { offerToSaveHeldOff: ["work"], offerToSaveRestored: ["work"], version: 1 }, "and doesn't confirm a value this launch wrote");
  await launch();
  assert.deepEqual(saved(), EMPTY, "a later cold launch confirms it");
  stub.profileToggles.user.delete("work");
  takeRetiredPasswordManagerCounts();
});
