import { requireNativeView } from "expo";
import { requireOptionalNativeModule } from "expo-modules-core";
import { createElement, type ComponentType } from "react";
import type { Subscription } from "./pageTypes";

export type BrowseForMeOutcome = "chatgpt" | "on_device" | "excerpts" | "failed";

export type BrowseForMeEvent =
  | { name: "openSource"; url: string }
  | { name: "searchWeb"; query: string }
  | { name: "openLink"; url: string }
  | { name: "closed" }
  | { name: "settled"; outcome: BrowseForMeOutcome; chatGPTFellBack: boolean }
  | { name: "account"; connected: boolean };

type BrowseForMeNative = {
  isConnected(): Promise<boolean>;
  open(query: string): Promise<void>;
  addListener(eventName: "onBrowseForMe", listener: (event: BrowseForMeEvent) => void): Subscription;
};

export const BROWSE_FOR_ME_MODULE = "ArdiaPhoneBrowseForMe";

const native = () => requireOptionalNativeModule<BrowseForMeNative>(BROWSE_FOR_ME_MODULE);

export const browseForMe = {
  available: (): boolean => native() !== null,
  isConnected: async (): Promise<boolean> => (await native()?.isConnected()) ?? false,
  open: async (query: string): Promise<void> => {
    await native()?.open(query);
  },
  addListener: (listener: (event: BrowseForMeEvent) => void): Subscription => native()?.addListener("onBrowseForMe", listener) ?? { remove() {} },
};

let settingsView: ComponentType<{ testID?: string }> | undefined;

export function BrowseForMeSettings({ testID }: { testID?: string }) {
  if (!browseForMe.available()) return null;
  settingsView ??= requireNativeView<{ testID?: string }>(BROWSE_FOR_ME_MODULE, "BrowseForMeSettingsView");
  return createElement(settingsView, { testID });
}
