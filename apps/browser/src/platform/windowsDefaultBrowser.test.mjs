import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { launchAddresses } from "../../../../packages/expo-windows/src/launchLinks/addresses.ts";
const { checkDefaultBrowserAtLaunch, noteDefaultBrowserPrompt, takeDefaultBrowserCounts } = await import("../state/telemetry/defaultBrowserCounts.ts");
await import("../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });
const client = await import("../state/telemetry/client.ts");

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const installer = read("scripts/windows/installer/Ardia.iss");
const native = read("apps/browser/windows/Ardia/SystemModule.h");
const check = read("scripts/windows/installer-check.ps1");
const layout = read("scripts/windows/shell-layout.ps1");

const shellDefines = (shell) => {
  const block = installer.match(/#if Shell == "webui"\n([\s\S]*?)#else\n([\s\S]*?)#endif\n/);
  const lines = block[shell === "webui" ? 1 : 2];
  return Object.fromEntries([...lines.matchAll(/#define (\w+) "([^"]*)"/g)].map(([, name, text]) => [name, text]));
};
const registryFor = (shell) => {
  const defines = shellDefines(shell);
  return installer
    .split("\n")
    .filter((line) => line.startsWith("Root: HKCU;"))
    .map((line) => line.replace(/\{#(\w+)\}/g, (_, name) => defines[name]))
    .map((line) => Object.fromEntries([...line.matchAll(/(\w+): ("(?:[^"]|"")*"|[^;]+)/g)].map(([, key, value]) => [key, value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value.trim()])));
};
const entries = registryFor("rnw");
const webuiEntries = registryFor("webui");
const value = (subkey, name, from = entries) => from.find((e) => e.Subkey === subkey && e.ValueName === name)?.ValueData;

test("the installer registers the ProgID the app checks, opening the launcher with one argument", () => {
  const progId = native.match(/ArdiaProgId\[\] = L"([^"]+)"/)?.[1];
  assert.equal(progId, "ArdiaHTM");
  assert.match(installer, /^#ifndef Shell\n {2}#define Shell "rnw"\n#endif$/m, "the installer is the React Native shell's unless make-installer asks otherwise");
  assert.equal(value(`Software\\Classes\\${progId}\\shell\\open\\command`, ""), '"{app}\\Ardia.exe" --single-argument %1');
  assert.equal(value("Software\\Clients\\StartMenuInternet\\Ardia\\shell\\open\\command", ""), '"{app}\\Ardia.exe"');
  assert.match(native, /--single-argument %1/);
  assert.match(layout, /--single-argument %1/);
  assert.match(check, /Get-ShellDocumentCommand/);
  assert.match(check, /Classes\\ArdiaHTM/);
});

test("the WebUI shell's installer opens the same launcher with --ardia-shell=webui before the one argument", () => {
  assert.equal(value("Software\\Classes\\ArdiaHTM\\shell\\open\\command", "", webuiEntries), '"{app}\\Ardia.exe" --ardia-shell=webui --single-argument %1');
  assert.equal(value("Software\\Clients\\StartMenuInternet\\Ardia\\shell\\open\\command", "", webuiEntries), '"{app}\\Ardia.exe" --ardia-shell=webui');
  assert.equal(value("Software\\Classes\\ArdiaHTM\\Application", "AppUserModelId", webuiEntries), "Ardia.Browser");
  assert.deepEqual(webuiEntries.map((e) => `${e.Subkey}|${e.ValueName}`), entries.map((e) => `${e.Subkey}|${e.ValueName}`), "both shells register the same keys");
});

test("the browser's capabilities name Ardia for http, https and web pages, and Windows can find them", () => {
  const capabilities = "Software\\Clients\\StartMenuInternet\\Ardia\\Capabilities";
  assert.equal(value("Software\\RegisteredApplications", "Ardia"), capabilities);
  assert.equal(native.match(/RegisteredApplicationName\[\] = L"([^"]+)"/)?.[1], "Ardia");
  for (const scheme of ["http", "https"]) assert.equal(value(`${capabilities}\\URLAssociations`, scheme), "ArdiaHTM", scheme);
  for (const type of [".htm", ".html"]) assert.equal(value(`${capabilities}\\FileAssociations`, type), "ArdiaHTM", type);
  assert.equal(value(`${capabilities}`, "ApplicationName"), "Ardia");
  assert.equal(value(`${capabilities}`, "ApplicationIcon"), "{app}\\Ardia.exe,0");
  assert.match(installer, /^ChangesAssociations=yes$/m);
});

test("every key the installer writes goes again on uninstall", () => {
  const owned = entries.filter((e) => /uninsdeletekey|uninsdeletevalue/.test(e.Flags ?? ""));
  for (const entry of entries) {
    const covered = owned.some((o) => (o.Flags.includes("uninsdeletekey") && (entry.Subkey === o.Subkey || entry.Subkey.startsWith(`${o.Subkey}\\`))) || (o.Subkey === entry.Subkey && o.ValueName === entry.ValueName));
    assert.ok(covered, `${entry.Subkey} ${entry.ValueName} stays after uninstall`);
  }
  for (const shared of ["Software\\RegisteredApplications", "Software\\Classes\\.html\\OpenWithProgids"]) {
    assert.ok(!entries.some((e) => e.Subkey === shared && /uninsdeletekey/.test(e.Flags ?? "")), `${shared} is shared and must lose only Ardia's value`);
  }
});

test("a link Windows hands over through the ProgID's command reaches the app as one address", () => {
  const launch = { arguments: [], single: { text: "https://example.com/a b?q=1" } };
  assert.deepEqual(launchAddresses(launch), ["https://example.com/a%20b?q=1"]);
});

test("default browser counts: prompts opened and a launch as the default, once per launch", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");
  takeDefaultBrowserCounts();
  noteDefaultBrowserPrompt();
  noteDefaultBrowserPrompt();
  checkDefaultBrowserAtLaunch(() => Promise.resolve(true));
  checkDefaultBrowserAtLaunch(() => Promise.resolve(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(takeDefaultBrowserCounts(), { default_browser_prompts_opened: 2, launches_as_default_browser: 1 });
  assert.deepEqual(takeDefaultBrowserCounts(), { default_browser_prompts_opened: 0, launches_as_default_browser: 0 });
  client.setSharing(false, "settings");
});
