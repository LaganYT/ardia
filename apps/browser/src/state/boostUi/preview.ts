import { previewBoost } from "../../platform/boosts";
import { orWarn } from "../../lib/fallback";
import { compileBoost } from "../boosts/compile";
import type { Boost } from "../boosts/types";

const inFlight = new Set<string>();
const latest = new Map<string, Boost>();

export function previewDraft(tabId: string, boost: Boost) {
  if (inFlight.has(tabId)) {
    latest.set(tabId, boost);
    return;
  }
  inFlight.add(tabId);
  void Promise.resolve(previewBoost(tabId, JSON.stringify(compileBoost(boost))))
    .catch(orWarn(undefined))
    .finally(() => {
      inFlight.delete(tabId);
      const next = latest.get(tabId);
      latest.delete(tabId);
      if (next) previewDraft(tabId, next);
    });
}
