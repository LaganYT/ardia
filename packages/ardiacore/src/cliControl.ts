import { call, on } from "./engine/call";

type CliServer = { connections: number; generation: number; file: string; reason?: string };

export type CliControlStatus =
  | { state: "external" }
  | ({ state: "off" | "starting" } & CliServer)
  | ({ state: "on"; port: number } & CliServer);

export const setCliControl = (on: boolean) => call("engine.setCliControl", { on });

export const setCliActiveTab = (tabId: string | null) => call("engine.setCliActiveTab", { tabId });

export const cliControlStatus = () => call("engine.cliControlStatus");

export const onCliControlChanged = (listener: (status: CliControlStatus) => void) => on("engine.cliControl", listener);
