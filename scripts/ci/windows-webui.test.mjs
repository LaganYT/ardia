import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8").replace(/\r\n/g, "\n");
const WORKFLOW = read(".github/workflows/windows.yml");
const SCRIPT = read("scripts/windows/installer/Ardia.iss");

function jobBlocks(text) {
  const blocks = {};
  for (const block of text.split(/\n  (?=[a-z0-9-]+:\n)/).slice(1)) blocks[block.match(/^[a-z0-9-]+/)[0]] = block;
  return blocks;
}

function triggerPaths(text, event) {
  const lines = text.split("\n");
  const eventAt = lines.indexOf(`  ${event}:`);
  const pathsAt = lines.findIndex((line, at) => at > eventAt && line === "    paths:");
  const paths = [];
  for (let at = pathsAt + 1; at < lines.length && lines[at].startsWith("      - "); at++) paths.push(JSON.parse(lines[at].slice(8)));
  return paths;
}

const steps = (block) => block.split(/\n      - /).slice(1);
const stepNamed = (block, name) => steps(block).find((step) => step.includes(`name: ${name}\n`));

test("the WebUI job runs beside the React Native jobs, gated like them, on a GitHub Windows runner", () => {
  const blocks = jobBlocks(WORKFLOW);
  const job = blocks.webui;
  assert.ok(job, "windows.yml has a webui job");
  assert.match(job, /\n    needs: \[gate, identity\]\n/);
  assert.ok(job.includes("    if: ${{ !cancelled() && needs.identity.result == 'success' && (needs.gate.result == 'skipped' || (needs.gate.result == 'success' && needs.gate.outputs.run == 'true')) }}\n"), "an unvouched pull request waits for vouch like the other builds");
  assert.ok(job.includes("    runs-on: windows-latest\n"));
  assert.ok(job.includes("    permissions:\n      contents: write\n"), "the job's token can read the engine's release, as the x64 job's does");
  assert.equal(stepNamed(job, "Fetch the engine"), stepNamed(blocks.x64, "Fetch the engine"), "the engine is fetched exactly as the x64 job fetches it");
  assert.ok(!/concurrency:/.test(job), "the job shares the workflow's concurrency group instead of naming its own");
  for (const name of ["app", "arm64-app", "x64", "x64-input", "x64-tour", "x64-tour-first-run", "x64-gate", "arm64", "arm64-gate"]) {
    assert.ok(blocks[name], `the React Native job ${name} is still there`);
    assert.ok(!blocks[name].includes("assemble-webui.ps1"), `${name} still assembles the React Native shell`);
  }
});

test("the React Native jobs package exactly as before the WebUI packaging", () => {
  const launch = jobBlocks(WORKFLOW).x64;
  assert.ok(launch.includes('run: scripts/windows/assemble.ps1 -App $env:APP -Engine "${{ runner.temp }}/engine" -Out "${{ runner.temp }}/Ardia" -Version $env:VERSION -Build $env:BUILD\n'));
  assert.ok(launch.includes('run: scripts/windows/make-installer.ps1 -Source "${{ runner.temp }}/Ardia" -Out "${{ runner.temp }}/installer" -Cpu $env:SLUG -Version $env:VERSION\n'));
  assert.ok(launch.includes('run: scripts/windows/installer-check.ps1 -Setup "${{ runner.temp }}/installer/Ardia-Setup-$env:SLUG.exe"\n'));
});

