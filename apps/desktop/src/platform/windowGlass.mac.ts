import { ardiaHost, hostSupports, invokeHost, reportHostError } from "../host";
import { animationMovesBackdrop, BACKDROP_METHOD, createMacBackdrops, measureBackdrop, type AnimationLike } from "./mac/macGlass.ts";

const MOTION_EVENTS = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel", "scroll"] as const;

let backdrops: ReturnType<typeof createMacBackdrops> | null = null;

export const behindWindowGlassAvailable = (): boolean => !!ardiaHost && hostSupports(BACKDROP_METHOD);

function watchMotion(changed: () => void): () => void {
  for (const type of MOTION_EVENTS) document.addEventListener(type, changed, { capture: true, passive: true });
  const mutations = new MutationObserver(changed);
  mutations.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  addEventListener("resize", changed);
  return () => {
    for (const type of MOTION_EVENTS) document.removeEventListener(type, changed, { capture: true });
    mutations.disconnect();
    removeEventListener("resize", changed);
  };
}

const runningAnimations = (layers: readonly Element[]) => animationMovesBackdrop(document.getAnimations() as unknown as readonly AnimationLike[], layers);

export function watchBehindWindowGlass(element: HTMLElement): () => void {
  backdrops ??= createMacBackdrops({
    send: (regions) =>
      invokeHost(BACKDROP_METHOD, { regions }).catch((error: unknown) => {
        reportHostError(error);
        throw error;
      }),
    measure: (element) => measureBackdrop(element),
    frame: (run) => requestAnimationFrame(run),
    timeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    watch: (target, changed) => {
      const observer = new ResizeObserver(changed);
      observer.observe(target);
      return () => observer.disconnect();
    },
    watchMotion,
    animating: runningAnimations,
  });
  return backdrops.add(element);
}
