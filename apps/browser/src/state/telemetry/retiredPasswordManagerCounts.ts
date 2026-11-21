import type { ConsentToken } from "./choice";
import { consentOrNow, countFor } from "./countFor";

const FIELDS = ["password_manager_profiles_moved_back", "password_manager_offer_to_save_restored", "password_manager_offer_to_save_restore_failures"] as const;
type Field = (typeof FIELDS)[number];

let counts: Partial<Record<Field, number>> = {};
const add = (field: Field, by: number, consent?: ConsentToken | null) => countFor(consentOrNow(consent), () => void (counts[field] = (counts[field] ?? 0) + by));

export function noteProfilesMovedBack(moved: number, consent?: ConsentToken | null) {
  if (moved > 0) add("password_manager_profiles_moved_back", moved, consent);
}

export const noteOfferToSaveRestore = (restored: boolean, consent?: ConsentToken | null) =>
  add(restored ? "password_manager_offer_to_save_restored" : "password_manager_offer_to_save_restore_failures", 1, consent);

export function takeRetiredPasswordManagerCounts(): Record<string, number> {
  const taken = counts;
  counts = {};
  return taken as Record<string, number>;
}
