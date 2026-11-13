// The space panel's navigation column, one for the Files and Review pages (docs/adr/0013): right of the content, ruled off
// on its left, its left edge dragged, a 40 head over what it lists. As T3's FileExplorerPane: 256 to start, 160 at least,
// at most 560 and never leaving the content less than 256. Each page keeps its width (`nav.width`) and whether its column
// is open (`nav.open`) in its own localStorage. scripts/sync.sh copies this to both mods.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings } from "herdr";
import { button as drawButton } from "./button.js";

export const NAV = 256, NAV_MIN = 160, NAV_MAX = 560, CONTENT_MIN = 256;

/** How wide the column may be in a page `body` wide: [least, most]. */
export const navRange = (body) => [NAV_MIN, Math.max(NAV_MIN, Math.min(NAV_MAX, body - CONTENT_MIN))];
/** The column's width in a page `body` wide: that page's own, kept within navRange. */
export function navWidth(body, kept = localStorage.getItem("nav.width")) {
  const [least, most] = navRange(body);
  return Math.min(most, Math.max(least, Number(kept) || NAV));
}

// Open until closed on this page.
export const navOpen = () => localStorage.getItem("nav.open") !== "false";
export const setNavOpen = (open) => localStorage.setItem("nav.open", String(open));

/** Follow the first width at once, then keep it until the room has held its latest width for 300ms.
 * Each page owns `hold`; `after(ms, f)` schedules `f(cx)` without retaining a render's context. */
export function holdWidth(hold, width, after) {
  if (hold.at == null) { hold.at = width; return; }
  hold.want = width;
  const run = hold.run = (hold.run ?? 0) + 1;
  after(300, (cx) => { if (run === hold.run && hold.at !== hold.want) { hold.at = hold.want; cx.notify(); } });
}

// The column's edge being dragged, on this page (each mod has its own copy): the pointer's x and the width it started from,
// and the width it's at now.
let drag = null;

/**
 * The page's `content`, and right of it, while `open`, the column: `head` in its 40 head, `list` under it. `id` names it;
 * `body` is the page's width. Its left edge drags, and the width it lands at stays on this page.
 */
/** @param {any} t @param {string} id @param {number} body @param {{ content: any, head: any, list: any, open: boolean }} parts */
export function withNav(t, id, body, { content, head, list, open }) {
  if (!open) return div().id(`${id}-solo`).size_full().min_w(0).child(content);
  const [least, most] = navRange(body), z = Number(settings()?.zoom) || 1, mine = drag?.id === id;
  const width = mine ? Math.min(most, Math.max(least, drag.width)) : navWidth(body);
  // Written once, on release. A pointer leaving the page lets go there.
  const end = (cx) => {
    if (drag?.id !== id) return;
    const to = Math.round(width);
    drag = null;
    if (to !== Math.round(navWidth(body))) localStorage.setItem("nav.width", String(to));
    cx.notify();
  };
  // Not Herdr's resizable group: it keeps its panels' sizes under its id and scales them with the page, so a resizing panel
  // drew the column a frame scaled, then a frame at its width again (a group named by the page's width), and twitched.
  // The pointer's positions are zoomed pixels.
  return h_flex().id(`${id}-split`).size_full().min_w(0)
    .when(mine, (el) => el.cursor_col_resize())
    .on_mouse_move((e, cx) => {
      if (drag?.id !== id) return;
      const to = drag.from - (e.position.x - drag.x) / z;
      if (to !== drag.width) { drag.width = to; cx.notify(); }
    })
    .on_mouse_up("left", (_e, cx) => end(cx))
    .on_hover((on, cx) => { if (!on) end(cx); })
    .child(div().flex_1().min_w(0).h_full().child(content))
    .child(v_flex().id(`${id}-nav`).relative().w(width).flex_none().h_full().border_l(1).border_color(t.border)
      .child(h_flex().id(`${id}-nav-head`).h(40).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border).child(head))
      .child(div().flex_1().min_h(0).pt(4).child(list))
      // The edge, 6 wide across the rule, over what's beside it.
      .child(div().id(`${id}-nav-edge`).absolute().top(0).bottom(0).left(-3).w(6).cursor_col_resize()
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); drag = { id, x: e.position.x, from: width, width }; cx.notify(); })));
}

/** T3's xs ghost icon button, as the toolbars and the column's head have them: 24, a 14 icon, `on` lit, greyed when `disabled`. */
/** @param {any} t @param {string} mod @param {string} id @param {string} icon @param {string} label @param {any} press @param {{ on?: boolean, disabled?: boolean, view?: any }} [state] */
export function ghostButton(t, mod, id, icon, label, press, { on = false, disabled = false, view } = {}) {
  return drawButton(t, id, { icon: `${mod}/icons/${icon}.svg`, label, surface: "card", on, disabled, hot: view?.hot === id })
    .when(!disabled, (el) => el
      .when(Boolean(view), el => el.on_hover((on, cx) => { view.hot = on ? id : null; cx.notify(); }))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); press(cx); }));
}

/** The toolbar's switch for the column, last at its right, on while open; greyed when `disabled`. */
/** @param {any} t @param {string} mod @param {string} id @param {boolean} open @param {any} toggle @param {boolean} [disabled] @param {any} [view] */
export function navToggle(t, mod, id, open, toggle, disabled = false, view) {
  return ghostButton(t, mod, id, "folder-tree", open ? "Hide the file tree" : "Show the file tree", toggle, { on: open, disabled, view });
}

/** The head's Collapse all / Expand all: `folded` says which it does now. */
/** @param {any} t @param {string} mod @param {string} id @param {boolean} folded @param {any} press @param {any} [view] */
export function foldAllButton(t, mod, id, folded, press, view) {
  return ghostButton(t, mod, id, folded ? "chevrons-up-down" : "chevrons-down-up", folded ? "Expand all" : "Collapse all", press, { view });
}
