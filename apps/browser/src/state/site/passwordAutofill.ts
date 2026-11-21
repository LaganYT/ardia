import { getPasswordAutofill, setPasswordAutofill } from "../../platform/passwords";
import { readDocument, saveDocument } from "../../platform/documents";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { isFields } from "../../lib/decode";
import { resource, store as storeResource } from "../settings/resources";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile } from "../browser/model";
import { consentToken, type ConsentToken } from "../telemetry/choice";
import { warnFor } from "../telemetry/consoleConsent";
import { noteOfferToSaveRestore, noteProfilesMovedBack } from "../telemetry/retiredPasswordManagerCounts";
import { readPluginRecords } from "../plugins/savedState";

export const passwordAutofill = resource("passwordAutofill", (profile: string) => getPasswordAutofill(profile).catch(() => true));

export const HELD_OFF_DOCUMENT = "password-manager.json";
const HELD_OFF_VERSION = 1;
const HELD_OFF_MIGRATIONS: Migrations = { 0: unchanged };
export const ARDIA_PASSWORD_MANAGER = "ardia";

type Record_ = { heldOff: string[]; restored: string[]; readable: boolean };

const strings = (list: unknown) => (Array.isArray(list) ? [...new Set(list.filter((p): p is string => typeof p === "string"))].sort() : []);

let unsaved: string | null = null;
let lastSaved: string | null = null;

function savedText(): string | null {
  const raw = readDocument(HELD_OFF_DOCUMENT);
  if (unsaved !== null && raw === unsaved) return lastSaved;
  unsaved = null;
  return (lastSaved = raw);
}

function readRecord(): Record_ {
  const raw = savedText();
  if (!raw) return { heldOff: [], restored: [], readable: true };
  try {
    const doc: unknown = JSON.parse(raw);
    if (isFields(doc) && typeof doc.version === "number" && doc.version > HELD_OFF_VERSION) return { heldOff: [], restored: [], readable: false };
  } catch {
    return { heldOff: [], restored: [], readable: true };
  }
  const doc = parseSaved(raw, HELD_OFF_VERSION, HELD_OFF_MIGRATIONS);
  return { heldOff: strings(doc?.offerToSaveHeldOff), restored: strings(doc?.offerToSaveRestored), readable: true };
}

let writes: Promise<unknown> = Promise.resolve();

function updateRecord(change: (r: Record_) => Record_): Promise<boolean> {
  const write = writes.then(async () => {
    const before = readRecord();
    if (!before.readable) return false;
    const next = change(before);
    const heldOff = strings(next.heldOff);
    const restored = strings(next.restored.filter((p) => heldOff.includes(p)));
    if (JSON.stringify([heldOff, restored]) === JSON.stringify([before.heldOff, before.restored])) return true;
    const contents = versionedJson({ offerToSaveHeldOff: heldOff, ...(restored.length ? { offerToSaveRestored: restored } : {}) }, HELD_OFF_VERSION);
    try {
      await saveDocument(HELD_OFF_DOCUMENT, contents);
    } catch {
      unsaved = contents;
      return false;
    }
    if (readDocument(HELD_OFF_DOCUMENT) !== contents) return false;
    unsaved = null;
    lastSaved = contents;
    return true;
  });
  const landed = write.catch(() => false);
  writes = landed;
  return landed;
}

const dropFromRecord = (profile: string) => updateRecord((r) => ({ ...r, heldOff: r.heldOff.filter((p) => p !== profile), restored: r.restored.filter((p) => p !== profile) }));

const queues = new Map<string, Promise<unknown>>();

function onProfile<T>(profile: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(profile) ?? Promise.resolve()).then(run, run);
  queues.set(profile, next.catch(() => {}));
  return next;
}

const touchedByUser = new Set<string>();
const writtenThisLaunch = new Set<string>();
const verifiedThisLaunch = new Set<string>();

export function changeOfferToSave(profile: string, on: boolean, write: () => Promise<boolean>): Promise<boolean> {
  return onProfile(profile, async () => {
    if (on) {
      if (!(await write())) return false;
      writtenThisLaunch.add(profile);
      verifiedThisLaunch.add(profile);
      await updateRecord((r) => (r.heldOff.includes(profile) ? { ...r, restored: [...r.restored, profile] } : r));
      return true;
    }
    if (!(await dropFromRecord(profile))) return false;
    touchedByUser.add(profile);
    return write();
  });
}


