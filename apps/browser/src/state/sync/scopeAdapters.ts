import { SyncNative, type Adapter, type ExtensionsAdapter } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { bookmarksAdapter, deviceAdapter, deviceTabsAdapter, historyAdapter, inTodaysNames, passwordsAdapter, sharedDataAdapter } from "./adapters";
import { profilesAdapter, profileThemesAdapter } from "./profileAdapters";
import { settingsAdapter } from "./settingsAdapter";
import { pinnedAreaAdapters } from "./pinned";
import { extensionsAdapterFor } from "./extensions";
import { APP_SCOPE, type SyncDoc } from "./syncDoc";

export const deviceName = () => SyncNative?.deviceName() ?? "This Mac";

const passwordAdapters = new Map<string, Adapter>();
const extensionAdapters = new Map<string, ExtensionsAdapter>();

export function forgetScopeAdapters() {
  passwordAdapters.clear();
  extensionAdapters.clear();
}

const ownsSyncedData = (profileId: string) => !useBrowser.getState().profiles[profileId]?.dataId;

export const extensionsSynced = (doc: SyncDoc, profileId: string) => doc.types.extensions && ownsSyncedData(profileId);

export function extensionsOf(profileId: string): ExtensionsAdapter {
  let adapter = extensionAdapters.get(profileId);
  if (!adapter) extensionAdapters.set(profileId, (adapter = extensionsAdapterFor(profileId)));
  return adapter;
}

export function appAdapters(doc: SyncDoc, retiring: boolean, themeAdopted: (profileId: string) => void): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceAdapter(id, deviceName, true)];
  const enabledLinks = () => Object.fromEntries(Object.entries(doc.profiles).filter(([, l]) => l.enabled));
  return [
    ...(doc.types.settings ? [inTodaysNames(settingsAdapter)] : []),
    sharedDataAdapter(() => doc.profiles),
    profilesAdapter(enabledLinks),
    profileThemesAdapter(enabledLinks, () => doc.scopes[APP_SCOPE]?.records, themeAdopted),
    deviceAdapter(id, deviceName),
  ];
}

export function profileAdapters(doc: SyncDoc, profileId: string, retiring: boolean, forcePasswords: () => boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceTabsAdapter(profileId, id, deviceName, true)];
  const ownsData = ownsSyncedData(profileId);
  const t = doc.types;
  let passwords = passwordAdapters.get(profileId);
  if (!passwords) passwordAdapters.set(profileId, (passwords = passwordsAdapter(profileId, forcePasswords)));
  return [
    ...(t.pinned ? pinnedAreaAdapters(profileId) : []),
    ...(t.bookmarks && ownsData ? [inTodaysNames(bookmarksAdapter(profileId))] : []),
    ...(t.history && ownsData ? [inTodaysNames(historyAdapter(profileId))] : []),
    inTodaysNames(deviceTabsAdapter(profileId, id, deviceName, !t.tabs)),
    ...(t.passwords && ownsData ? [passwords] : []),
    ...(extensionsSynced(doc, profileId) ? [extensionsOf(profileId)] : []),
  ];
}
