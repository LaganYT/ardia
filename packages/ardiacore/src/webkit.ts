import { call } from "./engine/call";
import type { SiteSettingType } from "./siteSettings";

export type PageEngine = "chromium" | "webkit";

export type PageCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  session: boolean;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  partitionKey?: unknown;
  partitionKeyOpaque?: boolean;
};

export type PasskeyAccessStatus = "entitlementRequired" | "deviceNotConfigured" | "notDetermined" | "authorized" | "denied";
export type PasskeyAccess = { entitled: boolean; status: PasskeyAccessStatus };

export const NO_PASSKEY_ACCESS: PasskeyAccess = { entitled: false, status: "entitlementRequired" };

export const WEBKIT_SITE_SETTINGS: readonly SiteSettingType[] = ["camera", "microphone"];

export const removeDownloadStaging = (path: string) => call("webKit.removeDownloadStaging", { path });
export const endWebKitPrivateSession = (session: string) => call("webKit.endPrivateSession", { session });
export const webKitCookieStoreKey = (profile: string) => call("webKit.cookieStoreKey", { profile });
export const importWebKitCookies = (profile: string, storeKey: string, cookies: PageCookie[]) =>
  call("webKit.importCookies", { profile, storeKey, cookies });
export const getPasskeyAccess = () => call("webKit.passkeyAccess");
export const requestPasskeyAccess = () => call("webKit.requestPasskeyAccess");
