// What the Files and Review pages show while there's nothing else to (docs/adr/0013): loading, empty and failed, one way
// on both. Each paints no background: the panel's shows through. scripts/sync.sh copies this to both mods.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { button as drawButton } from "./button.js";

// Herdr's own spinner, which every mod can draw.
const SPINNER = "mods/workspace-chrome/spinner.svg";

/** Loading: a 14 spinner and a line, centered, announced as a status (as T3's FeedbackLoading). */
export function loadingState(t, id, text) {
  return h_flex().id(id).size_full().gap(8).items_center().justify_center().text_size(12).text_color(t.dim).role("status")
    .child(svg(SPINNER).size(14).flex_none().text_color(t.working).spin(900))
    .child(div().id(`${id}-text`).child(text));
}

/** Empty: a 24 icon (a path in the mod's folder), a 13 medium title and a 12 `dim` hint, centered, 8 apart. */
export function emptyState(t, id, icon, title, hint) {
  return v_flex().id(id).size_full().p(24).gap(8).items_center().justify_center().text_center().text_color(t.dim)
    .child(svg(icon).size(24).flex_none().text_color(t.dim))
    .child(div().id(`${id}-title`).text_size(13).font_medium().child(title))
    .when(Boolean(hint), (el) => el.child(div().id(`${id}-hint`).text_size(12).child(hint)));
}

/** Failed: a red bar under the toolbar, `ansi1` on a wash of it (its 0x18 alpha, Review's before), and Retry, T3's xs ghost button. */
export function errorBar(t, id, text, retry, view) {
  return h_flex().id(id).flex_none().px(12).py(6).gap(8).items_center().bg(t.ansi1 + "18").text_color(t.ansi1).text_size(11)
    .child(div().id(`${id}-text`).flex_1().min_w(0).child(text))
    .child(drawButton(t, `${id}-retry`, { variant: "plain", text: "Retry", surface: "card", hot: view?.hot === `${id}-retry` })
      .when(Boolean(view), el => el.on_hover((on, cx) => { view.hot = on ? `${id}-retry` : null; cx.notify(); }))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); retry(cx); }));
}
