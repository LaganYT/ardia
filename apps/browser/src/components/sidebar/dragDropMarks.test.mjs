import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const D = await import("./fixtures/dragScene.mjs");
const { world, mixedScene, regionsOf } = await import("./fixtures/dragWorld.mjs");
const { splitTabIdsOf } = await import("../../state/splits/splits.ts");
const { useToasts } = await import("../../state/app/toasts.ts");
const { pinGrid } = await import("./pinZone.ts");
const { useBrowser } = await import("../../state/browser/store.ts");
const { addToTileFolder, tileFolderOf } = await import("../../state/pins/tileFolders.ts");
const { useFolderPanel } = await import("../../state/sidebar/tileFolderUi.ts");
const { devTabPresses } = await import("../../state/telemetry/tabPresses.ts");
const { S, entryKey, tailKey, mount, sceneLayout, readDrag, GAP, ROW, TILE } = D;

const frameOf = (m, key) => m.L.entries.find((e) => e.key === key).frame;
const at = (f, fx, fy) => ({ x: f.x + f.w * fx, y: f.y + f.h * fy });
const panes = () => Object.values(S().splits).map((v) => splitTabIdsOf(v));

async function dragOver(m, key, to, { splitView = true, select = null, viewport } = {}) {
  if (select) S().setSelection(m.w, select);
  const { c } = mount({ entries: m.L.entries, regions: m.regions, ...(viewport ? { viewport } : {}) });
  c.splitView = splitView;
  const f = frameOf(m, key);
  await c.begin(key, f.x + 20, f.y + 10);
  for (const p of [].concat(to)) c.move(p.x, p.y);
  return { c, ...readDrag(c) };
}

test("a single tab over the middle half of a row splits it on the half the pointer is on, with no line", async () => {
  for (const [fx, side] of [[0.2, "left"], [0.49, "left"], [0.51, "right"], [0.9, "right"]]) {
    const m = mixedScene();
    const b = entryKey("tab", m.id.b);
    const r = await dragOver(m, entryKey("tab", m.id.c), at(frameOf(m, b), fx, 0.5));
    assert.deepEqual(r.drop, { type: "split", targetId: m.id.b, side }, `${fx}`);
    assert.deepEqual(r.marks.split, { key: b, side });
    assert.equal(r.marks.line, null);
    r.c.end(false);
  }
});

test("the top and bottom quarters of a row are insertion slots: a line between the rows, from the row's own edges", async () => {
  const m = mixedScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const split = frameOf(m, entryKey("split", m.SP));
  const above = await dragOver(m, entryKey("tab", m.id.c), at(b, 0.5, 0.2));
  assert.deepEqual(above.drop.placement, { pinned: false, beforeId: m.id.b });
  assert.equal(above.marks.split, null);
  assert.deepEqual(above.marks.line, { x: b.x, y: b.y - GAP / 2, w: b.w });
  above.c.move(b.x + 40, b.y + b.h * 0.8);
  assert.deepEqual(readDrag(above.c).marks.line, { x: split.x, y: split.y - GAP / 2, w: split.w }, "below b: the slot before the split row");
  above.c.end(false);
});

test("the line follows the target's indent inside a group and sits under the last row at a list's end", async () => {
  const m = mixedScene();
  const g2 = frameOf(m, entryKey("tab", m.id.g2));
  const r = await dragOver(m, entryKey("tab", m.id.a), at(g2, 0.5, 0.15));
  assert.equal(r.drop.placement.groupId, m.G);
  assert.deepEqual(r.marks.line, { x: g2.x, y: g2.y - GAP / 2, w: g2.w });
  const tail = frameOf(m, tailKey("list"));
  r.c.move(60, tail.y + 20);
  assert.equal(readDrag(r.c).gapKey, tailKey("list"));
  assert.deepEqual(readDrag(r.c).marks.line, { x: tail.x, y: tail.y + GAP / 2, w: tail.w });
  r.c.end(false);
});

test("rows stay where they are: no row opens a gap and the dragged row keeps its place", async () => {
  const m = mixedScene();
  const r = await dragOver(m, entryKey("tab", m.id.c), [{ x: 60, y: 300 }, { x: 60, y: 160 }, { x: 60, y: 480 }]);
  assert.deepEqual(D.gaps(r.c), {});
  assert.deepEqual(r.marks.sources, [entryKey("tab", m.id.c)]);
  r.c.end(false);
});

