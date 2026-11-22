import { noteSettingsWritesRejected } from "../telemetry/settingsWriteCounts";

type Specs = Record<string, { valid: (value: unknown) => boolean }>;

export function keptSettingsPatch<P extends object>(patch: P, specs: Specs): P {
  const entries = Object.entries(patch);
  const kept = entries.filter(([key, value]) => Object.hasOwn(specs, key) && specs[key]!.valid(value));
  if (kept.length === entries.length) return patch;
  noteSettingsWritesRejected(entries.length - kept.length);
  return Object.fromEntries(kept) as P;
}
