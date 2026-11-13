// Where the layout keeps what outlives a frame, and under what name: docs/internals/storage.md. scripts/sync.sh copies this
// to the mods that use it.
import { shared, setShared } from "herdr";

// Every shared key the layout's mods keep data under: `<mod>.<name>` when one mod writes it, `t3.<name>` when several do or it
// is the layout's own. Code names a key only through here.
export const KEY = {
  settings: "t3.settings", pins: "t3.pins", notice: "t3.notice", focus: "t3.focus", spaceIcons: "t3.spaceIcons", agentOrder: "t3.agentOrder", panels: "t3.panels",
  home: "t3-tabs.home", undo: "t3-tabs.undo", unsettled: "t3-tabs.unsettled", compact: "t3-tabs.compact", recent: "t3-tabs.recent",
  inboxRows: "t3-inbox.rows", agentsRows: "t3-agents.rows", actions: "t3-actions.actions", menuChain: "t3-menu.chain",
};

// Each page keeps its own line mode; copies of this module run in each mod's localStorage.
export const wrapLines = () => localStorage.getItem("lines.wrap") !== "false";
/** @param {boolean} on */
export const setWrapLines = (on) => localStorage.setItem("lines.wrap", String(on));

/** Seed each page's preferences once; old shared values stay until every installed page has had a chance to start. */
export function migratePagePrefs() {
  const wrap = shared("t3.wrap") ?? shared("review.prefs")?.wrap, width = shared("t3.navWidth");
  if (localStorage.getItem("lines.wrap") === null && typeof wrap === "boolean") localStorage.setItem("lines.wrap", String(wrap));
  if (localStorage.getItem("nav.width") === null && width != null) localStorage.setItem("nav.width", String(width));
  for (const key of ["review.reveal", "t3-files.reveal"]) if (shared(key) != null) setShared(key, null);
}

// Old name, new name, and whether the value goes along (a cache or a passing value doesn't: the old key only goes).
// shortcut: entries stay until every install has updated once; drop them then.
/** @type {[string, string, boolean][]} */
const RENAMED = [
  ["agents.pins", KEY.pins, true], ["t3-home.space", KEY.home, true], ["t3-actions", KEY.actions, true], ["bar.compact", KEY.compact, true],
  ["t3-inbox.notice", KEY.notice, false], ["t3-inbox.undo", KEY.undo, false], ["t3-inbox.unsettled", KEY.unsettled, false],
  ["space.icons", KEY.spaceIcons, false], ["t3-agent-order", KEY.agentOrder, false], ["t3-focus", KEY.focus, false],
  ["t3-picker.back", KEY.recent, false],
];

// Nothing in it: null, or an empty list or record, as a list nothing was ever pinned to.
const empty = (v) => v == null || (typeof v === "object" && Object.keys(v).length === 0);

// Moves what's under an old name to its new one, once: the new name's value wins if it holds something. Each mod that can run alone
// (t3-tabs, t3-inbox, t3-actions) calls it in init, before anything is written.
export function migrate() {
  for (const [old, now, keep] of RENAMED) {
    const value = shared(old);
    if (value == null) continue;
    if (keep && empty(shared(now))) setShared(now, value);
    setShared(old, null);
  }
}

// The same for a mod's own localStorage: [[old, new], …].
export function migrateLocal(pairs) {
  for (const [old, now] of pairs) {
    const value = localStorage.getItem(old);
    if (value === null) continue;
    if (localStorage.getItem(now) === null) localStorage.setItem(now, value);
    localStorage.removeItem(old);
  }
}