test("a selection never splits: the middle of a row is a plain insertion slot", async () => {
  const m = mixedScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, entryKey("tab", m.id.a), at(b, 0.7, 0.5), { select: [m.id.a, m.id.c] });
  assert.equal(r.drop.type, "tabs");
  assert.equal(r.marks.split, null);
  assert.ok(r.marks.line);
  r.c.end(false);
});

test("a group or a split row never splits a row", async () => {
  const b = (m) => at(frameOf(m, entryKey("tab", m.id.b)), 0.7, 0.5);
  for (const keyOf of [(m) => entryKey("group", m.G), (m) => entryKey("split", m.SP)]) {
    const m = mixedScene();
    const r = await dragOver(m, keyOf(m), b(m));
    assert.notEqual(r.drop.type, "split", keyOf(m));
    assert.equal(r.marks.split, null);
    r.c.end(false);
  }
});

test("a list tab dropped on a pinned row's right half joins it as a pinned split, and a pinned row on a list tab's half joins the list", async () => {
  const m = mixedScene();
  const p1 = entryKey("tab", m.id.p1);
  const r = await dragOver(m, entryKey("tab", m.id.c), at(frameOf(m, p1), 0.75, 0.5));
  assert.deepEqual(r.drop, { type: "split", targetId: m.id.p1, side: "right" });
  assert.deepEqual(r.marks.split, { key: p1, side: "right" });
  assert.equal(r.marks.line, null);
  r.c.end(true);
  await D.settle();
  assert.ok(panes().some((p) => JSON.stringify(p) === JSON.stringify([m.id.p1, m.id.c])), JSON.stringify(panes()));
  assert.equal(S().tabs[m.id.c].pin?.as, "row");
  const order = S().windows[m.w].tabIds;
  assert.equal(order.indexOf(m.id.c), order.indexOf(m.id.p1) + 1);

  const n = mixedScene();
  const b = entryKey("tab", n.id.b);
  const r2 = await dragOver(n, entryKey("tab", n.id.p2), at(frameOf(n, b), 0.25, 0.5));
  assert.deepEqual(r2.drop, { type: "split", targetId: n.id.b, side: "left" });
  r2.c.end(true);
  await D.settle();
  assert.ok(panes().some((p) => JSON.stringify(p) === JSON.stringify([n.id.p2, n.id.b])), JSON.stringify(panes()));
  assert.equal(S().tabs[n.id.p2].pin, null);
});

const splitCounts = () => {
  const t = devTabPresses();
  return [t.drops_split_left, t.drops_split_right, t.drops_split_pinned, t.drops_split_unpinned];
};
const counted = (before) => splitCounts().map((n, i) => n - before[i]);

test("a split drop is counted only when the split is made, with its side and any section change", async () => {
  const m = mixedScene();
  let before = splitCounts();
  const made = await dragOver(m, entryKey("tab", m.id.c), at(frameOf(m, entryKey("tab", m.id.p1)), 0.75, 0.5));
  made.c.end(true);
  await D.settle();
  assert.deepEqual(counted(before), [0, 1, 1, 0], "right half, pinned by the drop");

  const full = mixedScene();
  S().openSplitPane(full.w, { tabId: full.id.a, anchorTabId: full.id.s2, side: "right" });
  useToasts.setState({ toasts: {} });
  before = splitCounts();
  const refused = await dragOver(full, entryKey("tab", full.id.c), at(frameOf(full, entryKey("split", full.SP)), 0.9, 0.5));
  assert.equal(refused.drop.type, "split");
  refused.c.end(true);
  await D.settle();
  assert.deepEqual(counted(before), [0, 0, 0, 0], "a full split counts nothing");
  assert.equal(useToasts.getState().toasts[full.w]?.title, "Cannot Add New Pane", "and still says why");

  const gone = mixedScene();
  before = splitCounts();
  const late = await dragOver(gone, entryKey("tab", gone.id.c), at(frameOf(gone, entryKey("tab", gone.id.b)), 0.25, 0.5));
  assert.equal(late.drop.type, "split");
  S().pinTabs([gone.id.c], true, false);
  late.c.end(true);
  await D.settle();
  assert.deepEqual(counted(before), [0, 0, 0, 0], "a drop the split refuses at let-go counts nothing");
  assert.deepEqual(panes(), [[gone.id.s1, gone.id.s2]]);
});

