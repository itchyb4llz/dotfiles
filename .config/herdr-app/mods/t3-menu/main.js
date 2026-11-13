// Context menus, one per thing (docs/research/context-menu-plan.md). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "agent" | "snooze" | "checkout" | "machine", target }: which thing, not what it offers.
// The agent's Snooze opens its times beside it, as T3's MenuSub (docs/research/submenu-plan.md): a second popup with
// props { tab: "snooze", target, parents, lit }, `parents` the menus it hangs off, `lit` the row lit when keys opened it.
// ↑/↓, Home, End and typeahead move, Enter runs, Esc closes. An item is [label, command, args, hint, group];
// a command "worktree" opens the worktree dialog instead.
// t3-menu: Herdr's menu (mod.clone), with a tab's and a pane's Close going through the tab bar (t3-tabs), which asks first
// while a program runs and leaves first, so Herdr's pick of a neighbour never shows. Beyond the shipped one: T3's measures and
// groups, the list's moves (shared/list.js, the one way every popup's list moves), Copy address and path, close()'s stamp, and
// the agent's, a checkout's and a machine's menus with the Snooze times.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, agents, spaces, panes, exec, setShared, shared, layout, settings } from "herdr";
import { menuJump, dir } from "./list.js";
import { subPlace, hoverRow, subOpened, subLeft } from "./submenu.js";
import { placeOf } from "./project.js";
import { presets } from "./snooze-presets.js";
import { ownStatus, stillSettled, subAgents, treeStatus } from "./tree.js";
import { pinList } from "./pins.js";
import { sidebarParts } from "./sidebar.js";
import { KEY } from "./store.js";

// The submenus open, [{ id, parents }], as win98's: a menu learns its submenu closed, and closes what hangs off it.
const chain = () => /** @type {{ id: string, parents: string[] }[]} */ (shared(KEY.menuChain) ?? []);

// Closes a submenu and every one opened from it.
function closeTree(id) {
  const all = chain(), doomed = [id, ...all.filter((m) => m.parents.includes(id)).map((m) => m.id)];
  for (const d of doomed.reverse()) closeOverlay(d);
  setShared(KEY.menuChain, all.filter((m) => !doomed.includes(m.id)));
}

// A menu's measures, as T3's: 220 wide, padding 4, rows 28, a rule 9 (4 above and below it).
const WIDTH = 220, PAD = 4, ROW = 28, RULE = 9;
// Where row `i` starts below the menu's top, its rules included.
const rowTop = (list, i) => PAD + i * ROW + list.slice(1, i + 1).filter((it, j) => it[4] !== list[j][4]).length * RULE;
const zoom = () => Number(settings()?.zoom) || 1;

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// The nearest live agent above `address`, through what isn't one (a shell between them), as the tab bar reads it.
function above(address, all, every) {
  const byAddress = new Map(all.map((k) => [k.address, k])), seen = new Set();
  let k = byAddress.get(byAddress.get(address)?.parent);
  while (k?.state === "live" && !seen.has(k.address)) {
    const a = every.find((x) => x.address === k.address);
    if (a) return a;
    seen.add(k.address);
    k = byAddress.get(k.parent);
  }
  return null;
}

