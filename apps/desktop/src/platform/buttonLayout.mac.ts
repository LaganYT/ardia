import type { ArdiaHost } from "../host";
import { setDesktopButtonLayout } from "../../../browser/src/state/windows/windowButtons.ts";

export const MAC_BUTTON_LAYOUT = "close,minimize,maximize:";

export const followButtonLayout = (_host: ArdiaHost, set: (layout: string | null, tiling: boolean) => void = setDesktopButtonLayout): (() => void) => {
  set(MAC_BUTTON_LAYOUT, false);
  return () => {};
};