test("beside a row, short of the away zone, the pointer gets the line, not the row's half", async () => {
  for (const dx of [-3, 8, 30]) {
    const m = mixedScene();
    const f = frameOf(m, entryKey("tab", m.id.b));
    const x = dx < 0 ? f.x + dx : f.x + f.w + dx;
    const r = await dragOver(m, entryKey("tab", m.id.c), { x, y: f.y + f.h / 2 });
    assert.notEqual(r.drop.type, "split", `${dx}`);
    assert.equal(r.marks.split, null);
    assert.ok(r.marks.line, `${dx}`);
    r.c.end(false);
  }
});

test("an accepted drop whose slot is scrolled past the list's top keeps its line, held at the visible edge", async () => {
  const m = mixedScene();
  const a = frameOf(m, entryKey("tab", m.id.a));
  const viewport = { x: 0, y: a.y + 2, w: 200, h: 500 };
  const r = await dragOver(m, entryKey("tab", m.id.c), at(a, 0.5, 0.2), { viewport });
  assert.equal(r.drop.type, "tabs");
  assert.equal(r.drop.placement.beforeId, m.id.a, "the drop target is unchanged");
  assert.deepEqual(r.marks.line, { x: a.x, y: viewport.y, w: a.w });
  r.c.end(false);
});

test("a group's only tab let go inside its own group lands on its own row, not a group's height above it", async (t) => {
  globalThis.__DEV__ = true;
  t.after(() => void (globalThis.__DEV__ = false));
  const W = world("a", "solo", "b");
  const G = S().groupTabs([W.id.solo], { pinned: false, name: "G" });
  const L = sceneLayout({ top: 150 });
  L.row(W.id.a);
  L.group(G, {}, (n) => L.row(W.id.solo, n));
  L.row(W.id.b);
  L.tail("list");
  const m = { ...W, L, regions: regionsOf(L, { list: [150, L.y] }) };
  const solo = frameOf(m, entryKey("tab", W.id.solo));
  const r = await dragOver(m, entryKey("tab", W.id.solo), at(solo, 0.5, 0.85));
  assert.equal(r.gapKey, tailKey({ group: G }));
  r.c.end(true);
  assert.equal(r.c.landed?.y, solo.y, JSON.stringify({ landed: r.c.landed, solo }));
  await D.settle();
  assert.deepEqual(S().groups[G].tabIds, [W.id.solo]);
});

test("without split view the middle of a row reorders, and nothing groups", async () => {
  const m = mixedScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, entryKey("tab", m.id.c), at(b, 0.7, 0.5), { splitView: false });
  assert.equal(r.drop.type, "tabs");
  assert.ok(r.marks.line);
  const groups = Object.keys(S().groups).length;
  r.c.end(true);
  await D.settle();
  assert.equal(Object.keys(S().groups).length, groups);
  assert.deepEqual(panes(), [[m.id.s1, m.id.s2]]);
});

test("a drop on a row's half makes a split there, the dragged tab on that side", async () => {
  for (const [fx, order] of [[0.25, (m) => [m.id.c, m.id.b]], [0.75, (m) => [m.id.b, m.id.c]]]) {
    const m = mixedScene();
    const r = await dragOver(m, entryKey("tab", m.id.c), at(frameOf(m, entryKey("tab", m.id.b)), fx, 0.5));
    r.c.end(true);
    await D.settle();
    assert.ok(panes().some((p) => JSON.stringify(p) === JSON.stringify(order(m))), JSON.stringify(panes()));
    assert.equal(r.c.active, false);
  }
});

test("a split row takes a third pane on the side it is dropped, and a full one says so instead", async () => {
  const m = mixedScene();
  const sp = frameOf(m, entryKey("split", m.SP));
  const r = await dragOver(m, entryKey("tab", m.id.c), at(sp, 0.1, 0.5));
  assert.deepEqual(r.marks.split, { key: entryKey("split", m.SP), side: "left" });
  r.c.end(true);
  await D.settle();
  assert.deepEqual(splitTabIdsOf(S().splits[m.SP]), [m.id.c, m.id.s1, m.id.s2]);

  const full = mixedScene();
  S().openSplitPane(full.w, { tabId: full.id.a, anchorTabId: full.id.s2, side: "right" });
  const before = splitTabIdsOf(S().splits[full.SP]);
  assert.equal(before.length, 3);
  const r2 = await dragOver(full, entryKey("tab", full.id.c), at(frameOf(full, entryKey("split", full.SP)), 0.9, 0.5));
  assert.deepEqual(r2.marks.split?.side, "right");
  r2.c.end(true);
  await D.settle();
  assert.deepEqual(splitTabIdsOf(S().splits[full.SP]), before);
  assert.equal(useToasts.getState().toasts[full.w]?.title, "Cannot Add New Pane");
});

