// The space panel's Files page (docs/adr/0011, docs/research/space-panel-plan.md): the active space's folder, read-only, as
// one block: the file picked on the left, the tree on the right by the window's edge, the split between them dragged.
// One copy serves every space, here or on another machine: what each one shows is kept by its id.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState, TextView } from "gpui-base";
import { spaces, nextCommand, exec, readTextFile, theme, settings, shared, setShared, appHome, window } from "herdr";
import * as fs from "fs/promises";
import uFuzzy from "./vendor/ufuzzy.js";
import { panelState, hidePanel } from "./panel.js";
import { step, scrollList } from "./list.js";
import { fileIcon } from "./file-icons.js";
import { TREE_ROW, treeRows, rowAt, treeKey, treeList, treeRow, revealRow } from "./file-tree.js";
import { withNav, navToggle, foldAllButton, ghostButton, navOpen, setNavOpen, holdWidth } from "./nav-column.js";
import { fileMenuItems, fileMenuView, agentFor, runCommon } from "./file-menu.js";
import { migratePagePrefs, wrapLines, setWrapLines } from "./store.js";
import { loadingState, emptyState, errorBar } from "./panel-states.js";
import { LIST, IGNORED, PROBE, REMOTE_SEARCH, RANKED, join, parentOf, nameOf, ancestors, parseListing, parseStatus, parseIgnored, markIgnored, folderEntries, terms, narrows,
  filterPaths, rank, kindOf, languageOf, readProblem, failedRead, ticket } from "./model.js";

const MOD = "mods/t3-files";
const RESULTS = 200, REMOTE_IMAGE = 512 * 1024, TEXT_MAX = 1024 * 1024;
// Expand all lists at most this many folders, Git-ignored ones left closed, as T3's.
// shortcut: a folder past it stays closed; list more in batches if a big repo wants it all.
const EXPAND_MAX = 200;
// Asked again while it shows: here every 5 s, another machine every 10; a refresh that took long, 10 times as long, a minute at
// most. Nothing is watched: Herdr's folder watch can't be stopped once asked, and a hidden page runs nothing.
const LOCAL_EVERY = 5000, REMOTE_EVERY = 10000, SLOWEST = 60000;
const FULL = 3; // the spaces last shown that keep all they read; older ones keep their file, open folders and search
const CACHE = "cache/t3-files"; // under the app's home, where image() can read
const MARKDOWN = "t3-files.markdown"; // "code" once someone picked it; Preview otherwise

const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false"]; // keep reads from updating the index or filesystem-monitor state

const count = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const zoom = () => Number(settings()?.zoom) || 1;

// What one space's page knows and shows.
function blank(sp) {
  return { id: sp.id, root: sp.folder, on: sp.machine ?? null, git: undefined, entries: new Map(), expanded: new Set(), ignored: new Set(),
    marks: new Map(), dirs: new Set(), version: 0, file: null, view: null, lit: null, focus: null, query: "", at: -1, results: null, total: 0, paths: null };
}

