import { create } from "zustand";
import { browseForMe, type BrowseForMeEvent } from "../../platform/browseForMe";
import { browseForMeCounts } from "../../lib/telemetrySchema";
import { settled } from "../pages/store";
import { dismissSearch } from "../search/store";
import { useTabs } from "../tabs/store";
import { countUsage } from "../telemetry/telemetry";
import { browseForMeOffered } from "./offer";

export { browseForMeOffered };

export const useBrowseForMe = create<{ connected: boolean }>()(() => ({ connected: false }));

export const useChatGPTConnected = () => useBrowseForMe((state) => state.connected);

const counting = () => !useTabs.getState().incognito;

export function startBrowseForMe(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || !browseForMeOffered()) return false;
  dismissSearch("submitted");
  if (counting()) countUsage("browse_for_me_opened");
  void settled(() => browseForMe.open(trimmed), undefined);
  return true;
}

export function noteBrowseForMe(event: BrowseForMeEvent) {
  if (event.name === "account") useBrowseForMe.setState({ connected: event.connected });
  if (event.name === "settled" && counting()) for (const field of browseForMeCounts(event.outcome, event.chatGPTFellBack)) countUsage(field);
}

export async function refreshChatGPTConnected() {
  if (!browseForMeOffered()) return;
  useBrowseForMe.setState({ connected: await settled(() => browseForMe.isConnected(), false) });
}
