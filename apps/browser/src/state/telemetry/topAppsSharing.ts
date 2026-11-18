import type { BrowserState } from "../browser/store";
import { capture } from "./client";
import { onTelemetryRelay } from "./relay";

type Counts = Record<string, number | boolean | string | null>;

export type TopAppsSharingPath = "synced_record" | "link_profiles" | "linked_profile_created";

const MAX_HELD = 16;
const held: [string, Counts][] = [];
let dropped = 0;
let released = false;
let savedMerged: string | null = null;

export function noteTopAppsSharing(event: string, counts: Counts) {
  if (released) capture(event, counts);
  else if (held.length < MAX_HELD) held.push([event, counts]);
  else dropped++;
}

export function releaseTopAppsSharing() {
  released = true;
  for (const [event, counts] of held.splice(0)) capture(event, counts);
  if (dropped) capture("top_apps_sharing_dropped", { dropped });
  dropped = 0;
}

onTelemetryRelay(releaseTopAppsSharing);

let syncStarted = 0;

export function startedBySync<T>(apply: () => T): T {
  syncStarted++;
  try {
    return apply();
  } finally {
    syncStarted--;
  }
}

export const sharingStartedBySync = () => syncStarted > 0;

export const noteSavedTopAppsMerged = (marker: string) => void (savedMerged = marker);

export function topAppsSharingCounts(s: Pick<BrowserState, "profiles">) {
  const profiles = Object.values(s.profiles);
  return { profile_count: profiles.length, sharing_profiles: profiles.filter((p) => p.shareTopApps).length };
}

export function topAppsSharingAtLaunch(s: Pick<BrowserState, "profiles" | "topAppsMerged">, updatedFrom: string | null) {
  const saved = savedMerged ?? s.topAppsMerged;
  const settled = s.topAppsMerged;
  return {
    ...topAppsSharingCounts(s),
    merge_recorded: saved !== "",
    merge_recorded_this_launch: settled !== "" && saved !== settled,
    merge_marker_cleared: saved !== "" && settled === "",
    from_version: updatedFrom,
  };
}

export function noteTopAppsSharingFromSync(s: Pick<BrowserState, "profiles">, path: TopAppsSharingPath, on: boolean) {
  noteTopAppsSharing("top_apps_sharing_synced", { path, on, ...topAppsSharingCounts(s) });
}
