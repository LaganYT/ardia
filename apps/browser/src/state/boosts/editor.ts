import { create } from "zustand";
import { clearBoostPreview } from "../../platform/boosts";
import { orWarn } from "../../lib/fallback";

export type BoostEditor = { tabId: string; boostId: string };

const useBoostEditors = create<{ byWindow: Record<string, BoostEditor> }>()(() => ({ byWindow: {} }));

export const openBoostEditor = (windowId: string, tabId: string, boostId: string) =>
  useBoostEditors.setState((s) => ({ byWindow: { ...s.byWindow, [windowId]: { tabId, boostId } } }));

export function closeBoostEditor(windowId: string) {
  const open = useBoostEditors.getState().byWindow[windowId];
  if (!open) return;
  const { [windowId]: _, ...rest } = useBoostEditors.getState().byWindow;
  useBoostEditors.setState({ byWindow: rest });
  void clearBoostPreview(open.tabId).catch(orWarn(undefined));
}

export const useBoostEditor = (windowId: string): BoostEditor | null => useBoostEditors((s) => s.byWindow[windowId]) ?? null;