test("the WebUI job builds the UI and the migrator, assembles a shippable build and checks it", () => {
  const job = jobBlocks(WORKFLOW).webui;
  const order = [
    "Check the shell layouts, the WebUI assembly and the installer's refusals",
    "Check the pilot's waits, log and types on PowerShell 7",
    "Check the pilot's waits, log and types on Windows PowerShell",
    "Build the desktop UI for Windows",
    "Build the migrator",
    "Build the update verifier",
    "Fetch the engine",
    "Assemble the shippable WebUI build",
    "Every DLL the WebUI build needs is in it or in a clean Windows 11",
    "Make the WebUI installer",
    "Install and uninstall the WebUI build",
    "Tour the WebUI build",
  ];
  const at = order.map((name) => job.indexOf(`name: ${name}\n`));
  assert.ok(at.every((index) => index > 0), "every WebUI step is there");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "the steps run in order");
  assert.ok(stepNamed(job, "Check the shell layouts, the WebUI assembly and the installer's refusals").includes("run: scripts/windows/shell-layout.test.ps1"));
  assert.ok(stepNamed(job, "Build the desktop UI for Windows").includes("run: pnpm -C apps/desktop build:win"));
  assert.ok(stepNamed(job, "Check the pilot's waits, log and types on PowerShell 7").includes("shell: pwsh\n"));
  assert.ok(stepNamed(job, "Check the pilot's waits, log and types on Windows PowerShell").includes("shell: powershell\n"));
  assert.match(stepNamed(job, "Build the migrator"), /cargo build --locked --release -p ardia-shell-migration --bin ardia-webui-migrate/);
  assert.ok(job.includes("      MIGRATOR: packages/core-rs/target/release/ardia-webui-migrate.exe\n"));
  const assemble = stepNamed(job, "Assemble the shippable WebUI build");
  assert.match(assemble, /assemble-webui\.ps1 -Engine .* -Ui apps\/desktop\/dist\/win -Out .* -MigrateBin \$env:MIGRATOR -UpdateVerify .* -Shippable -Version \$env:VERSION -Build \$env:BUILD/);
  assert.ok(stepNamed(job, "Build the update verifier").includes('run: scripts/windows/update-verify.ps1 -Cpu $env:SLUG -Out "${{ runner.temp }}/update-verify"'), "the verifier is built for the build's CPU");
  assert.ok(assemble.includes('-UpdateVerify "${{ runner.temp }}/update-verify/ardia-update-verify.exe"'), "the shippable WebUI build carries the update verifier and the pinned key");
  assert.ok(!assemble.includes("-TestBuild"), "the shippable build carries no test marker");
  assert.ok(stepNamed(job, "Fetch the engine").includes("github.event.pull_request.head.repo.full_name == github.repository"), "a fork's pull request never gets the engine token");
});

test("the WebUI installer and tour run on full runs only, and the tour never fails the run", () => {
  const job = jobBlocks(WORKFLOW).webui;
  assert.ok(stepNamed(job, "Make the WebUI installer").includes("env.FULL == 'true'"));
  assert.ok(stepNamed(job, "Make the WebUI installer").includes("-Shell webui"));
  assert.ok(stepNamed(job, "Install and uninstall the WebUI build").includes("-Shell webui"));
  const tour = stepNamed(job, "Tour the WebUI build");
  assert.ok(tour.includes("env.FULL == 'true'"));
  assert.ok(tour.includes("continue-on-error: true\n"));
  assert.ok(tour.includes("scripts/windows/webui-pilot/tour-webui.ps1"));
  assert.ok(tour.includes('"Ardia.test-build"'), "the tour runs a copy marked as a test build, never the shippable folder");
});

test("pushes to main and pull requests start Windows on the same paths, including the WebUI sources", () => {
  const pull = triggerPaths(WORKFLOW, "pull_request");
  assert.deepEqual(triggerPaths(WORKFLOW, "push"), pull);
  for (const path of ["apps/desktop/**", "packages/core-rs/crates/ardia-shell-migration/**", "scripts/windows/**"]) assert.ok(pull.includes(path), `${path} starts Windows`);
});