export default class Files extends View {
  init(_props, cx) {
    migratePagePrefs();
    this.states = new Map();
    this.uf = new (/** @type {any} */ (uFuzzy))();
    this.treeHandle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search files" });
    this.search.on("change", (_e, cx) => { const st = this.current(); if (st && this.search.value() !== st.query) this.find(st, this.search.value(), cx); });
    this.search.on("submit", (_e, cx) => { const st = this.current(); const r = st?.results?.[st.at]; if (r) this.pick(st, r.path, cx); });
    this.handle = cx.focus_handle();
    this.navOpen = navOpen();
    // The width the code is laid out at, behind its room while that moves (codeView, nav-column.js holdWidth).
    /** @type {{ at?: number, want?: number, run?: number }} */
    this.codeHold = {};
    this.cached = new Set();
    // The state being worked for, and a count that moves each time that changes (going).
    this.awake = null; this.gen = 0;
    cx.spawn(async () => { await exec("rm", ["-rf", `${appHome()}/${CACHE}`]).catch(() => null); });
    // A hidden copy isn't drawn, so this is what sees it go out of view.
    cx.timer.every(1000, (cx) => { this.sync(cx); this.poll(cx); });
    // `t3-files.open:<path from the space's folder>` and `t3-files.search:<words>`, for keys and scripts (the demo's);
    // `t3-files.close`, cmd-w while it has the keyboard, closes the panel as T3's does.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand(), st = this.current(), at = c.indexOf(":"), [what, arg] = [c.slice(0, at), c.slice(at + 1)];
        if (c === "close") hidePanel();
        if (!st || at < 0) continue;
        if (what === "open") { this.open(st, arg, cx); this.reveal(st, arg, cx); }
        else if (what === "search") { this.search.set_value(arg); this.find(st, arg, cx); }
      }
    });
  }

  // Its images go with it; one a crash left is cleared at the next start.
  async close() {
    await Promise.all([...this.cached].map((f) => fs.unlink(`${appHome()}/${f}`).catch(() => null)));
  }

  current() {
    const sp = spaces().find((s) => s.active);
    return sp ? this.states.get(sp.id) : null;
  }

  // A space's state, made the first time and made again when its folder moves; the latest one last. The FULL last keep all
  // they read; older ones only how they were being read, and read again when back.
  stateFor(sp) {
    let st = this.states.get(sp.id);
    if (!st || st.root !== sp.folder || st.on !== (sp.machine ?? null)) { if (st) this.drop(st); st = blank(sp); }
    else if ([...this.states.keys()].at(-1) === sp.id) return st;
    this.states.delete(sp.id);
    this.states.set(sp.id, st);
    for (const old of [...this.states.values()].slice(0, -FULL)) this.states.set(old.id, this.slim(old));
    return st;
  }

  // What `st` read let go, for whatever still holds it too (a read under way): its editor, image and lists.
  drop(st) {
    st.view?.code?.release();
    if (st.view?.image) this.uncache(st.view.image);
    Object.assign(st, { view: null, entries: new Map(), ignored: new Set(), marks: new Map(), dirs: new Set(), rows: null, paths: null, lower: null, last: null, results: null });
  }

  // A space let go of, keeping its file, open folders and search's words.
  slim(st) {
    this.drop(st);
    return Object.assign(blank({ id: st.id, folder: st.root, machine: st.on }), { file: st.file, expanded: new Set(st.expanded), focus: st.focus, query: st.query });
  }

  // It works only while it shows: the page in the open panel, the window in front, for the active space. Shown, it reads at
  // once; hidden, answers still under way are dropped and nothing more is asked. A closed space's state goes.
  sync(cx) {
    const all = spaces(), sp = all.find((s) => s.active);
    for (const [id, st] of this.states) if (!all.some((s) => s.id === id)) { this.drop(st); this.states.delete(id); }
    const st = sp && this.shown() ? this.stateFor(sp) : null;
    if (st === this.awake) return;
    this.awake = st; this.gen++;
    if (!st?.root) return;
    if (st.git === undefined) this.load(st, cx); else this.recheck(st, cx);
  }

  // The page in the open panel, the window in front.
  shown() { const p = panelState(); return p.open && p.page === "files" && Boolean(window()?.active); }
  // Whether what started now may go on: `st` still the one worked for and in view, without having gone out of it since. It
  // asks the layout itself, as sync sees a hide only at its next tick; one it finds puts the page to sleep, so showing again
  // reads again.
  going(st) {
    const gen = this.gen;
    return () => {
      if (this.gen !== gen || this.awake !== st || !this.live(st)) return false;
      if (this.shown() && spaces().find((s) => s.active)?.id === st.id) return true;
      this.awake = null; this.gen++;
      return false;
    };
  }
  // A ticket (model.js) that also lapses once `st` stops showing.
  fresh(st, kind) { const t = ticket(st, kind), go = this.going(st); return () => t() && go(); }
  live(st) { return this.states.get(st.id) === st; }
  changed(st) { st.version++; st.rows = null; }

  // Git asked where the folder is, then the rest as a recheck: a space read again gets its file and search back too.
  load(st, cx) {
    const going = this.going(st);
    cx.spawn(async (cx) => {
      const top = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: st.root, on: st.on }).catch(() => null);
      if (!going()) return;
      const [dir, prefix] = top?.code === 0 ? top.stdout.split("\n") : [];
      st.git = dir ? { top: dir, prefix: prefix ?? "" } : null;
      this.recheck(st, cx);
    });
  }

  // Git's marks, and every folder shown listed again. The search's list of files is made again at its next word.
  async refresh(st, cx) {
    const go = this.going(st);
    if (!go() || st.git === undefined) return;
    const began = st.refreshed = Date.now();
    const shown = ["", ...st.expanded].filter((p) => p === "" || ancestors(p).every((a) => st.expanded.has(a)));
    await Promise.all([this.status(st), ...shown.map((p) => this.list(st, p))]);
    if (!go()) return;
    st.refreshed = Date.now(); st.took = st.refreshed - began; st.paths = null;
    cx.notify();
  }

  async status(st) {
    if (!st.git) return;
    const fresh = this.fresh(st, "status");
    const r = await exec("git", [...GIT, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: st.git.top, on: st.on }).catch(() => null);
    if (r?.code !== 0 || !fresh()) return;
    Object.assign(st, parseStatus(r.stdout, st.git.prefix));
    this.changed(st);
  }

  async list(st, rel) {
    const fresh = this.fresh(st, `list:${rel}`), dir = join(st.root, rel);
    if (!fresh()) return;
    const inIgnored = [rel, ...ancestors(rel)].some((p) => p && st.ignored.has(p));
    const [r, ig] = await Promise.all([
      exec("sh", ["-c", LIST, "files", dir], { on: st.on }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) })),
      st.git && !inIgnored ? exec("sh", ["-c", IGNORED, "files", dir, rel ? `${rel}/` : ""], { cwd: st.root, on: st.on }).catch(() => null) : null,
    ]);
    if (!fresh()) return;
    if (r.code !== 0) {
      if (rel) { st.entries.delete(rel); st.expanded.delete(rel); } else st.error = "This folder can't be listed.";
    } else {
      const entries = parseListing(r.stdout);
      st.entries.set(rel, entries);
      if (!rel) st.error = null;
      if (ig) {
        markIgnored(st.ignored, rel, entries, parseIgnored(ig.stdout));
      }
    }
    this.changed(st);
  }

  // While it shows (sync), asked again: every LOCAL_EVERY here or REMOTE_EVERY on another machine from the last refresh's end,
  // 10 times as long as that refresh took if longer, SLOWEST at most.
  poll(cx) {
    const st = this.awake;
    if (!st || st.git === undefined) return;
    const every = Math.min(SLOWEST, Math.max(st.on ? REMOTE_EVERY : LOCAL_EVERY, 10 * (st.took ?? 0)));
    if (Date.now() - (st.refreshed ?? 0) >= every) this.recheck(st, cx);
  }

  // Git, the folders shown and the file asked again. An image shown is copied whole each time, so it's left be: one changed
  // shows when it's picked again.
  recheck(st, cx) {
    st.refreshed = Date.now();
    cx.spawn(async (cx) => {
      await this.refresh(st, cx);
      // A search showing, found again, the lit result kept lit; each asks only while it shows.
      if (st.query) this.find(st, st.query, cx, st.results?.[st.at]?.path ?? null);
      if (st.file && !st.view?.image) this.open(st, st.file, cx, true);
    });
  }

  toggle(st, path, cx) {
    if (st.expanded.has(path)) st.expanded.delete(path);
    else {
      st.expanded.add(path);
      // A folder holding just a folder opens with it, as the tree shows them as one row.
      const go = this.going(st);
      cx.spawn(async (cx) => {
        for (let p = path, kids; p && go(); p = kids?.length === 1 && kids[0].dir ? join(p, kids[0].name) : null) {
          await this.list(st, p);
          kids = st.entries.get(p);
          if (kids?.length === 1 && kids[0].dir) st.expanded.add(join(p, kids[0].name));
        }
        if (!go()) return;
        this.changed(st);
        cx.notify();
      });
    }
    st.lit = null;
    this.changed(st);
    cx.notify();
  }

  // Opens the folders down to `path` (a file's, or a folder lit until the next click) and brings its row into view.
  reveal(st, path, cx) {
    for (const p of ancestors(path)) st.expanded.add(p);
    st.lit = path && path !== st.file ? path : null;
    this.changed(st);
    const go = this.going(st);
    cx.spawn(async (cx) => {
      for (const p of ancestors(path)) if (go() && !st.entries.has(p)) await this.list(st, p);
      if (!go()) return;
      // The space's folder is the tree's top.
      const id = `t3-files-tree-${st.id}`;
      if (path) revealRow(this, id, path); else this.scrollTop = { ...this.scrollTop, [id]: 0 };
      cx.notify();
    });
    cx.notify();
  }

  // A search result: the file opens, and the tree shows where it is.
  pick(st, path, cx) {
    st.query = ""; st.results = null; st.at = -1;
    this.search.set_value("");
    this.open(st, path, cx);
    this.reveal(st, path, cx);
  }

  // Shows a file; `again` reads it again where it may have changed, and leaves it as it was if it hasn't.
  open(st, rel, cx, again = false) {
    if (!again) {
      if (st.view?.code) st.view.code.release();
      st.file = rel; st.lit = null; st.view = { loading: true };
      this.changed(st);
      cx.notify();
    }
    const fresh = this.fresh(st, "file"), abs = join(st.root, rel), kind = kindOf(rel);
    if (!fresh()) return;
    cx.spawn(async (cx) => {
      const view = await this.read(st, abs, rel, kind, fresh).catch(() => ({ problem: "This file can't be read." }));
      if (view?.problem) view.failed = failedRead(view.problem);
      if (!view || !fresh() || st.file !== rel) return;
      const old = st.view;
      if (again && old && view.text !== undefined && view.text === old.text) return;
      if (old?.image && old.image !== view.image) this.uncache(old.image);
      if (view.text !== undefined && (kind === "text" || shared(MARKDOWN) === "code")) this.editor(view, rel);
      if (old?.code) old.code.release();
      st.view = view;
      cx.notify();
    });
  }

  /** @returns {Promise<any>} */
  async read(st, abs, rel, kind, fresh) {
    if (st.marks.get(rel) === "D" && !(st.entries.get(parentOf(rel)) ?? []).some((e) => e.name === nameOf(rel)))
      return { problem: "This file was deleted." };
    let size = null;
    if (st.on) {
      const p = await exec("sh", ["-c", PROBE, "probe", abs], { on: st.on });
      if (!fresh()) return null;
      if (p.code !== 0) return { problem: "This file can't be read." };
      const [bytes, nuls] = p.stdout.trim().split(" ").map(Number);
      size = bytes;
      if (kind !== "image" && bytes > TEXT_MAX) return { problem: "This file is larger than 1 MB, too large to preview." };
      if (kind !== "image" && nuls > 0) return { problem: "This is a binary file, so there's no text to show." };
    }
    if (kind === "image") {
      if (st.on && size > REMOTE_IMAGE) return { problem: `This image is larger than 512 KB, too large to bring over from ${st.on}.` };
      const name = `${CACHE}/${Date.now()}-${nameOf(rel).replace(/[^\w.-]/g, "_")}`, dest = `${appHome()}/${name}`;
      await fs.mkdir(`${appHome()}/${CACHE}`, { recursive: true }).catch(() => null);
      if (!fresh()) return null;
      if (st.on) {
        const r = await exec("base64", [abs], { on: st.on, timeout: 60000 });
        if (!fresh()) return null;
        if (r.code !== 0) return { problem: "This image can't be read." };
        const bin = /** @type {any} */ (globalThis).atob(r.stdout.replace(/\s+/g, "")), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await fs.writeFile(dest, bytes);
      } else {
        const r = await exec("cp", [abs, dest]);
        if (r.code !== 0) return { problem: "This image can't be read." };
      }
      if (!fresh()) { await fs.unlink(dest).catch(() => null); return null; }
      this.cached.add(name);
      return { image: name };
    }
    let text;
    try { text = await readTextFile(abs, { on: st.on }); }
    catch (e) { return { problem: readProblem(e) }; }
    if (text === null) return { problem: "This file isn't there anymore." };
    if (st.on && text.includes("\uFFFD")) return { problem: "This file isn't UTF-8 text, so there's nothing to show." };
    return { text };
  }

  uncache(name) {
    this.cached.delete(name);
    fs.unlink(`${appHome()}/${name}`).catch(() => null);
  }

  // The view's code, wrapped as the layout's Lines choice says (store.js), which it notes: the editor takes it only when made.
  editor(view, rel) {
    const t = theme();
    view.wrap = wrapLines();
    view.code = EditorState.new({ language: languageOf(nameOf(rel)), value: view.text, readonly: true, soft_wrap: view.wrap, font_family: /** @type {string} */ (settings().font_family), font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  // Every term in the path, case aside. Here, over the folder's whole list, kept until the next refresh; elsewhere, there.
  // `keep`: the path to keep lit, if it's still found.
  find(st, query, cx, keep = null) {
    st.query = query;
    if (!keep) st.at = 0;
    const words = terms(query), fresh = this.fresh(st, "search");
    if (!words.length) { st.results = null; cx.notify(); return; }
    if (!fresh()) return;
    cx.spawn(async (cx) => {
      let found, total;
      if (st.on) {
        await cx.sleep(200);
        if (!fresh()) return;
        const r = await exec("sh", ["-c", REMOTE_SEARCH, "search", query], { cwd: st.root, on: st.on }).catch(() => null);
        if (!fresh()) return;
        found = (r?.stdout ?? "").split("\n").filter(Boolean);
        total = found.length;
        st.more = total >= RANKED;
      } else {
        if (!st.paths) {
          const r = st.git
            ? await exec("git", [...GIT, "ls-files", "-co", "--exclude-standard", "-z"], { cwd: st.root }).catch(() => null)
            : await exec("sh", ["-c", "find . -name .git -prune -o -type f -print | sed 's|^\\./||' | head -n 200000"], { cwd: st.root }).catch(() => null);
          if (!fresh()) return;
          st.paths = (r?.stdout ?? "").split(st.git ? "\0" : "\n").filter(Boolean);
          st.lower = st.paths.map((p) => p.toLowerCase());
          st.last = null;
        }
        const from = narrows(query, st.last?.query) ? st.last.idx : null;
        const idx = await filterPaths(st.lower, words, from, () => cx.sleep(0), fresh);
        if (!idx) return;
        st.last = { query, idx };
        total = idx.length;
        found = idx.slice(0, total <= RANKED ? RANKED : RESULTS).map((i) => st.paths[i]);
        st.more = false;
      }
      st.results = found.length <= RANKED ? rank(this.uf, found, query, RESULTS) : found.slice(0, RESULTS).map((path) => ({ path, ranges: [] }));
      st.total = total;
      const kept = keep ? st.results.findIndex((r) => r.path === keep) : -1;
      st.at = kept >= 0 ? kept : Math.min(Math.max(keep ? 0 : st.at, 0), st.results.length - 1);
      cx.notify();
    });
    cx.notify();
  }

  // A row's menu: file-menu.js's items.
  menuItems(st, path) {
    const abs = join(st.root, path), agent = agentFor(st.id), platform = window()?.platform, dir = Boolean(this.rows(st).find((r) => r.path === path)?.dir);
    return fileMenuItems({ page: "files", dir, remote: Boolean(st.on), platform, agent }).map((it) => ({ ...it,
      hint: it.id === "copy-path" ? st.on ?? "" : it.id === "mention" ? agent.program?.name ?? "" : "",
      run: (cx) => runCommon(it.id, { abs, rel: path, agent, platform }, cx) }));
  }

  rows(st) { return st.rows ??= treeRows(folderEntries(st), (p) => st.expanded.has(p)); }

  render(cx) {
    const t = theme(), sp = spaces().find((s) => s.active);
    if (!sp) return div().id("t3-files").size_full();
    this.sync(cx);
    const st = this.stateFor(sp);
    // Lines changed: the editor made again, just after this draw, as an editor can't be made in one.
    const v = st.view;
    if (v?.code && v.wrap !== wrapLines()) cx.timer.after(0, (cx) => {
      if (st.view !== v || !v.code || v.wrap === wrapLines()) return;
      const old = v.code;
      this.editor(v, st.file);
      old.release();
      cx.notify();
    });
    // The search field shows this space's words.
    if (this.searchFor !== st.id) { this.searchFor = st.id; if (this.search.value() !== st.query) this.search.set_value(st.query); }
    const width = this.size?.width ?? 800;
    return v_flex().id("t3-files").relative().size_full().min_h(0).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.size = { width: size.width / zoom(), height: size.height / zoom() }; cx.notify(); })
      .on_mouse_down("right", (e, cx) => {
        if (!this.menuFor) return;
        this.menu = { path: this.menuFor, x: e.local_position.x / zoom(), y: e.local_position.y / zoom(), at: -1 };
        this.menuFor = null;
        this.handle.focus();
        cx.notify();
      })
      .child(this.toolbar(st, t))
      // What failed, under the toolbar: the folder's listing, or the file's read. Retry asks again.
      .when(Boolean(st.error), (el) => el.child(errorBar(t, "t3-files-error", st.error, (cx) => cx.spawn(async (cx) => this.refresh(st, cx)), this)))
      .when(Boolean(!st.error && st.view?.failed), (el) => el.child(errorBar(t, "t3-files-error", st.view.problem, (cx) => this.open(st, st.file, cx), this)))
      .child(div().flex_1().min_h(0).child(withNav(t, "t3-files", width, { content: this.content(st, t), head: this.searchHead(st, t), list: st.results ? this.found(st, t) : this.tree(st, t), open: this.navOpen })))
      .when(Boolean(this.menu), (el) => el.child(fileMenuView(this, t, MOD, this.menuItems(st, this.menu.path), this.handle, this.size ?? { width: 800, height: 600 })));
  }

  // The page's toolbar, across it, there with no file too: where the file is (the folder's name alone without one), Preview
  // or Code for Markdown, Wrap for code, and the tree's switch.
  toolbar(st, t) {
    const md = kindOf(st.file ?? "") === "markdown", code = shared(MARKDOWN) === "code";
    const parts = st.file?.split("/") ?? [];
    const crumb = (label, path, last) => div().id(`crumb-${path}`).flex_none().px(4).rounded(4).text_color(last ? t.foreground : t.muted)
      .when(!last, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.reveal(st, path, cx)))
      .child(label);
    const tab = (label, on, value) => div().id(`t3-files-${value}`).h(24).px(8).flex().items_center().rounded(8).text_size(12)
      .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { if (on) return; if (value === "code" && st.view?.text !== undefined && !st.view.code) this.editor(st.view, st.file); setShared(MARKDOWN, value); cx.notify(); })
      .child(label);
    return h_flex().id("t3-files-toolbar").h(40).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
        // The first word 16 in, as Review's scope button's: the toolbar's 8 and an xs button's 8 (a crumb's own 4, and 4 more).
        .child(h_flex().flex_1().min_w(0).overflow_hidden().items_center().text_size(12).pl(4)
          .when(Boolean(st.root), (el) => el.child(crumb(nameOf(st.root.replace(/\/$/, "")) || st.root, "", !st.file)))
          .children(parts.flatMap((part, i) => [div().flex_none().text_color(t.dim).child("/"), crumb(part, parts.slice(0, i + 1).join("/"), i === parts.length - 1)])))
        .when(md, (el) => el.child(h_flex().flex_none().gap(2).child(tab("Preview", !code, "preview")).child(tab("Code", code, "code"))))
        // The page's buttons 4 apart, as Review's.
        .child(h_flex().flex_none().gap(4).items_center()
          // Wrap or scroll long lines, this page's own choice.
          .when(Boolean(st.view?.code), (el) => el.child(ghostButton(t, MOD, "t3-files-wrap", "text-wrap", wrapLines() ? "Scroll long lines" : "Wrap long lines", (cx) => { setWrapLines(!wrapLines()); cx.notify(); }, { on: wrapLines(), view: this })))
          .child(navToggle(t, MOD, "t3-files-nav-toggle", this.navOpen, (cx) => { this.navOpen = !this.navOpen; setNavOpen(this.navOpen); cx.notify(); }, false, this)));
  }

  // The file: Preview or Code for Markdown, the code, an image or why there's none; with no file, a quiet line.
  content(st, t) {
    const v = st.view, md = kindOf(st.file ?? "") === "markdown", code = shared(MARKDOWN) === "code";
    if (!st.file) return emptyState(t, "t3-files-empty", `${MOD}/icons/file-text.svg`, "No file open", st.root ? "Pick one in the tree, or search for it." : "This space has no folder.");
    return div().size_full().min_h(0).min_w(0)
        .child(!v || v.loading ? loadingState(t, "t3-files-loading", "Loading the file…")
          // A read that failed is the error bar's (the toolbar's); a file there's nothing to show of says why, as an empty page.
          : v.problem && v.failed ? div()
          : v.problem ? emptyState(t, "t3-files-problem", `${MOD}/icons/file-text.svg`, nameOf(st.file), v.problem)
          : v.image ? div().size_full().p(16).flex().items_center().justify_center().child(image(v.image).max_w_full().max_h_full())
          : md && !code ? div().id("t3-files-md").size_full().overflow_y_scrollbar().px(24).py(16).child(TextView.markdown(`t3-files-md-${st.id}-${st.file}`, v.text).selectable(true).scrollable(false).text_size(14))
          // Laid out at the width its room last held (nav-column.js holdWidth), cut off or short of it while the room moves.
          : v.code ? this.codeView(v.code)
          : div());
  }

  codeView(code) {
    const hold = this.codeHold;
    return div().id("t3-files-code").size_full().min_w(0).overflow_hidden()
      .on_size_change((size, cx) => {
        const width = size.width / zoom();
        if (Math.abs(width - (hold.want ?? hold.at ?? -1)) < 1) return;
        holdWidth(hold, width, (ms, f) => cx.timer.after(ms, f));
        cx.notify();
      })
      // Always at the held width once known: switching between it and w_full laid the file out again, as long as the drag's step.
      .child(Editor.new(code).h_full().when(hold.at != null, (el) => el.w(hold.at)).when(hold.at == null, (el) => el.w_full()));
  }

  // The column's head: the search, as T3's ghost InputGroup, and Collapse all / Expand all. Its keys are the results'.
  searchHead(st, t) {
    const results = st.results;
    return h_flex().id("t3-files-search").flex_1().min_w(0).h_full().gap(4).items_center()
      .on_key_down((e, cx) => {
        if (e.key === "escape" && st.query) { st.query = ""; st.results = null; this.search.set_value(""); }
        else if (results?.length) { const to = step(e, st.at, results.length); if (to < 0) return; st.at = to; }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(svg(`${MOD}/icons/search.svg`).size(16).flex_none().text_color(t.dim))
      .child(Input.new(this.search).flex_1().h(28).text_size(12).text_color(t.foreground))
      .child(foldAllButton(t, MOD, "t3-files-fold-all", st.expanded.size === 0, (cx) => this.foldAll(st, cx), this));
  }

  // Collapse all while any folder is open; else open every folder, Git-ignored ones aside, EXPAND_MAX at most.
  foldAll(st, cx) {
    if (st.expanded.size) { st.expanded.clear(); this.changed(st); cx.notify(); return; }
    const go = this.going(st);
    cx.spawn(async (cx) => {
      const queue = [""];
      for (let n = 0; queue.length && n < EXPAND_MAX && go(); n++) {
        const rel = queue.shift();
        if (!st.entries.has(rel)) await this.list(st, rel);
        if (rel) st.expanded.add(rel);
        for (const e of st.entries.get(rel) ?? []) if (e.dir && !st.ignored.has(join(rel, e.name))) queue.push(join(rel, e.name));
      }
      if (!go()) return;
      this.changed(st);
      cx.notify();
    });
  }

  // The folder's tree, as T3's: a click opens a file or a folder; the keys move a ring, ↵ opens what it's on.
  tree(st, t) {
    if (!st.root || st.error) return div().p(8).text_size(12).text_color(t.dim).child(!st.root ? "This space has no folder." : "");
    if (!st.entries.has("")) return loadingState(t, "t3-files-tree-loading", "Loading files…");
    const rows = this.rows(st);
    if (!rows.length) return div().p(8).text_size(12).text_color(t.dim).child("This folder is empty.");
    const lit = st.lit ? rowAt(rows, st.lit) : -1, ringed = this.treeHandle.is_focused() ? rows.findIndex((r) => r.path === st.focus) : -1;
    const act = (r, cx) => { if (r.dir) this.toggle(st, r.path, cx); else this.open(st, r.path, cx); };
    const draw = (r, i) => {
      const mark = !r.dir && st.marks.get(r.path), open = r.dir && r.open;
      return treeRow(t, MOD, r, `row-${r.path}`, { selected: r.path === st.file || i === lit, focused: i === ringed, status: mark || undefined, dim: r.ignored || r.gone, struck: r.gone,
        trailing: r.dir && !open && st.dirs.has(r.path) ? div().size(6).mr(5).flex_none().rounded_full().bg(t.muted) : null })
        .on_click((_e, cx) => { st.focus = null; act(r, cx); })
        .on_mouse_down("right", () => { this.menuFor = r.path; });
    };
    return div().id("t3-files-tree").size_full().track_focus(this.treeHandle)
      .on_mouse_down("left", () => this.treeHandle.focus())
      .on_key_down((e, cx) => {
        const at = st.focus ? rows.findIndex((r) => r.path === st.focus) : rows.findIndex((r) => r.path === st.file);
        const k = treeKey(e.keystroke, rows, at);
        if (!k) return;
        if (k.at !== undefined) { st.focus = rows[k.at].path; revealRow(this, `t3-files-tree-${st.id}`, st.focus); }
        else { st.focus = (k.toggle ?? k.pick).path; act(k.toggle ?? k.pick, cx); }
        cx.stop_propagation();
        cx.notify();
      })
      .child(treeList(this, `t3-files-tree-${st.id}`, rows, draw).size_full());
  }

  // Search results: the name, then its folder dimmed, matched letters bright; at most 200, and how many more.
  found(st, t) {
    const results = st.results;
    if (!results.length) return div().p(8).text_size(12).text_color(t.dim).child("No matching files.");
    const pieces = (text, from, ranges, color) => {
      const out = [];
      let at = 0;
      for (const [a, b] of ranges) {
        const s = Math.max(a - from, at), e = Math.min(b - from, text.length);
        if (e <= s) continue;
        if (s > at) out.push(div().flex_none().text_color(color).child(text.slice(at, s)));
        out.push(div().flex_none().text_color(t.foreground).font_semibold().child(text.slice(s, e)));
        at = e;
      }
      if (at < text.length) out.push(div().flex_none().text_color(color).child(text.slice(at)));
      return out;
    };
    const draw = (i) => {
      const r = results[i], cut = r.path.lastIndexOf("/") + 1, dir = r.path.slice(0, Math.max(0, cut - 1));
      return h_flex().id(`found-${i}`).h(TREE_ROW).mx(2).px(6.4).gap(4.8).items_center().rounded(6).text_size(12).overflow_hidden().whitespace_nowrap()
        .when(i === st.at, (el) => el.bg(t.foreground + "1f"))
        .on_hover((on, cx) => { if (on && st.at !== i) { st.at = i; cx.notify(); } })
        .on_click((_e, cx) => this.pick(st, r.path, cx))
        .on_mouse_down("right", () => { this.menuFor = r.path; })
        .child(image(`${MOD}/${fileIcon(r.path)}`).size(16).flex_none())
        .child(h_flex().flex_none().children(pieces(r.path.slice(cut), cut, r.ranges, t.foreground)))
        .when(Boolean(dir), (el) => el.child(h_flex().min_w(0).overflow_hidden().children(pieces(dir, 0, r.ranges, t.dim))));
    };
    const shownAll = !st.more && st.total <= results.length;
    return v_flex().size_full().min_h(0)
      .child(div().flex_1().min_h(0).child(scrollList(this, "t3-files-found", { count: results.length, row: TREE_ROW, at: st.at, draw, wheeled: (keep) => { st.at = keep; } }).size_full()))
      .when(!shownAll, (el) => el.child(div().flex_none().px(8).py(6).text_size(11).text_color(t.dim).truncate()
        .child(`${results.length} of ${count(st.total)}${st.more ? "+" : ""} matches · type more to narrow`)));
  }

}
