import type { Boost, BoostColors } from "./types";

export type EngineBoost = {
  id: string;
  domain: string;
  subdomains: boolean;
  css: string;
  js: string;
  zoom: number;
  color: number[] | null;
  scheme: 0 | 1 | null;
};

const TEXT_ONLY = "*:not(i, .material-symbols-outlined, .material-icons)";
const TEXT_TRANSFORM = { lower: "lowercase", upper: "uppercase", title: "capitalize" } as const;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const quoted = (family: string) => `"${family.replace(/[\\"]/g, "\\$&")}"`;

export function colorMatrix(colors: BoostColors): number[] {
  const primary = colors.hue / 360;
  const secondary = (colors.hue + colors.offset) / 360;
  const spread = clamp(colors.saturation, 0, 1) * (1 - colors.contrast) * 0.2;
  const shift = 0.2 * clamp(colors.brightness, -1, 1);
  const lightness = colors.invert ? [0, 0, 3 * spread - 1, 0, 1 - spread + shift] : [0, 0, 1 - 3 * spread, 0, 2 * spread + shift];
  return [0, 0, primary - secondary, 0, secondary, 0, colors.originalSaturation, 0, 0, (1 - colors.originalSaturation) * colors.saturation, ...lightness, 0, 0, 0, 1, 0];
}

export function boostStylesheet(boost: Pick<Boost, "zaps" | "font" | "textCase" | "css">): string {
  const rules = boost.zaps.map((selector) => `${selector}{display:none !important;}`);
  if (boost.font) rules.push(`${TEXT_ONLY}{font-family:${quoted(boost.font)} !important;}`);
  if (boost.textCase !== "none") rules.push(`${TEXT_ONLY}{text-transform:${TEXT_TRANSFORM[boost.textCase]} !important;}`);
  if (boost.css) rules.push(boost.css);
  return rules.join("\n");
}

export const compileBoost = (boost: Boost): EngineBoost => ({
  id: boost.id,
  domain: boost.domain,
  subdomains: boost.subdomains,
  css: boostStylesheet(boost),
  js: boost.js,
  zoom: boost.size,
  color: boost.colors ? colorMatrix(boost.colors) : null,
  scheme: boost.colors?.appearance === "dark" ? 1 : boost.colors?.appearance === "light" ? 0 : null,
});