function tilesScene() {
  const W = world("a", "b", "t1", "t2");
  const { id } = W;
  S().pinTabs([id.t1, id.t2], true);
  const L = sceneLayout({ top: 60 });
  const grid = L.tiles([id.t1, id.t2]).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(id.a).row(id.b).tail("list");
  return { ...W, L, regions: { tiles: grid, ...regionsOf(L, { list: [listTop, L.y] }) } };
}

test("a row over the Top Apps takes the shape of the tile it would become, and its row shape back when it leaves", async () => {
  const m = tilesScene();
  const t2 = frameOf(m, entryKey("tab", m.id.t2));
  const r = await dragOver(m, entryKey("tab", m.id.a), { x: t2.x + t2.w - 4, y: t2.y + TILE / 2 });
  assert.equal(r.marks.pins, true);
  assert.deepEqual(r.marks.tile, { w: pinGrid(3, m.regions.tiles.w).width, h: TILE });
  assert.equal(r.marks.line, null);
  r.c.move(60, frameOf(m, entryKey("tab", m.id.b)).y + ROW * 0.9);
  assert.equal(readDrag(r.c).marks.tile, null);
  assert.ok(readDrag(r.c).marks.line);
  r.c.end(false);

  const tile = await dragOver(tilesScene(), entryKey("tab", S().windows[Object.keys(S().windows)[0]].tabIds.find((id) => S().tabs[id].pin)), { x: t2.x + 4, y: t2.y + TILE / 2 });
  assert.equal(tile.marks.tile, null, "a tile dragged along the grid is already a tile");
  tile.c.end(false);
});

test("a Top Apps tile over the middle of a list row gets the line, never a split", async () => {
  const m = tilesScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, entryKey("tab", m.id.t2), at(b, 0.75, 0.5));
  assert.notEqual(r.drop.type, "split");
  assert.equal(r.marks.split, null);
  assert.ok(r.marks.line);
  r.c.end(false);
});

test("a Top Apps tile over the list takes the shape of a list row, and its tile shape back over the grid", async () => {
  const m = tilesScene();
  const t2 = entryKey("tab", m.id.t2);
  const b = frameOf(m, entryKey("tab", m.id.b));
  const r = await dragOver(m, t2, { x: b.x + 40, y: b.y + ROW * 0.85 });
  assert.equal(r.drop.type, "tabs");
  assert.ok(r.marks.line);
  assert.deepEqual(r.marks.row, { w: b.w, h: ROW });
  assert.equal(r.marks.tile, null);
  const grid = frameOf(m, entryKey("tab", m.id.t1));
  r.c.move(grid.x + 10, grid.y + TILE / 2);
  assert.equal(readDrag(r.c).marks.pins, true);
  assert.equal(readDrag(r.c).marks.row, null, "back over the grid it is a tile again");
  r.c.move(b.x + 40, b.y + ROW * 0.85);
  assert.deepEqual(readDrag(r.c).marks.row, { w: b.w, h: ROW });
  r.c.move(4000, b.y);
  assert.equal(readDrag(r.c).marks.row, null, "away from the sidebar there is no drop, so it stays a tile");
  r.c.end(false);
});

test("a row never takes a row mark, and a folder tile stays a folder", async () => {
  const m = tilesScene();
  const b = frameOf(m, entryKey("tab", m.id.b));
  const row = await dragOver(m, entryKey("tab", m.id.a), { x: b.x + 40, y: b.y + ROW * 0.85 });
  assert.equal(row.marks.row, null);
  row.c.end(false);

  const W = world("a", "b", "t1", "t2", "t3");
  S().pinTabs([W.id.t1, W.id.t2, W.id.t3], true);
  useBrowser.setState(addToTileFolder(S(), [W.id.t3], W.id.t2), true);
  const folderId = tileFolderOf(S().tabs[W.id.t2]).id;
  const L = sceneLayout({ top: 60 });
  const cells = [W.id.t1, { folderId, members: [W.id.t2, W.id.t3] }];
  const grid = L.tiles(cells).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(W.id.a).row(W.id.b).tail("list");
  const fm = { ...W, L, regions: { tiles: grid, ...regionsOf(L, { list: [listTop, L.y] }) } };
  const key = entryKey("tileFolder", folderId);
  const fb = frameOf(fm, entryKey("tab", W.id.b));
  const folder = await dragOver(fm, key, { x: fb.x + 40, y: fb.y + ROW * 0.85 });
  assert.notEqual(folder.drop.type, "none");
  assert.equal(folder.marks.row, null, "a folder tile keeps its folder look");
  folder.c.end(false);
});

