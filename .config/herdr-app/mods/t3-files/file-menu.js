// A file or folder row's right-click menu, one for the Files and Review pages (docs/adr/0013): the items by what the row is
// (fileMenuItems), their shared actions, and the menu drawn in the page as T3's menu measures (t3-menu's: 220 wide, 28 rows,
// 4 in, radius 8). In the page, not t3-menu's overlay: Review also runs alone in Herdr's own layout, which has no t3-menu.
// scripts/sync.sh copies this to both mods.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, run, notify, exec } from "herdr";
import { step } from "./list.js";

export const MENU_W = 220, MENU_ROW = 28;

/**
 * The items, in order, for a row on `page` ("files" or "review"): a folder (`dir`) has none that open it; `remote`, on another
 * machine, none that run here; `agent` is the space's agent to mention, if any. Mark reviewed or unreviewed (`reviewed`)
 * is Review's own. Each is `{ id, label, icon }`; the page runs it.
 */
/** @param {{ page: string, dir?: boolean, remote?: boolean, platform?: string, agent?: any, reviewed?: boolean }} row */
export function fileMenuItems({ page, dir = false, remote = false, platform, agent = null, reviewed = false }) {
  const mac = platform === "macos";
  return [
    { id: "copy-path", label: "Copy path", icon: "copy" },
    { id: "copy-relative", label: "Copy relative path", icon: "copy" },
    agent && { id: "mention", label: "Mention in agent", icon: "at-sign" },
    !remote && mac && { id: "reveal", label: "Reveal in Finder", icon: "folder-open" },
    !remote && !dir && (mac || platform === "linux") && { id: "open", label: "Open in default app", icon: "external-link" },
    page === "review" && { id: reviewed ? "unreview" : "review", label: reviewed ? "Mark unreviewed" : "Mark reviewed", icon: "square-check" },
  ].filter(Boolean);
}

// The agent a mention goes to: the space's focused one, else one in its tab in view, else its first.
export function agentFor(spaceId) {
  const sp = spaces().find((s) => s.id === spaceId), mine = agents().filter((a) => a.space === spaceId), tab = sp?.tabs.find((c) => c.active)?.id;
  return mine.find((a) => a.focused) ?? mine.find((a) => a.tab === tab) ?? mine[0] ?? null;
}

/** What the items both pages have do: `abs` the row's path, `rel` its path from the space's folder. False for another item. */
export function runCommon(id, { abs, rel, agent, platform }, cx) {
  if (id === "copy-path") cx.write_to_clipboard(abs);
  else if (id === "copy-relative") cx.write_to_clipboard(rel);
  else if (id === "mention") mention(rel, agent.address, cx);
  else if (id === "reveal") exec("open", ["-R", abs]);
  else if (id === "open") exec(platform === "macos" ? "open" : "xdg-open", [abs]);
  else return false;
  return true;
}

// Into the agent's input as a paste, never sent: the clipboard carries it and gets its text back. Paste reads the clipboard a
// moment later, so it's put back after 150 ms. A clipboard holding no text (an image) isn't touched.
export function mention(path, address, cx) {
  const previous = cx.read_from_clipboard();
  if (previous === undefined) {
    notify({ title: "The clipboard holds something that isn't text", body: "Mention in agent would replace it. Copy relative path, then paste it yourself.", level: "warning" });
    return;
  }
  cx.write_to_clipboard(`@${path} `);
  run("pane.focus", { terminal: address });
  run("terminal.paste");
  cx.spawn(async (cx) => { await cx.sleep(150); cx.write_to_clipboard(previous); });
}

/**
 * The menu where it was pressed (`view.menu`: `{ x, y, at }` in the page, kept inside `size`), closed by a press beside it or
 * Escape. `items` carry `run(cx)` and maybe a `hint`; `handle` takes the keyboard while it's open. `mod` names the icons' folder.
 */
/** @param {any} view @param {any} t @param {string} mod @param {any[]} items @param {any} handle @param {{ width: number, height: number }} size */
export function fileMenuView(view, t, mod, items, handle, size) {
  const m = view.menu, h = items.length * MENU_ROW + 8;
  const x = Math.max(4, Math.min(m.x, size.width - MENU_W - 4)), y = Math.max(4, Math.min(m.y, size.height - h - 4));
  const close = (cx) => { view.menu = null; cx.notify(); };
  const choose = (it, cx) => { close(cx); it.run(cx); };
  return div().id("file-menu-backdrop").absolute().inset_0()
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); close(cx); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); close(cx); })
    .child(v_flex().id("file-menu").absolute().left(x).top(y).w(MENU_W).p(4).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg().text_size(14)
      .track_focus(handle)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => {
        cx.stop_propagation();
        if (e.key === "escape") return close(cx);
        if (e.key === "enter") { const it = items[m.at]; if (it) choose(it, cx); return; }
        const to = step(e, m.at, items.length);
        if (to >= 0) { m.at = to; cx.notify(); }
      })
      .children(items.map((it, i) => h_flex().id(`file-menu-${it.id}`).h(MENU_ROW).px(8).gap(8).rounded(4).items_center()
        .when(i === m.at, (el) => el.bg(t.selected))
        .on_hover((on, cx) => { const to = on ? i : m.at === i ? -1 : m.at; if (to !== m.at) { m.at = to; cx.notify(); } })
        .on_click((_e, cx) => choose(it, cx))
        .child(svg(`${mod}/icons/${it.icon}.svg`).size(16).mx(-2).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(it.label))
        .when(Boolean(it.hint), (el) => el.child(div().flex_none().text_size(12).font_medium().text_color(t.dim).child(it.hint))))));
}
