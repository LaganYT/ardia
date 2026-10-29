import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
  },
};

const shell = await import("../../test-native/index.ts");
const { syncFiles } = await import("./syncFiles.ts");
const { emptyDoc } = await import("./syncDoc.ts");
const { emptyScope } = await import("@ardia/sync");

const record = { h: "000000001.0000.devA", v: { t: "Kept" }, o: ["devA", 1] };
const scope = { ...emptyScope(), records: { "bm:x": record }, base: { "bm:x": '{"t":"Kept"}' }, seq: 1, vv: { devA: 1 } };

async function loaded(state) {
  shell.docs.clear();
  shell.docs.set("sync-state.nns", `sealed:${JSON.stringify(state)}`);
  const doc = { ...emptyDoc(), enabled: true, deviceId: "devA", folder: "/sync", seqs: { app: 1 } };
  await syncFiles(() => doc).loadState();
  return doc;
}

test("a sealed state saved as bare scopes, before checkpoints, still loads", async () => {
  const doc = await loaded({ app: scope });
  assert.deepEqual(doc.scopes.app.records, { "bm:x": record });
  assert.equal(doc.scopes.app.seq, 1);
});

test("a checkpoint saved before it carried a version still loads", async () => {
  const doc = await loaded({ covers: 5, clock: "000000002.0000.devA", scopes: { app: scope } });
  assert.deepEqual(doc.scopes.app.records, { "bm:x": record });
});

test("a checkpoint from a newer app, or one whose scopes are damaged, reads as empty instead of throwing", async () => {
  assert.deepEqual((await loaded({ version: 9, covers: 1, scopes: { app: scope } })).scopes.app.records, {});
  const doc = await loaded({ version: 1, covers: 1, scopes: { app: "broken", other: { records: null } } });
  assert.deepEqual(doc.scopes.app.records, {});
  assert.equal(doc.scopes.other, undefined);
});