const liveEngineProfiles = (s: Pick<BrowserState, "profiles">) => new Set(Object.keys(s.profiles).filter((id) => s.profiles[id]).map((id) => engineProfile(s, id)));

function keepArdiaChoice(stampUnset: boolean): number {
  const profiles = useBrowser.getState().profiles as Record<string, ({ passwordManager?: unknown } & object) | undefined>;
  const stale = Object.entries(profiles).filter(([, p]) => p && p.passwordManager !== ARDIA_PASSWORD_MANAGER && (stampUnset || p.passwordManager !== undefined));
  if (!stale.length) return 0;
  const moved = stale.filter(([, p]) => p!.passwordManager !== undefined).length;
  useBrowser.setState((s) => {
    const next = { ...s.profiles };
    for (const [id] of stale) if (next[id]) next[id] = { ...next[id]!, passwordManager: ARDIA_PASSWORD_MANAGER };
    return { profiles: next };
  });
  return moved;
}

type Step = "confirmed" | "set" | "skipped" | "failed";

async function restoreOne(profile: string, alreadySet: boolean): Promise<Step> {
  if (touchedByUser.has(profile)) return "skipped";
  if (alreadySet && verifiedThisLaunch.has(profile)) return "set";
  if (alreadySet && !writtenThisLaunch.has(profile)) {
    const now = await getPasswordAutofill(profile).then((v) => v === true, () => null);
    if (now === true) {
      storeResource(passwordAutofill, [profile], true);
      return (await dropFromRecord(profile)) ? "confirmed" : "failed";
    }
    if (now === null) return "failed";
  }
  writtenThisLaunch.add(profile);
  const wrote = await setPasswordAutofill(true, profile).then(() => true, () => false);
  if (!wrote) return "failed";
  const after = await getPasswordAutofill(profile).then((v) => v === true, () => false);
  if (!after) return "failed";
  verifiedThisLaunch.add(profile);
  storeResource(passwordAutofill, [profile], true);
  return (await updateRecord((r) => ({ ...r, restored: [...r.restored, profile] }))) ? "set" : "failed";
}

export const RESTORE_RETRY = { firstMs: 30_000, tries: 5 };

async function restoreHeldOff(consent: ConsentToken | null, tries: number, delay: number): Promise<void> {
  const record = readRecord();
  if (!record.readable) return warnFor(consent, `[passwords] ${HELD_OFF_DOCUMENT} is from a newer Ardia, so offer to save is left as it is`);
  const live = liveEngineProfiles(useBrowser.getState());
  let failed = false;
  for (const profile of record.heldOff) {
    if (!live.has(profile)) {
      if (!(await dropFromRecord(profile))) failed = true;
      continue;
    }
    const step = await onProfile(profile, () => restoreOne(profile, record.restored.includes(profile)).catch((): Step => "failed"));
    if (step === "confirmed") noteOfferToSaveRestore(true, consent);
    if (step === "failed") {
      noteOfferToSaveRestore(false, consent);
      failed = true;
    }
  }
  if (!failed || tries <= 1) return;
  const retry: unknown = setTimeout(() => void restoreHeldOff(consent, tries - 1, delay * 2), delay);
  (retry as { unref?: () => void }).unref?.();
}

let started: Promise<void> | null = null;

const RETIRED_MANAGER_PLUGIN = "apple-passwords";

const rollbackCouldPickAPlugin = () => readPluginRecords()[RETIRED_MANAGER_PLUGIN]?.enabled === true;

export function restoreRetiredPasswordManagers(): Promise<void> {
  if (started) return started;
  const consent = consentToken();
  noteProfilesMovedBack(keepArdiaChoice(readRecord().heldOff.length > 0 || rollbackCouldPickAPlugin()), consent);
  started = restoreHeldOff(consent, RESTORE_RETRY.tries, RESTORE_RETRY.firstMs);
  return started;
}
