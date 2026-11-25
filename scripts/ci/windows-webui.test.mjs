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

test("the WebUI jobs run beside the React Native jobs, gated like them, on GitHub's x64 and arm64 Windows runners", () => {
  const blocks = jobBlocks(WORKFLOW);
  const job = blocks.webui;
  assert.ok(job, "windows.yml has a webui job");
  assert.match(job, /\n    needs: \[gate, identity\]\n/);
  assert.ok(job.includes("    if: ${{ !cancelled() && needs.identity.result == 'success' && (needs.gate.result == 'skipped' || (needs.gate.result == 'success' && needs.gate.outputs.run == 'true')) }}\n"), "an unvouched pull request waits for vouch like the other builds");
  assert.ok(job.includes("    runs-on: windows-latest\n"));
  assert.ok(job.includes("    permissions:\n      contents: write\n"), "the job's token can read the engine's release, as the x64 job's does");
  assert.equal(stepNamed(job, "Fetch the engine"), stepNamed(blocks.x64, "Fetch the engine"), "the engine is fetched exactly as the x64 job fetches it");
  assert.ok(!/concurrency:/.test(job), "the job shares the workflow's concurrency group instead of naming its own");
  assert.ok(job.includes("    steps: &webui_steps\n"));
  assert.ok(job.includes("      SLUG: x64\n      TOUR: \"true\"\n"));
  const arm = blocks["webui-arm64"];
  assert.ok(arm, "windows.yml has a webui-arm64 job");
  assert.match(arm, /\n    needs: \[gate, identity\]\n/);
  assert.ok(arm.includes("    runs-on: windows-11-arm\n"));
  assert.ok(arm.includes("      SLUG: arm64\n      TOUR: \"false\"\n"));
  assert.ok(arm.includes("    steps: *webui_steps\n"), "arm64 runs the same steps");
  assert.equal(arm.split("\n    if: ")[1].split("\n")[0], job.split("\n    if: ")[1].split("\n")[0], "arm64 is gated exactly like x64");
  for (const name of ["app", "arm64-app", "x64", "x64-input", "x64-tour", "x64-tour-first-run", "x64-gate", "arm64", "arm64-gate"]) {
    assert.ok(blocks[name], `the React Native job ${name} is still there`);
    assert.ok(!blocks[name].includes("assemble-webui.ps1"), `${name} still assembles the React Native shell`);
  }
});

