param(
  [string]$App = '',
  [string]$Out = '',
  [string]$Label = 'tour-webui',
  [string]$AppUserModelId = 'Ardia.Browser',
  [int]$LaunchSeconds = 90
)
if ($App) { $env:PILOT_APP = (Resolve-Path -LiteralPath $App).Path.TrimEnd('\') }
if ($Out) {
  New-Item -ItemType Directory -Force $Out | Out-Null
  $env:PILOT_PROOF = (Resolve-Path -LiteralPath $Out).Path
  if (-not $env:PILOT_RUNS) { $env:PILOT_RUNS = Join-Path $env:PILOT_PROOF 'runs' }
}
. (Join-Path $PSScriptRoot 'lib.ps1')
$ErrorActionPreference = 'Continue'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TourWindow {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out uint count);
    int GetAt(uint index, out PROPERTYKEY key);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    int Commit();
  }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT value);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] static extern IntPtr GetClassLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  public static string AppUserModelId(IntPtr hwnd) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore store;
    if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0 || store == null) return null;
    try {
      PROPERTYKEY key = new PROPERTYKEY(); key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); key.pid = 5;
      PROPVARIANT value;
      if (store.GetValue(ref key, out value) != 0) return null;
      try { return value.vt == 31 ? Marshal.PtrToStringUni(value.pointer) : ""; } finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
  public static bool HasIcon(IntPtr hwnd) {
    IntPtr icon;
    SendMessageTimeout(hwnd, 0x007F, new IntPtr(1), IntPtr.Zero, 0x2, 2000, out icon);
    if (icon != IntPtr.Zero) return true;
    return GetClassLongPtr(hwnd, -14) != IntPtr.Zero;
  }
}
"@

