import { GlassEffect, isLiquidGlass } from "@ardia/shell";
import { memo } from "react";
import { useTheme, type Theme } from "./theme";
import { parseColor, toHex } from "../../lib/color";

export const liquidGlass = isLiquidGlass();

const PROFILE_SHARE = 0.15;
export const FIELD_GLASS_OPACITY = 0.45;
export const FIELD_GLASS_HOVER_OPACITY = 0.75;

function glassTint(theme: Theme, fill: string, raised = false, dark = theme.dark): string {
  const [r, g, b, a] = parseColor(fill);
  const [pr, pg, pb] = parseColor(theme.backdrop.tintColor);
  const lightening = r + g + b > 3 * 127;
  const alpha = a * (!lightening ? 1 : dark ? (raised ? 0.9 : 0.6) : raised ? 0.8 : 0.55);
  const mix = (c: number, p: number) => c + (p - c) * PROFILE_SHARE;
  return toHex([mix(r, pr), mix(g, pg), mix(b, pb), alpha * 255]);
}

export const GlassFill = memo(function GlassFill({
  fill,
  tint,
  radius,
  border = 0,
  raised,
  dark,
  opacity = 1,
}: {
  fill: string;
  tint?: string | null;
  radius: number;
  border?: number;
  raised?: boolean;
  dark?: boolean;
  opacity?: number;
}) {
  const theme = useTheme();
  return (
    <GlassEffect
      pointerEvents="none"
      cornerRadius={radius}
      tint={tint === null ? undefined : (tint ?? glassTint(theme, fill, raised, dark ?? theme.dark))}
      dark={dark ?? theme.dark}
      style={{ position: "absolute", top: -border, left: -border, right: -border, bottom: -border, opacity }}
    />
  );
});