test("the React Native jobs still build and package their shell for a rollback, but never ship it", () => {
  const launch = jobBlocks(WORKFLOW).x64;
  assert.ok(launch.includes('run: scripts/windows/assemble.ps1 -App $env:APP -Engine "${{ runner.temp }}/engine" -Out "${{ runner.temp }}/Ardia" -Version $env:VERSION -Build $env:BUILD\n'));
  assert.ok(launch.includes('run: scripts/windows/make-installer.ps1 -Source "${{ runner.temp }}/Ardia" -Out "${{ runner.temp }}/installer" -Cpu $env:SLUG -Version $env:VERSION -Shell rnw\n'));
  assert.ok(launch.includes('run: scripts/windows/installer-check.ps1 -Setup "${{ runner.temp }}/installer/Ardia-Setup-$env:SLUG.exe" -Shell rnw\n'));
  assert.ok(launch.includes("name: Ardia-Setup-rnw-${{ env.SLUG }}\n"));
  assert.ok(launch.includes("name: Ardia-windows-rnw-${{ env.SLUG }}\n"));
  assert.ok(!launch.includes("windows-release-"), "a release never takes the React Native installers");
  assert.ok(!launch.includes("release-files.ps1"));
  assert.ok(!launch.includes("name: Ardia-Setup-${{ env.SLUG }}\n"), "the installer artifact publish-alpha.sh takes is the WebUI one");
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

test("the WebUI installer runs on full runs and ships; the x64 tour gates the run", () => {
  const job = jobBlocks(WORKFLOW).webui;
  assert.ok(stepNamed(job, "Make the WebUI installer").includes("env.FULL == 'true'"));
  assert.ok(stepNamed(job, "Make the WebUI installer").includes("-Shell webui"));
  assert.ok(stepNamed(job, "Install and uninstall the WebUI build").includes("-Shell webui"));
  const release = stepNamed(job, "Name it for a release");
  assert.ok(release.includes('release-files.ps1 -Installer "${{ runner.temp }}/installer-webui" -Identity "${{ runner.temp }}/ArdiaWebUI/Ardia.build.json" -Cpu $env:SLUG'));
  assert.ok(job.includes("name: Ardia-Setup-${{ env.SLUG }}\n          path: ${{ runner.temp }}/installer-webui\n"), "publish-alpha.sh's Ardia-Setup-<cpu> artifacts are the WebUI installers");
  assert.ok(job.includes("name: windows-release-${{ env.SLUG }}\n"), "a release takes the WebUI installers");
  assert.ok(job.includes("name: Ardia-windows-${{ env.SLUG }}\n          path: ${{ runner.temp }}/ArdiaWebUI\n"));
  assert.match(job, /key: webui-migrate-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-/, "x64 and arm64 never share a migrator build cache");
  const tour = stepNamed(job, "Tour the WebUI build");
  assert.ok(tour.includes("env.FULL == 'true'"));
  assert.ok(tour.includes("env.TOUR == 'true'"));
  assert.ok(!tour.includes("continue-on-error"), "a failed WebUI tour fails the run");
  assert.ok(tour.includes("scripts/windows/webui-pilot/tour-webui.ps1"));
  assert.ok(tour.includes('"Ardia.test-build"'), "the tour runs a copy marked as a test build, never the shippable folder");
});

test("pushes to main and pull requests start Windows on the same paths, including the WebUI sources", () => {
  const pull = triggerPaths(WORKFLOW, "pull_request");
  assert.deepEqual(triggerPaths(WORKFLOW, "push"), pull);
  for (const path of ["apps/desktop/**", "packages/core-rs/crates/ardia-shell-migration/**", "scripts/windows/**"]) assert.ok(pull.includes(path), `${path} starts Windows`);
});

test("the installer is the WebUI shell's unless make-installer asks for the React Native shell", () => {
  assert.match(SCRIPT, /^#ifndef Shell\n {2}#define Shell "webui"\n#endif\n/);
  assert.match(SCRIPT, /#if Shell == "webui"\n {2}#define LaunchSwitch "--ardia-shell=webui"\n {2}#define OpenSuffix " --ardia-shell=webui"\n {2}#define ShellMarker "ardia-ui\\index\.html"\n(?: {2}#define Retired\w+ .*\n)+ {2}#define LoginItemName "Ardia WebUI"\n {2}#define RetiredLoginItemName "Ardia"\n#else\n {2}#define LaunchSwitch ""\n {2}#define OpenSuffix ""\n {2}#define ShellMarker "ArdiaApp\.dll"\n(?: {2}#define Retired\w+ .*\n)+ {2}#define LoginItemName "Ardia"\n {2}#define RetiredLoginItemName "Ardia WebUI"\n#endif\n/);
  assert.ok(SCRIPT.includes('ValueData: """{app}\\Ardia.exe""{#OpenSuffix} --single-argument %1"'));
  assert.ok(SCRIPT.includes('Name: "{autoprograms}\\Ardia"; Filename: "{app}\\Ardia.exe"; Parameters: "{#LaunchSwitch}"; IconFilename: "{app}\\Ardia.ico"; AppUserModelID: "Ardia.Browser"'));
  assert.equal((SCRIPT.match(/Parameters: "\{#LaunchSwitch\}"/g) || []).length, 4, "both shortcuts and both launches after setup carry the switch");
  const installer = read("scripts/windows/make-installer.ps1");
  assert.ok(installer.includes('"/DShell=$shellKind"'), "make-installer passes the shell it found");
  assert.ok(installer.includes('[ValidateSet("auto", "rnw", "webui")][string]$Shell = "webui"'));
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

test("an install moves the replaced shell's login item to its own value name, carrying its Windows approval, and never creates one", () => {
  const code = SCRIPT.slice(SCRIPT.indexOf("[Code]"));
  const items = code.slice(code.indexOf("function LaunchesThisArdia"), code.indexOf("#ifdef RetiredList"));
  assert.ok(code.includes("LoginItemsKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';"));
  assert.ok(code.includes("LoginApprovalsKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';"));
  assert.ok(items.includes("Result := (Rest = '') or (CompareText(Rest, '--ardia-shell=webui') = 0) or (CompareText(Rest, '--ardia-shell=rnw') = 0);"), "only an item launching this install's Ardia.exe with no arguments or only a shell switch counts");
  assert.ok(items.includes("Wanted := '\"' + ExpandConstant('{app}\\Ardia.exe') + '\"{#OpenSuffix}';"), "written as the command this shell opens with");
  const update = items.slice(items.indexOf("procedure UpdateLoginItems;"));
  assert.ok(update.includes("if LoginItemLaunchesThisArdia('{#RetiredLoginItemName}') then"), "the replaced shell's item moves only when it is this install's");
  assert.ok(update.includes("if DestExisted and not LoginItemLaunchesThisArdia('{#LoginItemName}') then\n      WriteLoginItem('{#RetiredLoginItemName}')"), "a custom item under this shell's name is never clobbered; the old one is rewritten in place");
  assert.ok(update.includes("else if LoginItemLaunchesThisArdia('{#LoginItemName}') then\n    WriteLoginItem('{#LoginItemName}');"), "nothing is created when neither item is this install's");
  const move = items.slice(items.indexOf("procedure MoveLoginItem(DestExisted: Boolean);"), items.indexOf("procedure UpdateLoginItems;"));
  const order = ["if not CarryLoginItemApproval(DestExisted) then", "if not WriteLoginItem('{#LoginItemName}') then", "RegDeleteValue(HKCU, LoginItemsKey, '{#RetiredLoginItemName}')", "RegDeleteValue(HKCU, LoginApprovalsKey, '{#RetiredLoginItemName}');"];
  const at = order.map((text) => move.indexOf(text));
  assert.ok(at.every((index) => index >= 0), "the move carries the approval, writes the item, then removes the old ones");
  assert.deepEqual([...at].sort((x, y) => x - y), at, "the old item and its approval go only after the approval and the new item are written");
  assert.equal((move.match(/WriteLoginItem\('\{#RetiredLoginItemName\}'\);\n    Exit;/g) || []).length, 2, "a failed approval or item write keeps the old item and its approval, rewritten in place so it never launches the replaced shell");
  const approval = items.slice(items.indexOf("function CarryLoginItemApproval(DestExisted: Boolean): Boolean;"), items.indexOf("procedure MoveLoginItem(DestExisted: Boolean);"));
  assert.ok(approval.includes("Result := True;\n  if DestExisted then Exit;"), "a live item under this shell's name keeps its own approval, and none means it is enabled");
  assert.ok(approval.includes("if RegValueExists(HKCU, LoginApprovalsKey, '{#RetiredLoginItemName}') then\n  begin\n    Result := RegQueryBinaryValue(HKCU, LoginApprovalsKey, '{#RetiredLoginItemName}', Approval);\n    if Result then\n      Result := RegWriteBinaryValue(HKCU, LoginApprovalsKey, '{#LoginItemName}', Approval);"), "a new item takes the old item's approval over any orphan left under its name, and an approval that exists but can't be read stops the move");
  assert.ok(approval.includes("else if RegValueExists(HKCU, LoginApprovalsKey, '{#LoginItemName}') then\n    Result := RegDeleteValue(HKCU, LoginApprovalsKey, '{#LoginItemName}');"), "an orphaned approval never disables an enabled item that moves under its name");
  assert.ok(move.includes("if RegDeleteValue(HKCU, LoginItemsKey, '{#RetiredLoginItemName}') then\n  begin\n    RegDeleteValue(HKCU, LoginApprovalsKey, '{#RetiredLoginItemName}');"), "the old approval goes only once the old item is gone, so a failed delete never enables a disabled item");
  assert.ok(update.includes("DestExisted := RegValueExists(HKCU, LoginItemsKey, '{#LoginItemName}');"));
  const hook = code.slice(code.indexOf("procedure CurStepChanged"));
  assert.ok(hook.indexOf("#endif") < hook.indexOf("if CurStep = ssPostInstall then\n    UpdateLoginItems;"), "login items move whether or not the installer retires another shell's files");
  assert.match(SCRIPT, /#if Shell == "rnw"\n\[Dirs\]\nName: "\{localappdata\}\\Ardia\\User Data"\n#endif\n/, "only the React Native installer makes the React Native profile folder");
  const check = read("scripts/windows/installer-check.ps1");
  for (const thrown of ["the install left the $($loginSeed.Retired) login item", "login item is '$item' after the install", "does not carry the disabled approval of $($loginSeed.Retired)", "the install left StartupApproved\\Run\\$($loginSeed.Retired)", "a login item with its own arguments became", "an unrelated login item became"]) assert.ok(check.includes(thrown), thrown);
  assert.ok(check.indexOf("$installedByCheck = $true") < check.indexOf("} finally {"));
  const cleanup = check.slice(check.indexOf("} finally {"));
  assert.ok(cleanup.indexOf('try { Invoke-Quietly $uninstaller "the uninstaller" } catch { Write-Warning') < cleanup.indexOf("Restore-RegistryValue"), "a failed check still uninstalls, without hiding its error, before the seeded values are restored");
  assert.ok(!/Remove-Item -LiteralPath \$loginApprovals/.test(check), "the StartupApproved key stays: only the values the check touched are restored");
  assert.ok(check.includes("Write-RegistryValue $loginApprovals $loginSeed.Item Binary $loginSeed.OrphanApproval"), "an enabled approval an earlier Open at Login left under this shell's name is seeded");
});

test("the WebUI tour launches Ardia.exe with no shell switch and checks the shell, its profile and the signed updater, never near a live profile", () => {
  const tour = read("scripts/windows/webui-pilot/tour-webui.ps1");
  const flagless = tour.slice(tour.indexOf("if ($liveProfiles.Count) {"), tour.indexOf("$script:Data = $tourData"));
  assert.ok(flagless.includes("Start-Process $launcherPath -ArgumentList (Join-Arguments @('--enable-logging', '--v=0')) -PassThru"), "the launch passes no --ardia-shell");
  assert.ok(!flagless.includes("--ardia-shell="), "nothing in the flagless check passes a shell switch");
  assert.ok(tour.indexOf("$liveProfiles = ") < tour.indexOf("$p = Start-Shell"), "the live-profile guard is read before the tour's first launch creates anything");
  assert.ok(flagless.indexOf("$env:LOCALAPPDATA = $flaglessLocal") < flagless.indexOf("Start-Process $launcherPath"), "the engine's default profile lands in the run's own LOCALAPPDATA");
  assert.ok(flagless.indexOf("$env:LOCALAPPDATA = $savedLocalAppData") > flagless.indexOf("Start-Process $launcherPath"), "and the tour's own environment comes back right after");
  for (const name of ["flagless-launch-is-webui", "flagless-launch-webui-profile", "flagless-launch-signed-updater"]) assert.ok(flagless.includes(`Check '${name}'`), name);
  assert.ok(flagless.includes("h.invoke('ArdiaUpdates.status', { args: [] })"));
  assert.ok(tour.includes("if ($flaglessRun) { try { Remove-PilotRun $flaglessRun }"), "the flagless run's folder is removed like the tour's");
  assert.ok(flagless.includes("if ($RequireFlagless) {\n      Check 'flagless-launch' $false"), "with -RequireFlagless a live profile fails the tour instead of skipping the check");
  assert.ok(stepNamed(jobBlocks(WORKFLOW).webui, "Tour the WebUI build").includes("-RequireFlagless"), "CI requires the flagless launch");
  assert.ok(flagless.includes("($status.kind -ceq 'portable')"), "the tour copy is a portable signed-updater build: verifier, key and Ardia.build.json, no uninstaller");
  assert.ok(flagless.includes('$profileCandidates = @($Data, (Join-Path $flaglessLocal \'Ardia WebUI\'))'), "the effective profile is the WebUI folder whose DevToolsActivePort the running browser listens on");
  assert.ok(flagless.includes("$switched = @($commandLines | Where-Object { $_ -match '--ardia-shell' })"), "no process of the flagless launch carries a shell switch");
  assert.ok(!flagless.includes("--user-data-dir=(?:"), "the check never relies on a --user-data-dir in the OS command line");
});

test("the WebUI tour double-clicks a real title bar, opens Split View with Ctrl+\\, closes the Little Ardia a second launch opens, and starts the flagless launch from a stopped engine", () => {
  const tour = read("scripts/windows/webui-pilot/tour-webui.ps1");
  assert.ok(tour.includes("document.querySelectorAll('[data-ardia-drag=\"\"caption\"\"]')"), "the double-click aims at a region whose double-click is the title bar action");
  assert.ok(tour.includes("document.elementFromPoint(x, y) === region"), "at a point nothing covers");
  const split = tour.slice(tour.indexOf("$splitFrom = @(Visible-Pages)"), tour.indexOf("Check 'split-view'"));
  assert.ok(split.includes("[Pilot]::Chord(0x11, 0xDC)"), "Split View is Ctrl+\\ on Windows; Ctrl+Shift+= is Zoom In and Win+Shift+= the Magnifier");
  assert.ok(split.indexOf("e.blur()") < split.indexOf("[Pilot]::Chord(0x11, 0xDC)"), "a field focused earlier can't pass for the new pane's");
  assert.ok(split.includes("($now -contains $urlE) -and @($splitFrom | Where-Object { $now -contains $_ }).Count -ge 1"), "the new pane's page and the page beside it show together");
  assert.ok(split.includes("(Address-Focused) -and ((ShellEval 'document.hasFocus()') -eq $true)"), "keys are typed only once the shell, not the page beside it, holds the keyboard");
  assert.ok(tour.includes("Check 'caption-drag-back'"), "the window goes back where it was, so its caption buttons stay on a small screen");
  assert.ok(tour.includes("sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)"), "the top-most caption region is aimed at first");
  assert.ok(tour.includes("[Pilot]::GetSystemMetrics(0)") && tour.includes("[Pilot]::GetSystemMetrics(1)"), "only a caption point on the screen and inside the window is double-clicked");
  assert.ok(tour.includes("[Pilot]::CountShells('Ardia') -eq ($windowsBefore + 1)"), "a second launch's address opens in Little Ardia");
  assert.ok(tour.indexOf("Check 'second-launch-window-closes'") < tour.indexOf("Check 'clean-quit'"), "Little Ardia closes before the main window's Close ends the engine");
  assert.ok(tour.includes("$added = @([Pilot]::Shells() | Where-Object { $shellsBefore -notcontains $_ -and $_ -ne $h })"), "only the window the second launch added is closed, never whatever has focus");
  assert.ok(!tour.slice(tour.indexOf("$shellsBefore = "), tour.indexOf("Check 'second-launch-window-closes'")).includes("GetForegroundWindow"));
  assert.ok(read("scripts/windows/webui-pilot/lib.ps1").includes("public static List<IntPtr> Shells()"));
  const beforeFlagless = tour.slice(tour.indexOf("Check 'no-stray-processes'"), tour.indexOf("if ($liveProfiles.Count) {"));
  assert.ok(beforeFlagless.includes("Stop-Engine") && beforeFlagless.includes("(Engine-Processes).Count -eq 0"), "an earlier failure never leaves a process the flagless check would count");
});
