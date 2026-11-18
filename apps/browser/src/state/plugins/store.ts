import { create } from "zustand";
import type { PluginManifest } from "../../lib/pluginManifest";

export type PluginListing = {
  name: string;
  manifest: PluginManifest | null;
  problems: string[];
  hash: string | null;
  folderId: string;
};

export type ProcessState =
  | { state: "starting" | "running"; run: number; since: number }
  | { state: "waiting"; until: number; failures: number }
  | { state: "crashed"; reason: string }
  | { state: "exited" }
  | { state: "failed"; reason: string };

export type PluginRecord = {
  enabled: boolean;
  approved: string | null;
  values: Record<string, string | boolean>;
  applied: Record<string, { value: unknown; previous: unknown; order: number; over: string | null }>;
};

export type PluginsStore = {
  loaded: boolean;
  listings: Record<string, PluginListing>;
  order: string[];
  records: Record<string, PluginRecord>;
  processes: Record<string, ProcessState>;
  consent: { name: string; hash: string } | null;
};

export const usePlugins = create<PluginsStore>()(() => ({
  loaded: false,
  listings: {},
  order: [],
  records: {},
  processes: {},
  consent: null,
}));

export const NO_RECORD: PluginRecord = { enabled: false, approved: null, values: {}, applied: {} };

const ownRecord = (s: Pick<PluginsStore, "records">, name: string): PluginRecord | undefined => (Object.hasOwn(s.records, name) ? s.records[name] : undefined);

export const recordOf = (s: Pick<PluginsStore, "records">, name: string): PluginRecord => ownRecord(s, name) ?? NO_RECORD;

export function activeManifest(s: Pick<PluginsStore, "listings" | "records">, name: string): PluginManifest | null {
  const listing = Object.hasOwn(s.listings, name) ? s.listings[name] : undefined;
  const record = ownRecord(s, name);
  if (!listing?.manifest || !listing.hash || !record?.enabled || record.approved !== listing.hash) return null;
  return listing.manifest;
}

export const activeNames = (s: Pick<PluginsStore, "listings" | "records" | "order">) => s.order.filter((name) => activeManifest(s, name));

export function needsReview(s: Pick<PluginsStore, "listings" | "records">, name: string): boolean {
  const listing = Object.hasOwn(s.listings, name) ? s.listings[name] : undefined;
  const record = ownRecord(s, name);
  return !!record?.enabled && !!listing?.hash && record.approved !== listing.hash;
}

export const currentPlugins = () => usePlugins.getState();
