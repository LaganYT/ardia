import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startPlugins } = await import("./start.ts");
const { usePlugins } = await import("./store.ts");
const lifecycle = await import("./lifecycle.ts");
const { setConsentPeriod, consentToken } = await import("../telemetry/consentPeriod.ts");
setConsentPeriod(true, "retired-plugins-test");

const FIXTURE = readFileSync(new URL("../../../../../tests/fixtures/plugins/example/plugin.json", import.meta.url), "utf8");
const HASH = "d8476938b3d33c28cb5494dd4fe670accce05a3f61b1d458c737a8f43505824e";
const record = { enabled: true, approved: HASH, values: {}, applied: {} };
const saved = () => JSON.parse(stub.docs.get("plugins.json")).plugins;

test("Apple Passwords' record from 0.2.47 is dropped once a scan finds it gone, and a folder of that name keeps it", async () => {
  stub.docs.set("plugins.json", JSON.stringify({ plugins: { "apple-passwords": record, example: { ...record, enabled: false } }, version: 1 }));
  useBrowser.getState().hydrate({});
  startPlugins();
  stub.pluginHost.folders = [{ name: "example", status: "ok", text: FIXTURE }];
  await lifecycle.rescanPlugins(consentToken());
  assert.equal(usePlugins.getState().records["apple-passwords"], undefined);
  assert.deepEqual(Object.keys(saved()), ["example"], "other records stay");
  stub.pluginHost.folders = [{ name: "example", status: "ok", text: FIXTURE }, { name: "apple-passwords", status: "ok", text: FIXTURE.replace('"example"', '"apple-passwords"') }];
  usePlugins.setState({ records: { ...usePlugins.getState().records, "apple-passwords": record } });
  await lifecycle.rescanPlugins(consentToken());
  assert.deepEqual(usePlugins.getState().records["apple-passwords"], record, "a plugin of that name you installed yourself isn't touched");
});
