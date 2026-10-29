#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release.sh <version> [--rc] [--phased <seconds>] [--phase build|sign|check]  (a -nightly.<n> version is a nightly)"
version="${1:?$usage}"
shift
rc=0
phased=""
phase=all
while [ $# -gt 0 ]; do
  case "$1" in
    --rc) rc=1 ;;
    --phase)
      phase="${2:-}"
      shift
      case "$phase" in build | sign | check) ;; *) echo "error: --phase is build, sign or check, got '$phase'" >&2; exit 1 ;; esac
      ;;
    --phased)
      phased="${2:-}"
      shift
      case "$phased" in '' | *[!0-9]* | 0) echo "error: --phased takes whole seconds (86400 is a day), got '$phased'" >&2; exit 1 ;; esac
      ;;
    *) echo "error: unknown option $1 ($usage)" >&2; exit 1 ;;
  esac
  shift
done
[ "$rc" = 1 ] && [ -n "$phased" ] && { echo "error: a candidate is never published, so --phased doesn't apply to --rc" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$root/scripts/lib/releases.sh"
channel="$(channel_of "$version")"
app_dir="$root/apps/browser"
macos="$app_dir/macos"
ardiacore="$root/packages/ardiacore"
notes_page="https://ardia.dev/release-notes"
notary_profile="${NOTARY_PROFILE:-ardia}"
[ -f "$root/scripts/.notary.env" ] && . "$root/scripts/.notary.env"
if [ -n "${NOTARY_KEY:-}" ]; then
  notary_auth=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
else
  notary_auth=(--keychain-profile "$notary_profile")
fi
sparkle="${SPARKLE_BIN:-$macos/Pods/Sparkle/bin}"
sparkle_key_file="${SPARKLE_KEY_FILE:-}"
if [ "$phase" = build ] || [ "$phase" = check ]; then
  :
elif [ -n "$sparkle_key_file" ]; then
  [ -s "$sparkle_key_file" ] || { echo "error: SPARKLE_KEY_FILE ($sparkle_key_file) is missing or empty" >&2; exit 1; }
elif [ -n "${SPARKLE_ACCOUNT:-}" ]; then
  sparkle_account="$SPARKLE_ACCOUNT"
else
  legacy_account="$("$root/scripts/lib/legacy-name.sh" appName | tr '[:upper:]' '[:lower:]')"
  sparkle_account=ardia
  for account in ardia $legacy_account; do
    if "$sparkle/generate_keys" --account "$account" -p >/dev/null 2>&1; then sparkle_account="$account"; break; fi
  done
fi
[ "$phase" = build ] || [ "$phase" = check ] || [ -n "$sparkle_key_file" ] \
  || "$sparkle/generate_keys" --account "$sparkle_account" -p >/dev/null 2>&1 || {
  echo "error: no Sparkle EdDSA key in the login keychain under account $sparkle_account (SPARKLE_ACCOUNT; docs/releasing.md)" >&2
  exit 1
}
die() { echo "error: $*" >&2; exit 1; }
if [ "$rc" = 1 ]; then dist="$root/dist/$version-rc"; else dist="$root/dist/$version"; fi
[ "$rc" = 1 ] && [ -n "${RC_DIST:-}" ] && dist="$(cd "$root" && mkdir -p "$RC_DIST" && cd "$RC_DIST" && pwd)"
build="${RELEASE_BUILD_DIR:-$app_dir/build-release}"
archive="$dist/Ardia.xcarchive"
app="$dist/export/Ardia.app"
zip="$dist/Ardia-$version.zip"
dmg="$dist/Ardia-$version.dmg"
. "$root/scripts/lib/paths.sh"
framework_src="$chromium_framework"
framework_engine="${ARDIACORE_FRAMEWORK_ENGINE:-}"
provisioning_profile="${RELEASE_PROVISIONING_PROFILE:-}"
read -r -a extra_build_settings <<<"${RELEASE_BUILD_SETTINGS:-}"
build_input="${RELEASE_BUILD_INPUT:-}"
if [ "$phase" = sign ] && [ -n "$build_input" ]; then
  archive="$build_input/Ardia.xcarchive"
fi
if [ "$phase" = sign ] || [ "$phase" = check ]; then
  framework_src="$archive/Products/Applications/Ardia.app/Contents/Frameworks/Chromium Framework.framework"
  [ "$phase" = check ] || [ -d "$archive" ] || die "no $archive: run --phase build first"
fi

launch_check() {
  echo "==> Launch check"
  check_data="$(mktemp -d "${TMPDIR:-/tmp}/ac-release.XXXXXX")"
  launched="$("$root/scripts/agent/ac" launch "$app" --data "$check_data" --js none --no-wait)" || die "the app didn't start"
  check_port="$(sed -n 's/^pid [0-9]* port \([0-9]*\) .*/\1/p' <<<"$launched")"
  ubo_ok=0
  node "$root/scripts/lib/ubo-ready.mjs" "$check_port" 90 && ubo_ok=1
  sleep 5
  "$root/scripts/agent/ac" quit "$check_data" >/dev/null || die "the app quit before the check ended"
  codesign --verify --deep --strict "$app" || die "running the app changed its bundle"
  [ "$ubo_ok" = 1 ] || die "uBlock Origin wasn't ready and blocking in the exported app (90 s)"
  rm -rf "$check_data"
}
if [ "$phase" = check ]; then
  [ -d "$app" ] || die "no $app: run --phase sign first"
  launch_check
  echo "Launch check passed: $app"
  exit 0
fi

pbx="$macos/Ardia.xcodeproj/project.pbxproj"
project_version="$(sed -n 's/.*MARKETING_VERSION = "\{0,1\}\([^";]*\)"\{0,1\};/\1/p' "$pbx" | sort -u)"
min_macos="$(sed -n 's/.*MACOSX_DEPLOYMENT_TARGET = \([0-9]*\)\.0;/\1/p' "$pbx" | sort -u)"
[[ "$min_macos" =~ ^[0-9]+$ ]] || die "the project's MACOSX_DEPLOYMENT_TARGET isn't one whole macOS version: '$min_macos'"
project_build="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \(.*\);/\1/p' "$pbx" | sort -u)"
version_settings=()
release_build="$project_build"
if [ "$rc" = 1 ]; then
  [ "$project_version" = "$version" ] || { release_build="$((project_build + 1))"; version_settings=(MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$release_build"); }
elif [ "$project_version" != "$version" ]; then
  die "MARKETING_VERSION is '$project_version'. Set it to $version (and bump CURRENT_PROJECT_VERSION) first."
fi

notes="$root/docs/release-notes/$version.md"
if [ -f "$notes" ]; then
  note() { node "$root/scripts/lib/release-note.mjs" "$notes" "$1"; }
  headline="$(note headline)" || die "$notes: its frontmatter doesn't read (above)"
  notes_video="$(note video)"
  notes_body() { note body; }
elif [ "$rc" = 1 ]; then
  headline="Release candidate $version"
  notes_video=""
  notes_body() { echo "A release candidate of Ardia $version. Not published."; }
else
  die "no release notes: write docs/release-notes/$version.md first"
fi

dirty="$(git -C "$root" status --porcelain -- apps/browser apps/cli packages engine scripts/dmg | grep -v ' apps/browser/build' || true)"
if [ -n "$dirty" ]; then
  [ "$rc" = 1 ] || { echo "$dirty" >&2; die "uncommitted changes under apps/browser, apps/cli, packages, engine or scripts/dmg (above)"; }
  echo "warning: the candidate includes uncommitted changes:" >&2
  echo "$dirty" >&2
fi

[ -d "$framework_src" ] || die "no ArdiaCore framework at $framework_src (engine/ardiacore/apply.sh, then build chrome_framework)"
[ "$phase" = sign ] || [[ " $(lipo -archs "$framework_src/Versions/Current/Chromium Framework" 2>/dev/null) " == *" arm64 "* ]] \
  || die "the ArdiaCore framework at $framework_src has no arm64 slice"
if [ "$phase" = sign ]; then
  [ -n "$provisioning_profile" ] || die "--phase sign exports the ad hoc archive --phase build made: set RELEASE_PROVISIONING_PROFILE"
elif [ -n "$framework_engine" ]; then
  [ -n "${ARDIACORE_FRAMEWORK:-}" ] || die "ARDIACORE_FRAMEWORK_ENGINE names the engine tree a prebuilt ARDIACORE_FRAMEWORK was built from; set both or neither"
  [ "$framework_engine" = "$(git -C "$root" rev-parse HEAD:engine)" ] \
    || die "ARDIACORE_FRAMEWORK_ENGINE is $framework_engine but HEAD's engine tree is $(git -C "$root" rev-parse HEAD:engine): that framework wasn't built from this commit's engine"
fi
if [ "$phase" = all ] && [ -z "${ARDIACORE_FRAMEWORK:-}" ]; then
  "$root/scripts/lib/engine-fresh.sh" "$framework_src" "$chromium_src" || exit 1
fi

identity_name="Developer ID Application"
notarize=0
if [ "$phase" != build ]; then
  identity="$(security find-identity -v -p codesigning | awk -v n="$identity_name" 'index($0, n) { print $2; exit }')"
  [ -n "$identity" ] || die "no $identity_name identity"
  if xcrun notarytool history "${notary_auth[@]}" >/dev/null 2>&1; then
    notarize=1
  elif [ "${ALLOW_UNNOTARIZED:-0}" = 1 ]; then
    echo "warning: no notarytool credentials; the build won't be notarized" >&2
  else
    echo "error: notarytool credentials are missing or invalid (scripts/.notary.env or the '$notary_profile' profile):" >&2
    xcrun notarytool history "${notary_auth[@]}" 2>&1 | head -2 >&2
    exit 1
  fi
fi

feed_base="${APPCAST_BASE:-$LATEST_DOWNLOAD_URL/appcast.xml}"
base_feed="$(mktemp "${TMPDIR:-/tmp}/ac-appcast.XXXXXX")"
trap 'rm -f "$base_feed"' EXIT
case "$feed_base" in
  none) : > "$base_feed" ;;
  http://* | https://*) curl -fsL "$feed_base" -o "$base_feed" || : > "$base_feed" ;;
  *) cp "$feed_base" "$base_feed" ;;
esac
if [ ! -s "$base_feed" ] && [ "$rc" = 0 ] && [ "$feed_base" != none ]; then
  die "couldn't read the published appcast ($feed_base): every release builds on it, or earlier versions and the other channel drop out of the feed"
fi
newest_listed=""
[ -s "$base_feed" ] && newest_listed="$(appcast newest-build "$base_feed")"
[ -z "$newest_listed" ] || [ "$release_build" -gt "$newest_listed" ] \
  || die "the build number ($release_build) must be above every build in the feed, nightly or stable (newest: $newest_listed): bump CURRENT_PROJECT_VERSION"

build_cli() {
  echo "==> ardia CLI"
  "$root/apps/cli/scripts/build.sh" "$version" "$dist" >"$dist/cli-build.log" 2>&1 \
    || { tail -20 "$dist/cli-build.log" >&2; die "building the ardia CLI failed ($dist/cli-build.log)"; }
}
cli_tarball="$dist/ardia-cli-$version-macos-arm64.tar.gz"
if [ "$phase" != sign ]; then
  rm -rf "$dist"
  mkdir -p "$dist"
  {
    echo "version $version, build $release_build, $channel${version_settings:+ (${version_settings[*]})}"
    echo "commit $(git -C "$root" rev-parse HEAD)${dirty:+ + uncommitted changes}"
    echo "framework $(plutil -extract SCMRevision raw "$framework_src/Versions/Current/Resources/Info.plist" 2>/dev/null)"
    echo "framework built $(stat -f '%Sm' "$framework_src/Versions/Current/Chromium Framework")"
  } > "$dist/provenance.txt"

  echo "==> Content blocker"
  "$ardiacore/scripts/ubo.sh"
  [ -f "$ardiacore/vendor/ubo/ext/manifest.json" ] || die "uBlock Origin isn't installed ($ardiacore/scripts/ubo.sh)"

  if [ -n "$provisioning_profile" ] || [ "$phase" = build ]; then
    archive_signing=(-xcconfig macos/AdHoc.xcconfig)
  else
    archive_signing=(-allowProvisioningUpdates)
  fi
  echo "==> Archive"
  (cd "$app_dir" && ARDIACORE_FRAMEWORK="$framework_src" "$root/scripts/agent/locked" pod --wait 1800 -- \
    "$root/scripts/agent/locked" xcodebuild --wait 1800 -- xcodebuild -workspace macos/Ardia.xcworkspace -scheme Ardia-macOS \
    -configuration Release -destination 'generic/platform=macOS' ARCHS=arm64 ARDIACORE_STAGE_DIR="$build/ArdiaCoreFramework" \
    ${version_settings[@]+"${version_settings[@]}"} AC_UPDATE_CHANNEL="$channel" \
    ${extra_build_settings[@]+"${extra_build_settings[@]}"} \
    -derivedDataPath "$build" -archivePath "$archive" "${archive_signing[@]}" archive) \
    > "$dist/archive.log" 2>&1 || {
    grep -E "error:|build commands failed" -A2 "$dist/archive.log" | grep -v MACOSX_DEPLOYMENT_TARGET | tail -20 >&2
    die "archive failed ($dist/archive.log)"
  }
fi
if [ "$phase" = sign ] && [ -n "$build_input" ]; then
  rm -rf "$dist"
  mkdir -p "$dist"
fi
if [ "$phase" = build ]; then
  build_cli
  echo
  echo "Built $archive (signed ad hoc) and $(basename "$cli_tarball"); sign it with --phase sign."
  exit 0
fi

sign() {
  local attempt
  for attempt in 1 2 3 4 5; do
    codesign --force --timestamp --sign "$identity" "$@" && return 0
    echo "    signing failed (attempt $attempt), likely no timestamp from Apple; retrying" >&2
    sleep 5
  done
  die "couldn't sign ${*: -1}"
}
grants_browser_passkeys() {
  security cms -D -i "$1" 2>/dev/null \
    | plutil -extract 'Entitlements.com\.apple\.developer\.web-browser\.public-key-credential' raw -o - - 2>/dev/null | grep -qx true
}
if [ -n "$provisioning_profile" ]; then
  app_entitlements="$macos/Ardia-macOS/Ardia.entitlements"
  grants_browser_passkeys "$provisioning_profile" && app_entitlements="$macos/Ardia-macOS/Ardia-ICloudPasskeys.entitlements"
  echo "==> Export (Developer ID, $(basename "$provisioning_profile"), $(basename "$app_entitlements"))"
  "$root/scripts/lib/export-developer-id.sh" "$archive/Products/Applications/Ardia.app" "$app" "$provisioning_profile" \
    "$app_entitlements" "$identity" com.ardia.browser > "$dist/export.log" 2>&1 || { cat "$dist/export.log" >&2; exit 1; }
else
  echo "==> Export (Developer ID)"
  for attempt in 1 2 3 4 5 6; do
    rm -rf "$dist/export"
    xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$macos/ExportOptions-DeveloperID.plist" \
      -exportPath "$dist/export" -allowProvisioningUpdates > "$dist/export.log" 2>&1 && break
    grep -q "A timestamp was expected" "$dist/export.log" && [ "$attempt" -lt 6 ] \
      || { cat "$dist/export.log" >&2; exit 1; }
    echo "    no timestamp from Apple (attempt $attempt), exporting again"
    sleep 10
  done
fi
[ "$(lipo -archs "$app/Contents/MacOS/Ardia")" = arm64 ] || die "the app's executable is $(lipo -archs "$app/Contents/MacOS/Ardia"), not arm64"

if [ "$phase" = all ]; then
  build_cli
else
  if [ -n "$build_input" ]; then
    for file in provenance.txt "$(basename "$cli_tarball")" "$(basename "$cli_tarball").sha256"; do
      [ -f "$build_input/$file" ] && [ ! -L "$build_input/$file" ] || die "no $file in $build_input"
      cp "$build_input/$file" "$dist/$file"
    done
  fi
  [ -f "$cli_tarball.sha256" ] || die "no $cli_tarball.sha256 from --phase build"
fi
awk '{ print $1 }' "$cli_tarball.sha256" >"$app/Contents/Resources/ardia-cli.sha256"

echo "==> Licenses"
licenses="$app/Contents/Resources/Licenses"
mkdir -p "$licenses"
cp "$root"/LICENSE* "$root/NOTICE" "$licenses/"

echo "==> Sign Chrome's framework"
entitlements_dir="$ardiacore/scripts/signing"
fw="$app/Contents/Frameworks/Chromium Framework.framework"
fwv="$(cd "$fw/Versions/Current" && pwd -P)" || die "no Chromium Framework.framework in the export"
"$ardiacore/scripts/strip-engine.sh" "$app" "$dist/symbols"
unpruned_engine="$dist/engine-unpruned"
rm -rf "$unpruned_engine" && mkdir -p "$unpruned_engine" && cp -cR "$fw" "$unpruned_engine/"
"$ardiacore/scripts/prune-bundle.sh" "$app"
for lib in "$fwv"/Libraries/*.dylib; do sign "$lib"; done
for helper in "$fwv"/Helpers/*.app; do
  case "$(basename "$helper")" in
    *"Renderer).app") sign --options restrict,kill,runtime --entitlements "$entitlements_dir/renderer.entitlements" "$helper" ;;
    *"GPU).app") sign --options restrict,kill,runtime --entitlements "$entitlements_dir/gpu.entitlements" "$helper" ;;
    *) sign --options restrict,library,kill,runtime "$helper" ;;
  esac
done
sign --options restrict,library,kill,runtime "$fwv/Helpers/chrome_crashpad_handler"
sign --options restrict,library,kill,runtime "$fwv/Helpers/app_mode_loader"
[ -e "$fwv/Helpers/web_app_shortcut_copier" ] && sign --options restrict,library,kill,runtime \
  --identifier com.ardia.browser.web_app_shortcut_copier "$fwv/Helpers/web_app_shortcut_copier"
sign "$fw"
[ -d "$app/Contents/Frameworks/hermes.framework" ] \
  && sign --preserve-metadata=identifier,entitlements,flags,runtime "$app/Contents/Frameworks/hermes.framework"
sign --preserve-metadata=entitlements,requirements,flags,runtime "$app"

echo "==> Verify"
codesign --verify --deep --strict "$app"
[ -d "$archive/dSYMs/Ardia.app.dSYM" ] || die "the archive has no Ardia.app.dSYM"
entitlements() { codesign -d --entitlements - --xml "$1" 2>/dev/null; }
info() { plutil -extract "$1" raw "$app/Contents/Info.plist" 2>/dev/null; }
[ "$(info CFBundleIdentifier)" = com.ardia.browser ] || die "bundle id is $(info CFBundleIdentifier)"
[ "$(info CFBundleExecutable)" = Ardia ] || die "executable is $(info CFBundleExecutable)"
[ "$(info CFBundleShortVersionString)" = "$version" ] || die "CFBundleShortVersionString is $(info CFBundleShortVersionString)"
[ "$(info CFBundleVersion)" = "$release_build" ] || die "CFBundleVersion is $(info CFBundleVersion), not $release_build"
[ "$(info ACUpdateChannel)" = "$channel" ] || die "ACUpdateChannel is '$(info ACUpdateChannel)', not $channel"
for key in SUFeedURL SUPublicEDKey NSDockTilePlugIn NSCameraUsageDescription NSMicrophoneUsageDescription \
  NSBluetoothAlwaysUsageDescription NSLocationUsageDescription NSLocalNetworkUsageDescription; do
  [ -n "$(info "$key")" ] || die "Info.plist has no $key"
done
[ -d "$app/Contents/Frameworks/Sparkle.framework" ] || die "no Sparkle.framework"
[ -d "$app/Contents/PlugIns/ArdiaDockTile.plugin" ] || die "no dock tile plug-in"
[ -f "$app/Contents/embedded.provisionprofile" ] || die "no Developer ID provisioning profile (keychain groups need it)"
[ -f "$app/Contents/Resources/Extensions/ublock/manifest.json" ] || die "no uBlock Origin in the app"
for file in "$root"/LICENSE* "$root/NOTICE"; do
  cmp -s "$file" "$app/Contents/Resources/Licenses/$(basename "$file")" || die "the app lacks $(basename "$file") in Contents/Resources/Licenses"
done
designated="$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')"
[[ "$designated" == *'identifier "com.ardia.browser"'* && "$designated" == *"subject.OU] = U5L5T3NGVV"* ]] \
  || die "designated requirement: $designated"
app_ents="$(entitlements "$app")"
for group in webauthn unexportable-keys secure-payment-confirmation; do
  [[ "$app_ents" == *"U5L5T3NGVV.com.ardia.browser.$group"* ]] || die "the app lacks the keychain group …$group"
done
if grants_browser_passkeys "$app/Contents/embedded.provisionprofile"; then
  [[ "$app_ents" == *web-browser.public-key-credential* ]] || die "the profile grants browser passkeys but the app isn't signed with them"
else
  [[ "$app_ents" != *web-browser.public-key-credential* ]] || die "the app is signed with com.apple.developer.web-browser.public-key-credential, which its profile doesn't grant"
fi
for helper in "$fwv"/Helpers/*"Renderer).app" "$fwv"/Helpers/*"GPU).app"; do
  [[ "$(entitlements "$helper")" == *cs.allow-jit* ]] || die "$(basename "$helper") lost allow-jit"
done
while IFS= read -r -d '' code; do
  details="$(codesign -dvv "$code" 2>&1)"
  [[ "$details" == *"TeamIdentifier=U5L5T3NGVV"* && "$details" == *"Authority=Developer ID Application"* \
    && "$details" == *"Timestamp="* ]] || die "$code isn't Developer ID-signed with a timestamp"
  [[ "$(entitlements "$code")" != *get-task-allow* ]] || die "$code has get-task-allow"
done < <(find "$app" \( -name "*.app" -o -name "*.framework" -o -name "*.dylib" -o -name "*.xpc" -o -name "*.plugin" \
  -o -path "*/Helpers/*" -type f -perm -u+x -o -path "*/MacOS/*" -type f \) -print0)

engine_tree="$(git -C "$root" rev-parse HEAD:engine)"
engine_archive="$dist/ArdiaCore-${engine_tree:0:12}.tar.xz"
engine_source="$dist/ArdiaCore-${engine_tree:0:12}-source.tar.xz"
engine_release="$(awk -v t="$engine_tree" '$1 == t { print $2; exit }' "$ardiacore/prebuilt-engines.tsv")"
helium_engine=""
LC_ALL=C grep -q -a -F helium.services.enabled "$framework_src/Versions/Current/Chromium Framework" && helium_engine=1
engine_pack=""
if [ "$phase" = all ] && [ "$rc" = 0 ] && { [ -z "${ARDIACORE_FRAMEWORK:-}" ] || [ -n "$framework_engine" ]; } && [ -z "$engine_release" ]; then
  engine_release="$version"
  echo "==> Pack the engine (background)"
  (
    set -e
    [ -z "$helium_engine" ] || "$root/scripts/engine-source.sh" "$version" "$engine_source"
    if command -v xz >/dev/null; then
      tar --no-mac-metadata -cf - -C "$unpruned_engine" "Chromium Framework.framework" | xz -T0 -9 >"$engine_archive"
    else
      tar --no-mac-metadata -cJf "$engine_archive" -C "$unpruned_engine" "Chromium Framework.framework"
    fi
    rm -rf "$unpruned_engine"
    printf '%s\t%s\t%s\n' "$engine_tree" "$version" "$(shasum -a 256 "$engine_archive" | awk '{ print $1 }')" \
      >"$dist/prebuilt-engine.tsv"
  ) >"$dist/engine-pack.log" 2>&1 &
  engine_pack=$!
else
  rm -rf "$unpruned_engine"
fi
[ -z "$helium_engine" ] || [ "$rc" = 1 ] || [ -n "$engine_release" ] \
  || die "no published release carries this engine ($engine_tree) and its source: build it from the Chromium tree, without ARDIACORE_FRAMEWORK, or name the engine tree it was built from in ARDIACORE_FRAMEWORK_ENGINE"

[ "$phase" = sign ] || launch_check

notarize_file() {
  echo "Notarizing $(basename "$1")"
  local log="$dist/notary-$(basename "$1").log" id tries=0
  xcrun notarytool submit "$1" "${notary_auth[@]}" | tee "$log" || true
  id="$(awk '$1 == "id:" { print $2; exit }' "$log")"
  [ -n "$id" ] || die "notarytool returned no submission id"
  until xcrun notarytool wait "$id" "${notary_auth[@]}" --timeout 1h | tee -a "$log" | grep -q "status: Accepted"; do
    grep -Eq "status: (Invalid|Rejected)" "$log" && die "notarization failed: xcrun notarytool log $id"
    tries=$((tries + 1))
    [ "$tries" -lt 5 ] || die "notarytool kept failing while waiting on $id"
    echo "notarytool wait failed; asking again ($tries/5)"
    sleep 20
  done
}
if [ "$notarize" = 1 ]; then
  echo "==> Notarize app"
  ditto -c -k --keepParent "$app" "$dist/notarize.zip"
  notarize_file "$dist/notarize.zip"
  rm "$dist/notarize.zip"
  xcrun stapler staple "$app"
fi

echo "==> Package"
legacy_app="$("$root/scripts/lib/legacy-name.sh" appFileName)"
update_dir="$dist/update"
rm -rf "$update_dir" && mkdir -p "$update_dir"
ditto "$app" "$update_dir/$legacy_app"
ditto -c -k --keepParent "$update_dir/$legacy_app" "$zip"
rm -rf "$update_dir"
staging="$dist/dmg"
mkdir -p "$staging"
ditto "$app" "$staging/Ardia.app"
ln -s /Applications "$staging/Applications"
cp "$root/scripts/dmg/background.tiff" "$staging/.background.tiff"
cp "$root/scripts/dmg/DS_Store" "$staging/.DS_Store"
cp "$app/Contents/Resources/AppIcon.icns" "$staging/.VolumeIcon.icns"
mkdir -p "$staging/.fseventsd" && touch "$staging/.fseventsd/no_log"
dmg_rw="$dist/dmg-rw.dmg" dmg_mnt="$dist/dmg-mnt"
rm -rf "$dmg_rw" "$dmg_mnt" && mkdir "$dmg_mnt"
hdiutil create -volname Ardia -srcfolder "$staging" -format UDRW -ov "$dmg_rw" >/dev/null
rm -rf "$staging"
hdiutil attach "$dmg_rw" -nobrowse -noautoopen -noverify -mountpoint "$dmg_mnt" >/dev/null
SetFile -a C "$dmg_mnt" || { hdiutil detach "$dmg_mnt" -force >/dev/null; die "couldn't flag the volume's icon"; }
for attempt in 1 2 3 4 5; do
  hdiutil detach "$dmg_mnt" >/dev/null 2>&1 && break
  [ "$attempt" = 5 ] && { hdiutil detach "$dmg_mnt" -force >/dev/null || die "couldn't eject $dmg_mnt"; }
  sleep 2
done
dmg_chunks=(-imagekey udif-chunk-size=8192)
[ "${ARDIA_DMG_CHUNK:-on}" = off ] && dmg_chunks=()
hdiutil convert "$dmg_rw" -format ULMO ${dmg_chunks[@]+"${dmg_chunks[@]}"} -ov -o "$dmg" >/dev/null
rm -rf "$dmg_rw" "$dmg_mnt"
sign "$dmg"
if [ "$notarize" = 1 ]; then
  notarize_file "$dmg"
  xcrun stapler staple "$dmg"
fi

echo "==> Release notes"
if [ "$channel" = nightly ]; then
  updates_line="A nightly: every fix the day it lands, tested less than a stable release. It updates to newer nightlies and stables (Ardia › Check for Updates…); Settings › General › Update channel switches back to Stable, which never downgrades. Every release's notes: $notes_page"
else
  updates_line="Earlier versions update automatically (Ardia › Check for Updates…). Every release's notes: $notes_page"
fi
if [ "$notarize" = 1 ]; then
  install_line="Apple Silicon, macOS $min_macos or later. Signed with Developer ID and notarized by Apple: download, drag it to Applications, open it."
else
  install_line="Apple Silicon, macOS $min_macos or later. Signed with Developer ID but not notarized: on first launch macOS refuses to open it. Click Done, then System Settings › Privacy & Security › Open Anyway. Or run \`xattr -dr com.apple.quarantine /Applications/Ardia.app\`."
fi
case "$engine_release" in engine-*) engine_tag="$engine_release" ;; *) engine_tag="v$engine_release" ;; esac
source_line="This build's source, with the engine's patches and build scripts: $REPO_URL/tree/v$version (LICENSE and NOTICE there cover the licenses)."
[ -n "$helium_engine" ] && [ -n "$engine_release" ] && source_line="$source_line The engine's Helium and uBlock sources as built, and where Chromium's is: $REPO_URL/releases/download/$engine_tag/$(basename "$engine_source")"
{
  notes_body
  [ -n "${notes_video:-}" ] && printf '\n## Before and after\n\nThe fixes, filmed on the previous release and on this one: %s\n' "${notes_page%/release-notes}/release-videos/$notes_video.mp4"
  cat <<EOF

## Install

$install_line

$updates_line

## Source

$source_line
EOF
} > "$dist/release-notes.md"

echo "==> Appcast"
updates="$dist/updates"
mkdir -p "$updates"
cp "$zip" "$updates/"
{ printf '**%s**\n\n' "$headline"; notes_body; } > "$updates/Ardia-$version.md"
[ -s "$base_feed" ] && cp "$base_feed" "$updates/appcast.xml"
if [ -n "$sparkle_key_file" ]; then
  key="$sparkle_key_file"
else
  key="$(mktemp -d)/sparkle-key"
  trap 'rm -rf "$(dirname "$key")" "$base_feed"' EXIT
  "$sparkle/generate_keys" --account "$sparkle_account" -x "$key" >/dev/null
fi
phased_args=()
[ -n "$phased" ] && phased_args=(--phased-rollout-interval "$phased")
[ "$channel" = nightly ] && phased_args+=(--channel nightly)
"$sparkle/generate_appcast" --ed-key-file "$key" ${phased_args[@]+"${phased_args[@]}"} \
  --download-url-prefix "$REPO_URL/releases/download/v$version/" \
  --embed-release-notes --full-release-notes-url "$notes_page" \
  --link "$REPO_URL" -o "$updates/appcast.xml" "$updates"
mv "$updates/appcast.xml" "$dist/appcast.xml"
appcast item "$dist/appcast.xml" "$version" >/dev/null || die "appcast.xml has no single item for $version"
rm -rf "$updates"

engine_files=()
if [ -n "$engine_pack" ]; then
  wait "$engine_pack" || { cat "$dist/engine-pack.log" >&2; die "packing the engine failed ($dist/engine-pack.log)"; }
  rm -f "$dist/engine-pack.log"
  engine_files=("$engine_archive" "$dist/prebuilt-engine.tsv")
  [ -z "$helium_engine" ] || engine_files+=("$engine_source")
fi

echo
[ "$notarize" = 1 ] && echo "Notarized and stapled." || echo "NOT notarized."
[ -n "$engine_pack" ] && echo "New engine: publish $(basename "$engine_archive")${helium_engine:+ and $(basename "$engine_source")} with the release, then add prebuilt-engine.tsv's line to packages/ardiacore/prebuilt-engines.tsv."
[ "$rc" = 1 ] && echo "Release candidate: never publish dist/$version-rc."
[ "$channel" = nightly ] && [ "$rc" = 0 ] && echo "Nightly: publish it with .claude/skills/release/scripts/publish.sh $version (a prerelease; the feed and ardia.dev/nightly follow)."
[ "$phase" = sign ] && echo "Not launched yet: remove the signing keys, then run the launch check (--phase check)."
[ -n "$phased" ] && echo "Phased rollout: $phased s between steps (the appcast item has phasedRolloutInterval; the whole release takes $((phased * 7)) s)."
du -sh "$app" "$dmg" "$zip" "$cli_tarball" "$dist/appcast.xml" "$dist/release-notes.md" ${engine_files[@]+"${engine_files[@]}"}