test("a tile held over its own place never becomes a folder target, past the hold time too", async () => {
  const m = tilesScene();
  const home = frameOf(m, entryKey("tab", m.id.t1));
  const centre = { x: home.x + home.w / 2, y: home.y + TILE / 2 };
  const r = await dragOver(m, entryKey("tab", m.id.t1), [{ x: centre.x + 3, y: centre.y }, centre]);
  await new Promise((done) => setTimeout(done, 450));
  r.c.move(centre.x + 1, centre.y);
  const now = readDrag(r.c);
  assert.notEqual(now.drop.type, "folder");
  assert.notEqual(now.marks.folderTarget, entryKey("tab", m.id.t1));
  assert.notEqual(now.hold?.key, entryKey("tab", m.id.t1));
  r.c.end(false);
});

function panelScene() {
  const W = world("a", "b", "t1", "t2", "t3", "t4");
  const { id } = W;
  S().pinTabs([id.t1, id.t2, id.t3, id.t4], true);
  S().updateSettings({ topAppFolders: true });
  const members = [id.t1, id.t2, id.t3];
  useBrowser.setState(addToTileFolder(S(), members.slice(1), members[0]), true);
  const folderId = tileFolderOf(S().tabs[id.t1]).id;
  const L = sceneLayout({ top: 60 });
  const grid = L.tiles([{ folderId, members }, id.t4]).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(id.a).row(id.b).tail("list");
  const regions = { tiles: grid, ...regionsOf(L, { list: [listTop, L.y] }) };
  useFolderPanel.setState({ open: { windowId: W.w, folderId, anchor: { x: 6, y: 60, width: 87, height: TILE } } });
  const P = sceneLayout({ top: 120, x: 26, width: 150 });
  P.folderMembers(members);
  L.entries.push(...P.entries);
  regions.folder = { x: 20, y: 110, w: 162, h: P.y - 110 + 10 };
  return { ...W, L, folderId, members, regions };
}

test("inside an open folder panel a member dragged up or down gets the line at its slot, between members and below the last", async () => {
  const m = panelScene();
  const [t1, t2, t3] = m.members;
  const second = frameOf(m, `fm:${t2}`);
  const r = await dragOver(m, `fm:${t3}`, { x: second.x + 40, y: second.y + ROW * 0.15 });
  try {
    assert.deepEqual(r.drop, { type: "folder", ontoId: t1, beforeId: t2 });
    assert.deepEqual(r.marks.line, { x: second.x, y: second.y - GAP / 2, w: second.w });
    assert.equal(r.marks.folderTarget, null, "a reorder inside the panel lights no tile");
    const tail = frameOf(m, tailKey("folder"));
    r.c.move(second.x + 40, tail.y + 6);
    const end = readDrag(r.c);
    assert.equal(end.drop.type, "folder");
    assert.equal(end.drop.beforeId, null);
    assert.deepEqual(end.marks.line, { x: tail.x, y: tail.y + GAP / 2, w: tail.w });
  } finally {
    r.c.end(false);
    useFolderPanel.setState({ open: null });
  }
});

test("a row held over a tile until it would make a folder shows the ring and no line", async () => {
  const m = tilesScene();
  const grid = m.regions.tiles;
  const reflowed = pinGrid(3, grid.w);
  const centre = { x: grid.x + reflowed.width / 2, y: grid.y + TILE / 2 };
  const r = await dragOver(m, entryKey("tab", m.id.a), [{ x: centre.x + 2, y: centre.y }, centre]);
  try {
    await new Promise((done) => setTimeout(done, 450));
    r.c.move(centre.x + 1, centre.y);
    const held = readDrag(r.c);
    assert.equal(held.drop.type, "folder");
    assert.equal(held.marks.folderTarget, entryKey("tab", m.id.t1));
    assert.equal(held.marks.line, null);
  } finally {
    r.c.end(false);
  }
});
