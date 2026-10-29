import { breadcrumb, displayHost, hostOf } from "@ardia/core";

export const withoutFragment = (url: string) => url.replace(/#.*$/, "");

export const isWebPageUrl = (url: string) => /^(https?|file):/i.test(url);

export const displayHostOf = (url: string) => displayHost(hostOf(url));

export const pageHostLabel = (url: string) => (url.startsWith("file:") ? "File" : breadcrumb(url).host);

export const hostOrOrigin = (origin: string) => hostOf(origin) || origin;

export function originForSecurityDisplay(origin: string): string {
  try {
    const url = new URL(origin);
    if (!url.host) return origin;
    return url.protocol === "https:" ? url.host : `${url.protocol}//${url.host}`;
  } catch {
    return origin;
  }
}
