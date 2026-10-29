import { Clock, type HLC } from "../../platform/sync";

export const themePicks = new Map<string, HLC>();
let lastPick: HLC | null = null;

export function noteThemePick(profileId: string, device: string, seen: HLC | null) {
  const clock = new Clock(device, seen);
  if (lastPick) clock.observe(lastPick);
  themePicks.set(profileId, (lastPick = clock.tick()));
}

export const pickBeats = (pick: HLC | undefined, record: { h: HLC } | undefined): pick is HLC => pick !== undefined && (!record || pick > record.h);