// An agent's menu, wherever it's right-clicked (an Inbox card, an Agents row, the tab bar's title): what it can do now, as
// T3's thread actions. Settle and Snooze are the Inbox's (docs/adr/0002): with Lists chosen they aren't offered.
function agentItems(address) {
  const all = terminals(), every = agents(), k = all.find((t) => t.address === address), a = every.find((x) => x.address === address);
  if (!k) return [];
  const inbox = sidebarParts(layout()).stack?.active !== "lists";
  const kids = subAgents(every, all)(address), own = ownStatus(a?.status, address, all);
  const busy = [own, ...kids].some((s) => s === "working" || s === "blocked");
  const parent = k.parent && all.find((t) => t.address === k.parent);
  const head = a && above(address, all, every);
  // Rename names the tab: only for its lone agent, whose name the tab's would be, and not when Pi names it (name.js).
  const heads = a ? every.filter((x) => x.tab === a.tab && above(x.address, all, every)?.tab !== a.tab) : [];
  const rename = heads.length === 1 && heads[0] === a && !k.labels?.["pi.session"];
  const pinned = pinList().includes(address), napping = Number(k.labels?.snoozed) > Date.now();
  // The settle key acts on the agent in view, so its key shows only there.
  const inView = every.find((x) => x.focused)?.address === address;
  return grouped(
    [
      ...(a && !head ? [[pinned ? "Unpin" : "Pin", `t3-tabs.${pinned ? "unpin" : "pin"}:${address}`, {}]] : []),
      ...(inbox && a && !busy ? [[stillSettled(k, own, kids) ? "Un-settle" : "Settle", `t3-tabs.settle:${address}`, {}, inView ? shortcut("t3-tabs.settle") : ""]] : []),
      ...(inbox && a ? napping ? [["Wake", `t3-tabs.wake:${address}`, {}]] : treeStatus(own, kids) !== "blocked" ? [["Snooze", "snooze", { address }]] : [] : []),
    ],
    [
      ...(rename ? [["Rename", "tab.rename", { id: a.tab }]] : []),
      ["Copy address", "copy", { text: address }],
      ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: address }]] : []),
    ],
    a ? [["Close", "pane.close", { pane: a.pane }]] : [],
  );
}

// Groups in T3's order (where to, state, names and copies, worktrees, ending), a rule between two that show. An item is
// [label, command, args, hint, group]; a hint of "" shows none.
const grouped = (...groups) => groups.flatMap((g, n) => g.map((it) => [it[0], it[1], it[2], it[3], n]));

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return grouped(
        inTab
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : [],
        [
          // To tell an agent which terminal: the address shows where a key would.
          ...(term ? [["Copy address", "copy", { text: term.address }]] : []),
          ...(term
            ? [
                toProgram
                  ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                  : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
              ]
            : []),
          ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ],
        inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : [],
      );
    }
    case "tab": {
      // Where its space is now, as the space's mark and folder say; with no space named, tab.new takes the active one.
      const sp = spaces().find((s) => (tg.space ? s.id === tg.space : s.active));
      return grouped(
        [["New tab", "tab.new", { space: tg.space, folder: sp && placeOf(sp, panes()) }]],
        [["Rename", "tab.rename", { id: tg.id }]],
        [["Close", "tab.close", { id: tg.id }]],
      );
    }
    case "agent":
      return agentItems(tg.address);
    // Its Snooze: the card's times, when each wakes on the right, then Custom (the Inbox's dialog).
    case "snooze":
      return grouped(presets(Date.now()).map((p) => [p.label, `t3-tabs.snooze:${tg.address}:${p.at}`, {}, p.when]), [["Custom…", "custom-snooze", { address: tg.address }]]);
    case "space": {
      const s = spaces().find((s) => s.id === tg.id);
      const folder = s && place(s);
      return grouped(
        [["New tab", "tab.new", { space: tg.id, folder }]],
        [["Rename", "space.rename", { id: tg.id }], ...(folder ? [["Copy path", "copy", { text: folder }, ""]] : [])],
        git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : [],
        [...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []), ["Close", "space.close", { id: tg.id }]],
      );
    }
    // A repo's checkout with no space open: the dim row in Spaces, as T3's project folder (New thread, Copy path).
    case "checkout":
      return grouped([["Open", "space.new", { folder: tg.folder, machine: tg.machine ?? "" }]], [["Copy path", "copy", { text: tg.folder }, ""]]);
    // A machine's heading in Spaces: its + and, when its core was rebuilt, its Connect.
    case "machine":
      return grouped([
        ...(tg.connected ? [["New space here", "space.new", { machine: tg.machine ?? "" }]] : []),
        ...(tg.connect ? [["Connect", `t3-spaces.reconnect:${tg.machine}`, {}]] : []),
      ]);
    default:
      return [];
  }
}