$results = New-Object System.Collections.Specialized.OrderedDictionary ([StringComparer]::Ordinal)
$stepStarted = Get-Date
function Check([string]$name, [bool]$ok, [string]$detail) {
  $ms = [int]((Get-Date) - $script:stepStarted).TotalMilliseconds
  $results[$name] = @{ ok = $ok; detail = $detail; ms = $ms }
  Log ("{0} {1} ({2} ms): {3}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $ms, $detail))
  $script:stepStarted = Get-Date
}
function ShellEval([string]$js) { Cdp-Eval $js 'chrome://ardia/' }
function PageEval([string]$js, [string]$url) { Cdp-Eval $js $url }
function Scale($h) { [Pilot]::GetDpiForWindow($h) / 96.0 }
function CssToScreen($h, $x, $y) {
  $o = New-Object Pilot+POINT; [Pilot]::ClientToScreen($h, [ref]$o) | Out-Null; $s = Scale $h
  @([int]($o.X + $x * $s), [int]($o.Y + $y * $s))
}
function ShellRect([string]$js) {
  $json = ShellEval "(() => { const e = $js; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify([r.x, r.y, r.width, r.height]); })()"
  if ($json) { $json | ConvertFrom-Json } else { $null }
}
function Center($h, $rect) { CssToScreen $h ($rect[0] + $rect[2] / 2) ($rect[1] + $rect[3] / 2) }
function Settle-Frame { Wait-Settled { Rect-Text ([Pilot]::Frame($h)) } 5 | Out-Null }
function Pages { @(Cdp-List | Where-Object { $_.type -eq 'page' -and $_.url -like 'file:*' }) }
function Page-Urls { (Pages | ForEach-Object { $_.url }) -join ' | ' }
function Visible-Pages { @(Pages | Where-Object { (PageEval 'document.visibilityState' $_.url) -eq 'visible' } | ForEach-Object { $_.url }) }
function Shell-Targets { @(Cdp-List | Where-Object { $_.url -like 'chrome://ardia/*' }).Count }
function Address-Focused { (ShellEval '(() => { const e = document.activeElement; return !!e && e.tagName === "INPUT"; })()') -eq $true }
function Go([string]$url) {
  [Pilot]::Chord(0x11, 0x4C)
  Wait-Until { Address-Focused } 5 'Ctrl+L to focus the address field' -NoThrow | Out-Null
  [Pilot]::Chord(0x11, 0x41)
  [Pilot]::Type($url)
  [Pilot]::Chord(0x0D)
  Wait-Until { @(Pages | Where-Object { $_.url -eq $url }).Count -ge 1 } 20 "a page at $url" -NoThrow
}
$maxSelector = 'document.querySelector(''.ardia-window-controls [role="button"][aria-label="Maximize"], .ardia-window-controls [role="button"][aria-label="Restore Down"]'')'
$closeSelector = 'document.querySelector(''.ardia-window-controls [role="button"][aria-label="Close"]'')'
$maxState = "(() => { const b = $maxSelector; return b ? JSON.stringify({ hover: b.getAttribute('data-ardia-nc-hover') === 'true', pressed: b.getAttribute('data-ardia-nc-pressed') === 'true' }) : null; })()"
function Max-State { $json = ShellEval $maxState; if ($json) { $json | ConvertFrom-Json } else { $null } }

$started = Get-Date
$h = [IntPtr]::Zero
$run = $null
$downloadName = "ardia-tour-$([guid]::NewGuid().ToString('N').Substring(0, 12)).txt"
$downloadFolders = @((Join-Path $env:USERPROFILE 'Downloads'))
try {
  Stop-Engine
  $launcherPath = Join-Path $App $Launcher
  $marker = Join-Path $App 'Ardia.test-build'
  Check 'build' ((Test-Path -LiteralPath $launcherPath -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $App 'ardia-ui\index.html') -PathType Leaf) -and (Test-Path -LiteralPath $marker -PathType Leaf)) "$launcherPath with ardia-ui\index.html and the Ardia.test-build marker CDP needs"
  if (-not $results['build'].ok) { throw "$App is not a WebUI test build" }
  if ($Launcher -eq 'Ardia.exe') {
    $identityScript = @((Join-Path $PSScriptRoot 'launcher-identity.ps1'), (Join-Path (Split-Path -Parent $PSScriptRoot) 'launcher-identity.ps1')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $icon = @((Join-Path $App 'Ardia.ico'), (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'apps\browser\windows\Ardia\Ardia.ico')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($identityScript -and $icon) {
      $identity = $null
      try { & $identityScript -Icon $icon -To $launcherPath -Check | Out-Null; $identity = $LASTEXITCODE } catch { $identity = $_.Exception.Message }
      Check 'launcher-identity' ("$identity" -eq '0') "Ardia.exe carries Ardia's icon and name: $identity"
    }
  }

  $run = New-PilotRun
  $pages = Join-Path $run 'pages'
  New-Item -ItemType Directory -Force $pages | Out-Null
  $pageA = Join-Path $pages 'a.html'; $pageB = Join-Path $pages 'b.html'; $pageC = Join-Path $pages 'download.html'; $pageD = Join-Path $pages 'handed-over.html'
  Set-Content -LiteralPath $pageD -Value '<!doctype html><title>Tour handed over</title><h1 id="t">D</h1>' -Encoding utf8
  Set-Content -LiteralPath $pageA -Value '<!doctype html><title>Tour A</title><h1 id="t">A</h1><input id="q">' -Encoding utf8
  Set-Content -LiteralPath $pageB -Value '<!doctype html><title>Tour B</title><h1 id="t">B</h1>' -Encoding utf8
  Set-Content -LiteralPath $pageC -Value "<!doctype html><title>Tour download</title><a id=`"d`" download=`"$downloadName`" href=`"data:text/plain;charset=utf-8,ardia%20tour`">save</a>" -Encoding utf8
  $urlA = ([Uri]$pageA).AbsoluteUri; $urlB = ([Uri]$pageB).AbsoluteUri; $urlC = ([Uri]$pageC).AbsoluteUri; $urlD = ([Uri]$pageD).AbsoluteUri
  $downloadFolders += (Join-Path $Data 'Downloads')

  $p = Start-Shell
  $h = Wait-ShellReady $LaunchSeconds
  Wait-Until { (ShellRect 'document.querySelector(''input'')') -and (ShellRect $maxSelector) } 30 'the address field and window controls' -NoThrow | Out-Null
  Check 'clean-launch' ($h -ne [IntPtr]::Zero) ("window in {0:n1} s, dpi {1}, frame {2}" -f ((Get-Date) - $started).TotalSeconds, [Pilot]::GetDpiForWindow($h), (Rect-Text ([Pilot]::Frame($h))))
  Shot "$Proof\$Label-01-launch.png"
  $appId = [TourWindow]::AppUserModelId($h)
  Check 'window-icon' ([TourWindow]::HasIcon($h)) 'the shell window has a big icon for the taskbar and Alt+Tab'
  Check 'window-app-id' ($appId -eq $AppUserModelId) "the window's AppUserModelID is '$appId', want $AppUserModelId so it groups with the Start Menu shortcut"

  $before = [Pilot]::Frame($h)
  $grab = CssToScreen $h 100 400
  [Pilot]::Drag($grab[0], $grab[1], ($grab[0] + 140), ($grab[1] + 90), 25)
  Settle-Frame
  $after = [Pilot]::Frame($h)
  Check 'caption-drag' ((($after.Left - $before.Left) -ge 120) -and (($after.Top - $before.Top) -ge 70)) "$(Rect-Text $before) -> $(Rect-Text $after)"
  $grab = CssToScreen $h 100 400
  [Pilot]::DoubleClick($grab[0], $grab[1])
  Wait-Until { [Pilot]::IsZoomed($h) } 5 'a caption double-click to maximize' -NoThrow | Out-Null
  $zoomed = [Pilot]::IsZoomed($h)
  Settle-Frame
  $grab = CssToScreen $h 100 400
  [Pilot]::DoubleClick($grab[0], $grab[1])
  Wait-Until { -not [Pilot]::IsZoomed($h) } 5 'a second double-click to restore' -NoThrow | Out-Null
  Settle-Frame
  Check 'caption-double-click' ($zoomed -and -not [Pilot]::IsZoomed($h)) "maximized $zoomed, restored $(-not [Pilot]::IsZoomed($h))"

  $max = ShellRect $maxSelector
  if ($max) {
    $c = Center $h $max
    [Pilot]::Glide($c[0], $c[1], 15, 15)
    $hit = [Pilot]::Hit($c[0], $c[1])
    $hovered = Wait-Until { $s = Max-State; $s -and $s.hover } 5 'HTMAXBUTTON hover state' -NoThrow
    [Pilot]::Down()
    $pressed = Wait-Until { $s = Max-State; $s -and $s.pressed } 5 'HTMAXBUTTON pressed state' -NoThrow
    $z0 = [Pilot]::IsZoomed($h)
    [Pilot]::Glide($c[0] - 300, $c[1] + 300, 10, 10)
    [Pilot]::Up()
    $released = Wait-Until { $s = Max-State; $s -and -not $s.pressed -and -not $s.hover } 5 'the pressed state to clear when the press leaves the button' -NoThrow
    [Pilot]::Chord(0x1B)
    Check 'maximize-button-states' (($hit -match ':9$') -and [bool]$hovered -and [bool]$pressed -and [bool]$released -and ([Pilot]::IsZoomed($h) -eq $z0)) "hit $hit; hover $([bool]$hovered), pressed $([bool]$pressed), cleared after leaving $([bool]$released), zoom unchanged $([Pilot]::IsZoomed($h) -eq $z0)"
    [Pilot]::Click($c[0], $c[1])
    Wait-Until { [Pilot]::IsZoomed($h) -ne $z0 } 5 'the maximize button to change the window' -NoThrow | Out-Null
    $z1 = [Pilot]::IsZoomed($h)
    Settle-Frame
    $max2 = ShellRect $maxSelector
    if ($max2) { $c2 = Center $h $max2; [Pilot]::Click($c2[0], $c2[1]) }
    Wait-Until { [Pilot]::IsZoomed($h) -eq $z0 } 5 'the restore button to change the window back' -NoThrow | Out-Null
    Settle-Frame
    Check 'maximize-button-click' (($z1 -ne $z0) -and ([Pilot]::IsZoomed($h) -eq $z0)) "zoomed $z0 -> $z1 -> $([Pilot]::IsZoomed($h))"
  } else {
    Check 'maximize-button-states' $false 'no maximize control in the shell'
  }

  [Pilot]::SetForegroundWindow($h) | Out-Null
  $navigated = Go $urlA
  Check 'navigate' ([bool]$navigated) "typed $urlA into the address field; pages: $(Page-Urls)"
  [Pilot]::Chord(0x11, 0x54)
  Wait-Until { Address-Focused } 5 'Ctrl+T to open a new tab' -NoThrow | Out-Null
  [Pilot]::Type($urlB); [Pilot]::Chord(0x0D)
  $opened = Wait-Until { @(Pages | Where-Object { $_.url -eq $urlB }).Count -ge 1 -and @(Pages | Where-Object { $_.url -eq $urlA }).Count -ge 1 } 20 'a second tab' -NoThrow
  Check 'new-tab' ([bool]$opened) "Ctrl+T then $urlB; pages: $(Page-Urls)"
  $visibleBefore = (Visible-Pages) -join ','
  [Pilot]::Chord(0x11, 0x09)
  $switched = Wait-Until { $now = (Visible-Pages) -join ','; $now -and $now -ne $visibleBefore } 5 'Ctrl+Tab to show the other tab' -NoThrow
  Check 'tab-switch' ([bool]$switched) "visible before: $visibleBefore; after Ctrl+Tab: $((Visible-Pages) -join ',')"
  Shot "$Proof\$Label-02-tabs.png"

  $viewportsBefore = [int](ShellEval 'document.querySelectorAll("[data-ardia-native-tab]").length')
  [Pilot]::Chord(0x11, 0x10, 0xBB)
  $split = Wait-Until { ([int](ShellEval 'document.querySelectorAll("[data-ardia-native-tab]").length') -gt $viewportsBefore) -or ((Visible-Pages).Count -ge 2) } 8 'Ctrl+Shift+= to open a split pane' -NoThrow
  Check 'split-view' ([bool]$split) "page viewports $viewportsBefore -> $([int](ShellEval 'document.querySelectorAll("[data-ardia-native-tab]").length')), visible pages $((Visible-Pages).Count)"
  Shot "$Proof\$Label-03-split.png"

  $windowsBefore = [Pilot]::CountShells('Ardia')
  $targetsBefore = Shell-Targets
  [Pilot]::SetForegroundWindow($h) | Out-Null
  [Pilot]::Chord(0x11, 0xBC)
  $settings = Wait-Until { ([Pilot]::CountShells('Ardia') -gt $windowsBefore) -or ((Shell-Targets) -gt $targetsBefore) -or ((ShellEval '!!document.querySelector(''[aria-label="Settings"], [data-ardia-settings], [role="dialog"]'')') -eq $true) } 10 'Ctrl+, to open Settings' -NoThrow
  Check 'settings-window' ([bool]$settings) "shell windows $windowsBefore -> $([Pilot]::CountShells('Ardia')), shell documents $targetsBefore -> $(Shell-Targets)"
  Shot "$Proof\$Label-04-settings.png"
  if ([Pilot]::CountShells('Ardia') -gt $windowsBefore) {
    $foreground = [Pilot]::GetForegroundWindow()
    if ($foreground -ne $h) { [TourWindow]::PostMessage($foreground, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
    $back = Wait-Until { [Pilot]::CountShells('Ardia') -eq $windowsBefore } 10 'the Settings window to close' -NoThrow
    Check 'settings-closes' ([bool]$back -and [Pilot]::IsWindowVisible($h)) "Settings closed and the main window stayed: $([bool]$back)"
  } else {
    [Pilot]::Chord(0x1B)
  }

  [Pilot]::SetForegroundWindow($h) | Out-Null
  $loaded = Go $urlC
  $existing = @{}
  foreach ($folder in $downloadFolders) { if (Test-Path -LiteralPath (Join-Path $folder $downloadName)) { $existing[$folder] = $true } }
  if ($loaded) { PageEval 'document.getElementById("d").click(); true' $urlC | Out-Null }
  $saved = Wait-Until { $downloadFolders | Where-Object { -not $existing[$_] -and (Test-Path -LiteralPath (Join-Path $_ $downloadName) -PathType Leaf) } | Select-Object -First 1 } 20 'the download to land' -NoThrow
  $content = if ($saved) { Get-Content -LiteralPath (Join-Path $saved $downloadName) -Raw } else { '' }
  Check 'download' ($saved -and $content -eq 'ardia tour') "a download link on a page saved $downloadName in $(if ($saved) { $saved } else { 'no folder' }) with '$content'"

  $docName = 'tour-roundtrip.json'
  $docText = '{"tour":true,"text":"Ardia ' + [char]0x00e9 + '"}'
  $docJs = ($docText | ConvertTo-Json -Compress)
  $answer = ShellEval "(async () => { const h = window.__ardiaHost; const before = await h.invoke('ArdiaShell.readDocument', { args: ['$docName'] }); await h.invoke('ArdiaShell.writeDocument', { args: ['$docName', $docJs] }); const read = await h.invoke('ArdiaShell.readDocument', { args: ['$docName'] }); return JSON.stringify({ before: before === undefined ? null : before, read }); })().catch(e => JSON.stringify({ error: String(e && e.message || e) }))"
  $doc = if ($answer) { $answer | ConvertFrom-Json } else { $null }
  $disk = Get-Content -LiteralPath (Join-Path $Data $docName) -Raw -Encoding utf8 -ErrorAction SilentlyContinue
  $removed = ShellEval "window.__ardiaHost.invoke('ArdiaShell.removeDocument', { args: ['$docName'] }).then(() => window.__ardiaHost.invoke('ArdiaShell.readDocument', { args: ['$docName'] })).then(v => v === undefined || v === null, () => false)"
  Check 'document-round-trip' ($doc -and $null -eq $doc.before -and $doc.read -eq $docText -and $disk -eq $docText -and $removed -eq $true -and -not (Test-Path -LiteralPath (Join-Path $Data $docName))) "write, read back, on disk and remove: $answer; disk '$disk'; removed $removed"

  $windowsBefore = [Pilot]::CountShells('Ardia')
  $second = Start-Process $launcherPath -ArgumentList (Join-Arguments @('--ardia-shell=webui', "--user-data-dir=$(Join-Path $Data 'Chromium')", '--single-argument', $urlD)) -PassThru
  [Pilot]::Roots.Add($second.Id) | Out-Null
  $secondExited = $second.WaitForExit(20000)
  $handedOver = Wait-Until { @(Pages | Where-Object { $_.url -eq $urlD }).Count -ge 1 } 15 'the running window to open the address a second launch handed over' -NoThrow
  $windowsAfter = [Pilot]::CountShells('Ardia')
  Check 'second-launch-opens-address' ([bool]$handedOver -and $secondExited -and $windowsAfter -eq $windowsBefore) "Ardia.exe --ardia-shell=webui --single-argument <address> while the shell runs: the second process exited $secondExited, the address opened in the running window $([bool]$handedOver), windows $windowsBefore -> $windowsAfter (a running WebUI shell takes addresses from a second launch with the Wave 5B-3b engine, #4118)"

  $close = ShellRect $closeSelector
  [Pilot]::SetForegroundWindow($h) | Out-Null
  if ($close) { $c = Center $h $close; [Pilot]::Click($c[0], $c[1]) } else { [Pilot]::Chord(0x12, 0x73) }
  $closedAt = Get-Date
  $gone = Wait-Until { (Engine-Processes).Count -eq 0 } 20 'the engine to exit' -NoThrow
  Check 'clean-quit' ([bool]$gone) ("the window's Close button ended the engine in {0:n1} s" -f ((Get-Date) - $closedAt).TotalSeconds)
  $stray = Wait-Until { (App-Processes).Count -eq 0 } 10 'stray processes from the build to exit' -NoThrow
  Check 'no-stray-processes' ([bool]$stray) "processes still running from ${App}: $((App-Processes | ForEach-Object { "$($_.Name) $($_.ProcessId)" }) -join ', ')"
} catch {
  Check 'no-terminating-error' $false "$($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  Stop-Engine
  Remove-Item Env:ARDIA_DATA_DIR, Env:ARDIA_REMOTE_DEBUGGING_PORT -ErrorAction SilentlyContinue
  foreach ($folder in $downloadFolders) { Remove-Item -LiteralPath (Join-Path $folder $downloadName) -Force -ErrorAction SilentlyContinue }
  if ($Data) { Get-Content -LiteralPath "$Data\Chromium\chrome_debug.log" -ErrorAction SilentlyContinue | Select-String -Pattern 'WebUI shell' | Select-Object -Last 80 | ForEach-Object { $_.Line } | Set-Content -LiteralPath "$Proof\$Label-shell-log.txt" }
  if ($run) { try { Remove-PilotRun $run } catch { Log "could not remove ${run}: $($_.Exception.Message)" } }
}

$failed = @($results.Keys | Where-Object { -not $results[$_].ok })
$report = [ordered]@{
  label = $Label
  app = $App
  launcher = $Launcher
  started = $started.ToUniversalTime().ToString('o')
  seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  passed = $results.Count - $failed.Count
  failed = $failed.Count
  checks = $results
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Proof "$Label-results.json") -Encoding utf8
$lines = @("### Windows WebUI tour", "", "$($report.passed) of $($results.Count) checks passed in $($report.seconds) s ($Launcher).", "", "| Check | Result | ms | Detail |", "| --- | --- | --- | --- |")
foreach ($name in $results.Keys) {
  $row = $results[$name]
  $detail = ($row.detail -replace '\|', '\|' -replace '\r?\n', ' ')
  $lines += "| $name | $(if ($row.ok) { 'pass' } else { '**fail**' }) | $($row.ms) | $detail |"
}
$lines | Set-Content -LiteralPath (Join-Path $Proof "$Label.md") -Encoding utf8
"DONE $Label, $($failed.Count) failed"
if ($failed.Count) { exit 1 }
exit 0
