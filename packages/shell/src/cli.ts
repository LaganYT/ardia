import type { EventSubscription } from "expo-modules-core";
import { nativeModule } from "./nativeModules";

export type CliInstallResult = {
  ok: boolean;
  appVersion: string;
  binPath?: string;
  version?: string;
  rcFile?: string;
  error?: string;
  installedVersion?: string | null;
  lines: string[];
};

export type CliNative = {
  installedVersion(): string | null;
  install(): Promise<CliInstallResult>;
  addListener(name: "onInstallLine", listener: (e: { line: string }) => void): EventSubscription;
};

const Cli = nativeModule("ArdiaCli");

export const installedCliVersion = () => Cli.installedVersion();

export const installCli = () => Cli.install();

export const onCliInstallLine = (listener: (line: string) => void) => Cli.addListener("onInstallLine", (e) => listener(e.line));