// Null: a Snooze time, drawn as the card's menu draws them, with none.
function menuIcon(command, label, args) {
  if (command === "copy") return "mods/t3-menu/icons/copy.svg";
  if (command.startsWith("t3-tabs.snooze:") || command === "custom-snooze") return null;
  const own = command.startsWith("t3-tabs.settle") ? (label === "Settle" ? "check" : "undo") : command.startsWith("t3-tabs.pin:") ? "pin"
    : command.startsWith("t3-tabs.unpin:") ? "pin-off" : command === "snooze" ? "alarm-clock" : command.startsWith("t3-tabs.wake:") ? "alarm-clock-off" : null;
  if (own) return `mods/t3-menu/icons/${own}.svg`;
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command === "space.new" && args?.folder ? "folder"
    : command.endsWith(".new") ? "plus" : command === "worktree" ? (args?.action === "remove" ? "x" : "git-branch") : command.startsWith("t3-spaces.reconnect:") ? "server"
    : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  // A layout's own keys too: Settle's is the herdr-t3 layout's.
  const k = keys().find((b) => (b.section === "global" || b.section?.startsWith("layout:")) && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    // As T3's, nothing is lit until a key or the pointer gets there.
    const p = props();
    this.at = p?.lit ?? -1;
    this.git = null;
    // The submenu's pointer state (submenu.js), the one open { id, row }, and each row's bounds as the pointer last found it.
    this.s = {};
    this.sub = null;
    this.rows = [];
    // Where it opened: the pointer, for placing a submenu keys open before the pointer has found its row.
    this.origin = globalThis.window?.mouse_position?.();
    // A menu opened starts the chain over: one closed by a click beside it leaves stale ids.
    if (!p?.parents?.length && chain().length) setShared(KEY.menuChain, []);
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  // For the control that opened it: a press on it that closed this mustn't reopen it (justClosed in focus.js).
  // A submenu leaves the chain; a menu closes its submenu with it.
  async close() {
    const p = props() ?? {};
    if (p.parents?.length) { if (chain().some((m) => m.id === p.overlay)) setShared(KEY.menuChain, chain().filter((m) => m.id !== p.overlay)); }
    else setShared("t3-menu.closed", Date.now());
    if (this.sub) closeTree(this.sub.id);
  }

  // Row `i`'s Snooze times beside it. `lit`: keys opened it, so its first row is lit, as Base UI's.
  openSub(i, lit) {
    this.closeSub();
    const p = props() ?? {}, list = items(p, this.git), z = zoom(), it = list[i];
    // shortcut: with no row seen yet (keys only), the row is placed from the pointer where the menu opened, as Herdr opens it
    // there; a menu Herdr pushed back into the window puts its submenu off by as much. Upgrade if Herdr reports where an element is.
    const o = this.origin ?? { x: 0, y: 0 };
    const b = this.rows[i] ?? { x: o.x + PAD * z, y: o.y + rowTop(list, i) * z, width: (WIDTH - 2 * PAD) * z, height: ROW * z };
    const times = items({ tab: "snooze", target: it[2] }, null), h = rowTop(times, times.length) + PAD + 2;
    // Herdr keeps a popup in the window, but doesn't flip it: subPlace does, in the menu's own px.
    const at = subPlace({ x: b.x / z, y: b.y / z, width: b.width / z, height: b.height / z }, WIDTH, 0, globalThis.window.viewport_size().width / z);
    const parents = [...(p.parents ?? []), p.overlay];
    const id = openOverlay({ mod: "t3-menu", kind: "popup", width: WIDTH, height: h, at: { x: at.x * z, y: at.y * z },
      props: { tab: "snooze", target: it[2], parents, ...(lit ? { lit: 0 } : {}) } });
    setShared(KEY.menuChain, [...chain(), { id, parents }]);
    this.sub = { id, row: i };
    subOpened(this.s, it[1], { x: at.x * z, y: at.y * z, width: WIDTH * z, height: h * z }, at.side);
  }

  // Its submenu closed: the keyboard comes back here.
  closeSub() {
    if (!this.sub) return;
    closeTree(this.sub.id);
    this.sub = null;
    subOpened(this.s, null);
    this.handle.focus();
  }

  choose(i, cx, lit = false) {
    const it = /** @type {any} */ (items(props(), this.git)[i]);
    if (!it) return;
    // Its times, beside it: this stays open.
    if (it[1] === "snooze") return this.openSub(i, lit);
    // The whole chain closes, submenu and the menus it hangs off.
    closeOverlay(props()?.overlay);
    for (const id of [...(props()?.parents ?? [])].reverse()) closeOverlay(id);
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    // The item keeps Herdr's command, for its icon, its divider and its key; only where it goes changes.
    else if (it[1] === "tab.close") run(`t3-tabs.close-tab:${it[2].id}`);
    else if (it[1] === "pane.close") run(`t3-tabs.close-pane:${it[2].pane}`);
    else if (it[1] === "copy") cx.write_to_clipboard(it[2].text);
    else if (it[1] === "custom-snooze") openOverlay({ mod: "t3-inbox", kind: "dialog", frame: "none", width: 384, props: { customSnooze: it[2].address, answer: "t3-tabs.snooze" } });
    else run(it[1], it[2]);
  }

  render() {
    const t = theme();
    const list = items(props(), this.git), p = props() ?? {};
    // Its submenu closed itself (← or Esc in it, a click beside it): the keyboard comes back here.
    if (this.sub && !chain().some((m) => m.id === this.sub.id)) {
      this.sub = null;
      subOpened(this.s, null);
      this.handle.focus();
    }
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(4)
      .bg(t.popover)
      .text_size(14)
      // Off the menu, nothing pending opens; a submenu open stays.
      .on_hover((on) => { if (!on) subLeft(this.s); })
      .on_key_down((e, cx) => {
        if (e.key === "enter") { if (this.at >= 0) this.choose(this.at, cx, true); }
        // A submenu's ← goes back to its menu, as its Esc does.
        else if (e.key === "escape" || (dir(e) === "left" && p.parents?.length)) closeOverlay(p.overlay);
        else if (dir(e) === "right") { if (list[this.at]?.[1] === "snooze") this.openSub(this.at, true); }
        else {
          const to = menuJump(this, e, list.map((it) => it[0]), this.at);
          if (to < 0) return;
          this.at = to;
        }
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && list[i - 1][4] !== it[4], el => el.child(div().mx(8).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(28)
            .px(8)
            .gap(8)
            .rounded(4)
            .items_center()
            .justify_between()
            // Only what deletes something is red, in words, as T3's destructive item: a Close asks first while a program runs.
            .text_color(it[1] === "worktree" && it[2].action === "remove" ? t.ansi1 : t.foreground)
            // As T3's MenuSubTrigger, lit while its submenu is open.
            .when(i === this.at || i === this.sub?.row, (el) => el.bg(t.selected))
            .on_hover((on, cx) => { const to = on ? i : this.at === i ? -1 : this.at; if (to !== this.at) { this.at = to; cx.notify(); } })
            .on_mouse_move((e, cx) => {
              this.rows[i] = e.bounds;
              hoverRow(this.s, it[1] === "snooze" ? it[1] : null, e, cx, (key, _row, cx) => { if (key) this.openSub(i, false); else this.closeSub(); cx.notify(); });
            })
            .on_click((_e, cx) => this.choose(i, cx))
            // As T3's MenuItem: the icon hangs 2px into each side's padding and gap.
            .when(Boolean(menuIcon(it[1], it[0], it[2])), (el) => el.child(svg(menuIcon(it[1], it[0], it[2])).size(16).mx(-2).flex_none().text_color(t.muted)))
            .child(div().flex_1().min_w(0).truncate().child(it[0]))
            // T3's MenuSubTrigger ends in its chevron, 80% opaque, 2px into the padding.
            .child(it[1] === "snooze" ? svg("mods/workspace-chrome/chevron-right.svg").size(16).mr(-2).flex_none().text_color(t.muted).opacity(0.8)
              : div().flex_none().text_size(12).font_medium().text_color(t.dim).child(it[3] ?? (it[1] === "copy" ? it[2].text : shortcut(it[1], it[2]))))),
        ),
      );
  }
}
