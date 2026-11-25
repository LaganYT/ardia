export type SectionRange = { lo: number; hi: number };

export const clampTo = (value: number, r: SectionRange) => Math.min(r.hi, Math.max(r.lo, value));

export function rangeOf(frame: { y: number; h: number } | undefined, viewport: number, edge: number): SectionRange | null {
  if (!frame || viewport <= 0) return null;
  if (frame.h + edge * 2 <= viewport) {
    const centre = frame.y + frame.h / 2 - viewport / 2;
    return { lo: centre, hi: centre };
  }
  return { lo: frame.y - edge, hi: frame.y + frame.h + edge - viewport };
}
