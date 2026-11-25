import { parseColor } from "../../browser/src/lib/color";

export type BehindWindowGlass = { available: () => boolean; watch: (element: HTMLElement) => () => void };

export const wantsBehindWindowGlass = (vibrancy: boolean | undefined, themed: boolean, available: boolean): boolean => !!vibrancy && !themed && available;

export function behindWindowGlassSwitch(glass: Pick<BehindWindowGlass, "watch">) {
  let watched: HTMLElement | null = null;
  let stop: (() => void) | null = null;
  return (element: HTMLElement | null, on: boolean) => {
    const next = on ? element : null;
    if (next === watched) return;
    stop?.();
    stop = null;
    watched = next;
    if (next) stop = glass.watch(next);
  };
}

export function glassTint(tintColor: string | undefined, tintAlpha: number | undefined): string | null {
  if (!tintColor || !(tintAlpha! > 0)) return null;
  const [r, g, b, a] = parseColor(tintColor);
  const alpha = Math.min(1, a * tintAlpha!);
  return alpha > 0 ? `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+alpha.toFixed(4)})` : null;
}
