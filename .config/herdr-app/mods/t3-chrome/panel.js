// The space panel (docs/adr/0011, 0012): one `panel` column at the window's right, its pages the children of the `panel-body`
// stack, as in Herdr's own main layout. Shown or hidden, which page and wide or not are the layout's clicks; each space keeps its own.
import { layout, run, spaces, shared, setShared } from "herdr";
import { KEY } from "./store.js";

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).reduce((hit, c) => hit ?? find(c, id), null);

/** { open, page, pages, wide }: pages are the stack's children ids, in order (`review` only where the extra is installed). */
export function panelState() {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body"), work = find(root, "work");
  return { open: Boolean(panel && !panel.hidden), page: body?.active ?? null, pages: (body?.children ?? []).map(c => c.id), wide: Boolean(panel && work?.hidden) };
}

export function showPage(page) {
  if (!panelState().pages.includes(page)) return false;
  run("layout.select", { stack: "panel-body", child: page });
  run("layout.show", { id: "panel" });
  return true;
}

// Closing it gives the work column back, if the panel had taken its place.
export function hidePanel() {
  const s = panelState();
  if (s.wide) run("layout.show", { id: "work" });
  run("layout.hide", { id: "panel" });
}

/** A page's own entry: opens the panel on it, or closes the panel already showing it. Without a page, the panel on its last one. */
export function togglePanel(page) {
  const s = panelState();
  if (s.open && (!page || s.page === page)) hidePanel();
  else if (page) showPage(page);
  else if (s.page) showPage(s.page);
}

// The panel over the whole work area, the tab bar included, and back: for a split diff or a long file.
export function toggleWide() {
  const s = panelState();
  run(s.wide ? "layout.show" : "layout.hide", { id: "work" });
}

const same = (a, b) => Boolean(a) && a.open === b.open && a.page === b.page && a.wide === b.wide;

// The panel as `space` left it, in this layout's pages; closed if it never had one.
function keptFor(space, s) {
  const kept = (/** @type {Record<string, any>} */ (shared(KEY.panels) ?? {}))[space];
  return { open: Boolean(kept?.open), page: s.pages.includes(kept?.page) ? kept.page : s.page, wide: Boolean(kept?.open && kept?.wide) };
}

function lay(want) {
  run("layout.select", { stack: "panel-body", child: want.page });
  run(want.wide ? "layout.hide" : "layout.show", { id: "work" });
  run(want.open ? "layout.show" : "layout.hide", { id: "panel" });
}

/**
 * Lays the panel out as `space` left it in the same go as the select that will show that space, so its first frame has it
 * (going Home: t3-tabs' `arrive`). Until spaces() catches up (1s at most), syncPanel leaves it be rather than recording it
 * for, or restoring, the space still listed as active.
 */
export function restorePanel(view, space) {
  const s = panelState();
  if (!s.pages.length) return;
  const want = keptFor(space, s);
  view.panelSpace = space;
  view.panelPending = { want, until: Date.now() + 1000, space };
  if (!same(want, { open: s.open, page: s.page, wide: s.wide })) lay(want);
}

/**
 * Each space keeps its panel, as T3 keeps one per thread: switching shows that space's (closed if it never had one), and whatever
 * opens, closes, pages or widens it is recorded. The width stays the window's. Called from render by one copy that always shows
 * (t3-tabs' `keys`); its first frame starts from what shows rather than restoring.
 */
export function syncPanel(view) {
  const s = panelState(), space = spaces().find(p => p.active);
  if (!space || !s.pages.length) { view.panelSpace = null; return; }
  // Laid out ahead of a select (restorePanel) that spaces() doesn't show yet.
  if (view.panelPending?.space && view.panelPending.space !== space.id && Date.now() < view.panelPending.until) return;
  const now = { open: s.open, page: s.page, wide: s.wide };
  if (space.id !== view.panelSpace) {
    const first = view.panelSpace == null;
    view.panelSpace = space.id; view.panelPending = null;
    const want = keptFor(space.id, s);
    if (!first && !same(want, now)) {
      // The layout's clicks land after this frame: until then (or until something else wins) what shows isn't a choice.
      view.panelPending = { want, until: Date.now() + 1000 };
      lay(want);
      return;
    }
  }
  if (view.panelPending) {
    if (!same(view.panelPending.want, now) && Date.now() < view.panelPending.until) return;
    view.panelPending = null;
  }
  // shortcut: a closed space's entry stays; prune by spaces() if the record ever grows noticeably.
  const all = /** @type {Record<string, any>} */ (shared(KEY.panels) ?? {});
  if (!same(all[space.id], now)) setShared(KEY.panels, { ...all, [space.id]: now });
}
