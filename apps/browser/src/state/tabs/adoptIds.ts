import type { Tab } from "../browser/types";

export type AdoptKind = "restore" | "clone" | "tab" | "ardiacore" | "webkit" | "link";
export type AdoptId = `${AdoptKind}:${string}`;

const KINDS: readonly AdoptKind[] = ["restore", "clone", "tab", "ardiacore", "webkit", "link"];

export const restoreId = (tabId: string): AdoptId => `restore:${tabId}`;
export const cloneId = (tabId: string): AdoptId => `clone:${tabId}`;

export function adoptKind(id: string | undefined): { kind: AdoptKind; key: string } | null {
  const colon = id?.indexOf(":") ?? -1;
  if (!id || colon < 0) return null;
  const kind = id.slice(0, colon) as AdoptKind;
  return KINDS.includes(kind) ? { kind, key: id.slice(colon + 1) } : null;
}

export const isAdoptKind = (id: string | undefined, kind: AdoptKind) => adoptKind(id)?.kind === kind;

export function pendingRestore(t: Pick<Tab, "wakeAdoptId">): string | undefined {
  const id = adoptKind(t.wakeAdoptId);
  return id?.kind === "restore" ? id.key : undefined;
}
