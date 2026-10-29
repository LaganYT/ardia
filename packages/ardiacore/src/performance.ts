import { call } from "./engine/call";
import { nativeModule } from "./nativeModules";

export type BatterySaverMode = "on" | "off" | "default";

export type BatterySaverState = { state: number; active: boolean };

export type MemorySaverMode = "moderate" | "balanced" | "maximum";

export type MemorySaverRequest = { state?: "on" | "off"; aggressiveness?: MemorySaverMode; sites?: string[] };

export type MemorySaverState = { state: "on" | "off"; aggressiveness: MemorySaverMode; active: boolean; sites: string[]; invalid: string[] };

export const openTaskManager = () => call("engine.openTaskManager");

export const setBatterySaver = (mode: BatterySaverMode) => call("engine.batterySaver", { mode });

export const setMemorySaver = (request: MemorySaverRequest) => call("engine.memorySaver", request);

export const isKeepActiveSiteValid = (site: string) => call("engine.validateKeepActiveSite", { site }).then((reply) => reply.valid);

export const trimEngineMemory = () => call("engine.trimMemory");

export const inputIdleSeconds = () => nativeModule("ArdiaEngine").inputIdleSeconds();
