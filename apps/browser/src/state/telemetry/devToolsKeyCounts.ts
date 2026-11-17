import { onDevToolsKeyKept } from "../../platform/performance";

let kept = 0;

onDevToolsKeyKept(() => void (kept += 1));

export function takeDevToolsKeyCounts() {
  const taken = { devtools_keys_kept: kept };
  kept = 0;
  return taken;
}
