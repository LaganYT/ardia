export const BACKDROP_METHOD = "shell.backdropRegions";
export const BACKDROP_MATERIALS = ["liquid", "sidebar", "underWindow"] as const;
export const BACKDROP_RETRY_MS = 250;
export const BACKDROP_RETRY_MAX_MS = 4000;
export type BackdropMaterial = (typeof BACKDROP_MATERIALS)[number];
export type BackdropRect = { x: number; y: number; width: number; height: number };
export type BackdropRegion = { rect: BackdropRect; material: BackdropMaterial };

type BackdropDeps = {
  send: (regions: BackdropRegion[]) => Promise<unknown>;
  measure: (element: Element) => BackdropRect | null;
  frame: (run: () => void) => void;
  timeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  watch: (element: Element, changed: () => void) => () => void;
  watchMotion: (changed: () => void) => () => void;
  animating: (layers: readonly Element[]) => boolean;
};

export type AnimationLike = { playState: string; effect: { target?: Element | null } | null };

export const animationMovesBackdrop = (animations: readonly AnimationLike[], layers: readonly Element[]): boolean =>
  animations.some((animation) => {
    const target = animation.playState === "running" ? animation.effect?.target : null;
    return !!target && layers.some((layer) => target === layer || target.contains(layer));
  });

const HIDDEN_VISIBILITY = new Set(["hidden", "collapse"]);

export function measureBackdrop(element: Element, style: (element: Element) => { visibility: string } | null = (target) => (typeof getComputedStyle === "function" ? getComputedStyle(target) : null)): BackdropRect | null {
  if (!element.isConnected) return null;
  if (HIDDEN_VISIBILITY.has(style(element)?.visibility ?? "")) return null;
  const r = element.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function createMacBackdrops(deps: BackdropDeps) {
  const layers = new Map<Element, { material: BackdropMaterial; stop: () => void }>();
  let frameQueued = false;
  let accepted = "[]";
  let inFlight = false;
  let resendAfterReply = false;
  let failures = 0;
  let retry: unknown = null;
  let stopMotion: (() => void) | null = null;

  const measured = () => {
    const regions = [...layers].flatMap(([element, { material }]) => {
      const rect = deps.measure(element);
      return rect ? [{ rect, material }] : [];
    });
    return { regions, text: JSON.stringify(regions) };
  };

  const transmit = () => {
    if (retry !== null) return;
    if (inFlight) {
      resendAfterReply = true;
      return;
    }
    const { regions, text } = measured();
    if (text === accepted) return;
    inFlight = true;
    deps.send(regions).then(
      () => {
        accepted = text;
        failures = 0;
      },
      () => {
        failures += 1;
        if (retry === null) {
          retry = deps.timeout(() => {
            retry = null;
            schedule();
          }, Math.min(BACKDROP_RETRY_MS * 2 ** (failures - 1), BACKDROP_RETRY_MAX_MS));
        }
      },
    ).finally(() => {
      inFlight = false;
      if (!resendAfterReply) return;
      resendAfterReply = false;
      schedule();
    });
  };

  const flush = () => {
    frameQueued = false;
    transmit();
    if (layers.size && deps.animating([...layers.keys()])) schedule();
  };

  function schedule() {
    if (frameQueued) return;
    frameQueued = true;
    deps.frame(flush);
  }

  return {
    add(element: Element, material: BackdropMaterial = "liquid") {
      const entry = { material, stop: deps.watch(element, schedule) };
      layers.set(element, entry);
      stopMotion ??= deps.watchMotion(schedule);
      schedule();
      return () => {
        if (layers.get(element) !== entry) return;
        entry.stop();
        layers.delete(element);
        if (!layers.size && stopMotion) {
          stopMotion();
          stopMotion = null;
        }
        schedule();
      };
    },
    setMaterial(material: BackdropMaterial) {
      for (const entry of layers.values()) entry.material = material;
      schedule();
    },
    dispose() {
      if (retry !== null) deps.clearTimeout(retry);
      retry = null;
    },
    flushNow: flush,
    size: () => layers.size,
  };
}