test("the installer stays the React Native shell's unless make-installer asks for the WebUI shell", () => {
  assert.match(SCRIPT, /^#ifndef Shell\n {2}#define Shell "rnw"\n#endif\n/);
  assert.match(SCRIPT, /#if Shell == "webui"\n {2}#define LaunchSwitch "--ardia-shell=webui"\n {2}#define OpenSuffix " --ardia-shell=webui"\n {2}#define ShellMarker "ardia-ui\\index\.html"\n(?: {2}#define Retired\w+ .*\n)+#else\n {2}#define LaunchSwitch ""\n {2}#define OpenSuffix ""\n {2}#define ShellMarker "ArdiaApp\.dll"\n(?: {2}#define Retired\w+ .*\n)+#endif\n/);
  assert.ok(SCRIPT.includes('ValueData: """{app}\\Ardia.exe""{#OpenSuffix} --single-argument %1"'));
  assert.ok(SCRIPT.includes('Name: "{autoprograms}\\Ardia"; Filename: "{app}\\Ardia.exe"; Parameters: "{#LaunchSwitch}"; IconFilename: "{app}\\Ardia.ico"; AppUserModelID: "Ardia.Browser"'));
  assert.equal((SCRIPT.match(/Parameters: "\{#LaunchSwitch\}"/g) || []).length, 4, "both shortcuts and both launches after setup carry the switch");
  const installer = read("scripts/windows/make-installer.ps1");
  assert.ok(installer.includes('"/DShell=$shellKind"'), "make-installer passes the shell it found");
  assert.ok(installer.includes('[ValidateSet("auto", "rnw", "webui")][string]$Shell = "auto"'));
});

test("switching shells deletes only files the other shell shipped, after this shell is installed, and folders only once empty", () => {
  assert.ok(!/\[InstallDelete\]|DelTree|RemoveReactNativeShell/.test(SCRIPT), "nothing removes a folder with what's inside it, or anything before the copy");
  assert.match(SCRIPT, /#if Shell == "webui"\n(?: {2}#define \w+ .*\n)*? {2}#define RetiredShell "rnw"\n {2}#define RetiredMarker "ArdiaApp\.dll"\n/);
  assert.match(SCRIPT, /#else\n(?: {2}#define \w+ .*\n)*? {2}#define RetiredShell "webui"\n {2}#define RetiredMarker "ardia-ui\\index\.html"\n {2}#define RetiredMarkerAlt "ardia-webui-migrate\.exe"\n/);
  assert.ok(SCRIPT.includes('#ifdef ShellManifest\nSource: "{#ShellManifest}"; DestDir: "{app}"; DestName: "ardia-{#Shell}-files.txt"; Flags: ignoreversion\n#endif'), "each install carries the list of files its shell shipped");
  assert.ok(SCRIPT.includes('#ifdef RetiredList\nSource: "{#RetiredList}"; DestName: "retired-shell.txt"; Flags: dontcopy\n#endif'));
  const hook = SCRIPT.slice(SCRIPT.indexOf("procedure CurStepChanged"));
  assert.ok(hook.includes("if CurStep = ssInstall then\n    NoteInstalledShells\n  else if CurStep = ssPostInstall then\n    RemoveFilesNoLongerShipped;"), "what is there is noted before the copy, and files go only after it");
  const note = SCRIPT.slice(SCRIPT.indexOf("procedure NoteInstalledShells;"), SCRIPT.indexOf("procedure RemoveFilesNoLongerShipped;"));
  assert.ok(note.includes("RetiredShellFound := FileExists(Folder + '\\{#RetiredMarker}')"), "the other shell is noted before anything is copied");
  assert.ok(note.includes("PreviousOwnFound := ReadManifest(Folder, 'ardia-{#Shell}-files.txt', PreviousOwn);"), "this shell's last manifest is read before the new one replaces it");
  const cleanup = SCRIPT.slice(SCRIPT.indexOf("procedure RemoveRetiredShell("));
  assert.ok(cleanup.includes("if not RetiredShellFound then Exit;"));
  assert.ok(cleanup.includes("if not FileExists(Folder + '\\{#ShellMarker}') then"), "the cleanup waits for this shell's marker");
  assert.ok(cleanup.indexOf("if FileExists(Manifest) then") < cleanup.indexOf("ExtractTemporaryFile('retired-shell.txt')"), "the other shell's own manifest comes first, the fixed list only for installs without one");
  assert.ok(SCRIPT.includes("(Pos('..', Entry) = 0) and (Pos(':', Entry) = 0) and (Pos('/', Entry) = 0) and (Copy(Entry, 1, 1) <> '\\')"), "an entry can't leave the install folder");
  assert.ok(SCRIPT.includes("if DeleteFile(Path) then\n    Removed.Add(Path)"), "only listed files are deleted");
  assert.ok(SCRIPT.includes("if not PathWithoutLinks(Folder, Relative) then Break;\n      if not RemoveDir(Dir) then Break;"), "folders go bottom up, only once empty, never through a link");
});

test("removals never pass through a link, take exact paths from manifests, and keep what they can't remove", () => {
  assert.ok(SCRIPT.includes("external 'GetFileAttributesW@kernel32.dll stdcall';"));
  assert.ok(SCRIPT.includes("ReparsePointAttribute = $400;"));
  const guard = SCRIPT.slice(SCRIPT.indexOf("function PathWithoutLinks"), SCRIPT.indexOf("function InList"));
  assert.ok(guard.includes("if IsReparsePoint(Folder) then Exit;"), "the install folder itself");
  assert.ok(guard.includes("if IsReparsePoint(Path) then Exit;"), "every folder on the way");
  assert.ok(guard.includes("Result := not IsReparsePoint(Path + '\\' + Rest);"), "and the target");
  const remove = SCRIPT.slice(SCRIPT.indexOf("procedure RemoveOwnedFile"), SCRIPT.indexOf("procedure RemoveEmptyFolders"));
  assert.ok(remove.indexOf("PathWithoutLinks(Folder, Relative)") < remove.indexOf("DeleteFile(Path)"), "the path is checked before the delete");
  assert.ok(remove.includes("Failed.Add(Relative);"), "a refused or failed delete is remembered");
  assert.ok(SCRIPT.includes("Result := OwnedEntryValid(Entry) and (Pos('*', Entry) = 0) and (Pos('?', Entry) = 0);"));
  assert.ok(SCRIPT.includes("else if not FromManifest and OwnedEntryValid(Entry) and (Copy(Entry, 1, 2) = '*\\') then"), "wildcards only from the fixed list, never from a manifest on disk");
  const manifestRead = SCRIPT.slice(SCRIPT.indexOf("function ReadManifest"), SCRIPT.indexOf("procedure KeepOwnership"));
  assert.ok(manifestRead.indexOf("PathWithoutLinks(Folder, Name)") < manifestRead.indexOf("LoadStringsFromFile"), "a manifest behind a link is never read");
  const stale = SCRIPT.slice(SCRIPT.indexOf("procedure RemoveStaleOwnFiles"), SCRIPT.indexOf("procedure NoteInstalledShells"));
  assert.ok(stale.includes("if ExactEntryValid(Entry) and not InList(Kept, Entry) then\n        RemoveOwnedFile(Folder, Entry, Removed, Failed);"), "an update removes files only the last build listed");
  assert.ok(stale.includes("KeepOwnership(Folder + '\\' + Manifest, Failed);"), "and keeps listing those it couldn't remove");
  assert.ok(SCRIPT.includes("SaveStringToFile(Path, Failed[I] + #13#10, True)"));
  const harness = read("scripts/windows/webui-pilot/upgrade.ps1");
  for (const name of ["same-shell-update-removes-stale-files", "same-shell-update-never-follows-links", "same-shell-update-keeps-unlisted-files", "same-shell-update-layout"]) assert.ok(harness.includes(`'${name}'`), `the installed harness checks ${name}`);
  const layout = read("scripts/windows/shell-layout.ps1");
  assert.ok(layout.includes('webui = @("ardia-ui\\index.html", "ardia-webui-migrate.exe")'));
  assert.ok(layout.includes('webui = @("ardia-ui")'));
  const installer = read("scripts/windows/make-installer.ps1");
  assert.ok(installer.includes("Write-RetiredShellList $shellKind $retired"));
  assert.ok(installer.includes("Write-ShellManifest $sourceRoot $shellKind $manifest"));
  assert.ok(installer.includes('"/DShellManifest=$manifest"'));
});

test("the update verifier and its pinned key survive every shell switch and update, since both shells verify updates with them", () => {
  const layout = read("scripts/windows/shell-layout.ps1");
  const kept = layout.match(/\n\$ShellKept = @\(([^)]*)\)/)?.[1] ?? "";
  for (const name of ["ardia-update-verify.exe", "windows-update.pem"]) {
    assert.ok(kept.includes(`"${name}"`), `${name} is kept by both shells`);
    const owned = layout.slice(layout.indexOf("$ShellOwned = @{"), layout.indexOf("$ShellOwnedFolders"));
    assert.ok(!owned.includes(`"${name}"`), `${name} is owned by neither shell, so retiring one never lists it`);
  }
  assert.ok(layout.includes('function Write-KeptFileList([string]$path) {'));
  const installer = read("scripts/windows/make-installer.ps1");
  assert.ok(installer.includes("Write-KeptFileList $kept"));
  assert.ok(installer.includes('"/DKeptList=$kept"'), "make-installer hands Inno Setup the kept list");
  assert.ok(SCRIPT.includes('#ifdef KeptList\nSource: "{#KeptList}"; DestName: "kept-files.txt"; Flags: dontcopy\n#endif'));
  const retire = SCRIPT.slice(SCRIPT.indexOf("procedure RemoveRetiredShell("), SCRIPT.indexOf("procedure RemoveStaleOwnFiles"));
  assert.ok(retire.indexOf("ReadKeptFiles(Kept);") > 0 && retire.indexOf("if InList(Kept, Entry) then") < retire.indexOf("RemoveOwnedFile(Folder, Entry, Removed, Failed)"), "an older install's own manifest never takes a kept file with it");
  const stale = SCRIPT.slice(SCRIPT.indexOf("procedure RemoveStaleOwnFiles"), SCRIPT.indexOf("procedure NoteInstalledShells"));
  assert.ok(stale.indexOf("ReadKeptFiles(Kept);") > 0 && stale.indexOf("ReadKeptFiles(Kept);") < stale.indexOf("RemoveOwnedFile"), "an update of the same shell keeps them though the last manifest listed them");
  const assemble = read("scripts/windows/assemble-webui.ps1");
  assert.ok(assemble.includes('if ($Shippable -and -not $UpdateVerify) { throw'), "a shippable WebUI build refuses to assemble without the verifier");
  assert.ok(assemble.includes("Copy-Item -LiteralPath $pinnedKey -Destination (Join-Path $outRoot $keyName) -Force"), "the pinned key comes from scripts/windows, never from the command line");
});
