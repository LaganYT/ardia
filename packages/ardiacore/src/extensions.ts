import type { ExtensionSearchEngine } from "@ardia/core";
import { call, on } from "./engine/call";

export type SiteAccess = "ON_ALL_SITES" | "ON_SPECIFIC_SITES" | "ON_CLICK";

export type InstalledExtension = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  state: "ENABLED" | "DISABLED" | "TERMINATED" | "BLOCKLISTED";
  icon: string;
  permissions: string[];
  siteAccess: SiteAccess | null;
  sites: string[];
  optionsUrl: string | null;
  pinned: boolean;
  incognito: boolean;
  incognitoSplit?: boolean;
  fileAccess: boolean;
  userScriptsAvailable?: boolean;
  userScripts?: boolean;
  mayModify: boolean;
  blockedByPolicy?: boolean;
  errors: string[];
  location: string;
  path: string | null;
  fromWebStore: boolean;
  webStoreUrl: string | null;
  homepageUrl: string | null;
  hasAction?: boolean;
  popup?: string | null;
  actionTitle?: string | null;
  actionIcon?: string | null;
  sidePanel?: string | null;
};

export type ExtensionPackage = {
  id?: string;
  name: string;
  shortName?: string | null;
  version: string;
  description: string;
  manifestVersion: number;
  icon: string | null;
  permissions: string[];
  optionalPermissions: string[];
  hostPermissions: string[];
  hasAction: boolean;
  popup: string | null;
  optionsPage: string | null;
  sidePanel: string | null;
  path: string;
};

export type ActionState = {
  badgeText: string;
  badgeColor: string | null;
  badgeTextColor: string | null;
  title: string;
  popup: string;
  enabled: boolean;
  icon: string;
};

export type ExtensionsChange = {
  profile: string;
  id: string;
  event: "installed" | "uninstalled" | "enabled" | "disabled" | "configured" | "reloaded";
};

export type TabsRequest = {
  action: "open" | "closeWindow";
  profile: string;
  extensionId: string;
  window: string | null;
  url: string;
  active?: boolean;
  adoptId?: string;
  chromeWindow?: string;
  focused?: boolean;
  tabId?: string;
};

export type ExtensionInstallPrompt = {
  requestId: string;
  profile: string;
  id: string;
  name: string;
  version: string;
  type: "install" | "re-enable" | "permissions" | "external" | "remote" | "repair" | "other";
  icon: string;
  permissions: string[];
  tabId: string | null;
};

export type ChromeSearchEngine = {
  name: string;
  keyword: string;
  url: string;
  suggestionsUrl: string;
  default: boolean;
  isOmniboxExtension: boolean;
  extension?: { id: string; name: string };
};

const withoutPlaceholders = (url: string) => url.replace(/\{[^{}%]*\}/g, "");

export async function extensionSearchEngines(profile: string): Promise<ExtensionSearchEngine[]> {
  const { list } = await call("search.engines", { profile });
  const engines: ExtensionSearchEngine[] = [];
  for (const e of list.engines) {
    const extension = e.extension;
    if (!extension || e.isOmniboxExtension || !e.url.includes("%s") || engines.some((o) => o.extensionId === extension.id)) continue;
    engines.push({
      profile,
      extensionId: extension.id,
      extensionName: extension.name,
      name: e.name || extension.name,
      keyword: e.keyword,
      url: withoutPlaceholders(e.url),
      suggestUrl: e.suggestionsUrl.includes("%s") ? withoutPlaceholders(e.suggestionsUrl) : undefined,
      isDefault: e.default,
    });
  }
  return engines;
}

export async function listExtensions(profile: string): Promise<InstalledExtension[]> {
  return (await call("extensions.list", { profile })).extensions;
}

export const inspectUnpackedExtension = (path: string): Promise<ExtensionPackage> => call("extensions.inspectUnpacked", { path });

export async function installExtension(pkg: Pick<ExtensionPackage, "path">, profile: string): Promise<string> {
  return (await call("extensions.install", { profile, path: pkg.path })).id;
}

export async function setExtensionEnabled(id: string, profile: string, enabled: boolean) {
  await call("extensions.setEnabled", { profile, id, enabled });
}

export async function uninstallExtension(id: string, profile: string) {
  await call("extensions.uninstall", { profile, id });
}

export async function reloadExtension(id: string, profile: string) {
  await call("extensions.reload", { profile, id });
}

export async function configureExtension(
  id: string,
  profile: string,
  options: {
    pinned?: boolean;
    incognito?: boolean;
    fileAccess?: boolean;
    userScripts?: boolean;
    siteAccess?: "allSites" | "specificSites" | "onClick";
  },
) {
  await call("extensions.configure", { profile, id, options });
}

export async function extensionActionStates(tabId: string, ids: string[]): Promise<Record<string, ActionState>> {
  if (!ids.length) return {};
  return call("extensions.actionStates", { tabId, ids });
}

export const onExtensionsChanged = (listener: (e: ExtensionsChange) => void) => on("extensions.changed", listener);

export const watchExtensionActions = (profile: string) => call("extensions.watchActions", { profile });

export type ExtensionActionChange = { profile: string; id: string; kind: "action" | "sidePanel" | "registry" };

export const onExtensionActionChanged = (listener: (e: ExtensionActionChange) => void) => on("extensions.action", listener);
export const onExtensionInstallPrompt = (listener: (e: ExtensionInstallPrompt) => void) => on("extensions.installPrompt", listener);
export const onExtensionInstallFailed = (listener: (e: { message: string; tabId: string | null }) => void) => on("extensions.installFailed", listener);
export const resolveExtensionInstallPrompt = (requestId: string, accepted: boolean) => call("extensions.resolveInstallPrompt", { requestId, accepted });
export const onExtensionTabsRequest = (listener: (e: TabsRequest) => void) => on("extensions.tabs", listener);
export type ExtensionSyncIntent = { id: string; kind: "installed" | "uninstalled" };

export type SyncedExtension =
  | { id: string; syncable: false }
  | {
      id: string;
      syncable: true;
      version: string;
      approved: boolean;
      fingerprint: string;
      enabled: boolean;
      userDisabled: boolean;
      incognito: boolean;
      pinned: boolean;
    };

export type ExtensionsSyncState = {
  ready: boolean;
  extensions: SyncedExtension[];
  pending: string[];
  settling: string[];
  queued: string[];
  intents: ExtensionSyncIntent[];
};

export type ExtensionsSyncApply = {
  id: string;
  record: { on: boolean; inc: boolean; pin: boolean } | { removed: true };
  approval?: { v: string; fps: string[] };
};

export type ExtensionsSyncApplied = {
  state: "invalid" | "kept" | "absent" | "cancelled" | "blocked" | "pending" | "refused" | "updating" | "installed";
};

export const onExtensionsSync = (listener: (p: { profile: string } & ExtensionSyncIntent) => void) => on("extensions.sync", listener);
export const extensionsSyncState = (profile: string) => call("extensions.syncState", { profile });
export const applyExtensionsSync = (profile: string, apply: ExtensionsSyncApply) => call("extensions.syncApply", { ...apply, profile });

export const chooseExtensionFolder = () => call("extensions.chooseFolder");

export const installExtensionCrx = (path: string, profile: string) => call("extensions.installCrx", { profile, path });
