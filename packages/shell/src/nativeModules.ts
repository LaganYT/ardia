import { requireNativeModule } from "expo-modules-core";
import type { AppModule } from "./app";
import type { CliNative } from "./cli";
import type { InlineCompletionNative } from "./inlineCompletion";
import type { CalendarNative, KeychainNative } from "./live";
import type { ShellNative } from "./shellNative";
import type { FileDropNative, MagnifyAreaNative, SystemNative } from "./system";
import type { TranslationModule } from "./translation";
import type { UserScriptsNative } from "./userScripts";
import type { DockSelectionNative, GlassEffectNative } from "./views";

export type ShellNativeModules = {
  ArdiaShell: ShellNative;
  ArdiaApp: AppModule;
  ArdiaSystem: SystemNative;
  ArdiaCalendar: CalendarNative;
  ArdiaKeychain: KeychainNative;
  ArdiaGlassEffect: GlassEffectNative;
  ArdiaDockSelection: DockSelectionNative;
  ArdiaInlineCompletion: InlineCompletionNative;
  ArdiaTranslate: TranslationModule;
  ArdiaMagnifyArea: MagnifyAreaNative;
  ArdiaFileDrop: FileDropNative;
  ArdiaCli: CliNative;
  ArdiaUserScripts: UserScriptsNative;
};

export const nativeModule = <Name extends keyof ShellNativeModules>(name: Name) => requireNativeModule<ShellNativeModules[Name]>(name);
