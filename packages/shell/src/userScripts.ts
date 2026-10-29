import type { EventSubscription } from "expo-modules-core";
import { nativeModule } from "./nativeModules";

export type UserScriptsFolder = { token?: string } & (
  | { state: "empty" | "busy" | "pending"; generation?: number }
  | { state: "absent"; generation: number; path: string }
  | { state: "invalid"; generation?: number; error: string; path?: string }
  | { state: "ready"; generation: number; path: string }
);

export type UserScriptsNative = {
  watch(on: boolean): void;
  read(): Promise<UserScriptsFolder>;
  readStatus(): Promise<string | null>;
  writeStatus(json: string): Promise<void>;
  addListener(name: "onChange", listener: () => void): EventSubscription;
};

const UserScripts = nativeModule("ArdiaUserScripts");

export const watchUserScripts = (on: boolean) => UserScripts.watch(on);

export const readUserScripts = () => UserScripts.read();

export const readUserScriptsStatus = () => UserScripts.readStatus();

export const writeUserScriptsStatus = (json: string) => UserScripts.writeStatus(json);

export const onUserScriptsChange = (listener: () => void) => UserScripts.addListener("onChange", listener);
