let counts = { preload_pages_turned_on: 0, preload_pages_turned_off: 0 };

export const notePreloadPagesTurned = (on: boolean) => void counts[on ? "preload_pages_turned_on" : "preload_pages_turned_off"]++;

export function takePreloadPagesCounts() {
  const taken = counts;
  counts = { preload_pages_turned_on: 0, preload_pages_turned_off: 0 };
  return taken;
}
