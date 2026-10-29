import type { HLC } from "../../platform/sync";
import { editStamp } from "./editClock";

export const themePicks = new Map<string, HLC>();

export const noteThemePick = (profileId: string) => void themePicks.set(profileId, editStamp());

export const pickBeats = (pick: HLC | undefined, record: { h: HLC } | undefined): pick is HLC => pick !== undefined && (!record || pick > record.h);
