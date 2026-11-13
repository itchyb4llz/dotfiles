// The layout's buttons, as T3's Button (`ui/button.tsx`): a variant for its colors, a size for its box, the theme for every color.
// docs/internals/t3-tokens.md「按钮」 is the table this draws. The caller adds what a button does: on_click (unless `act` is
// given), hover tracking for `hot`, stop() for the keyboard and tip() for a label. scripts/sync.sh copies this to each mod.
import { svg } from "gpui-kit";
import { h_flex } from "gpui-base";

// T3's sm: sizes. An outlined button's 1px border is inside its padding, as T3's `px-[calc(--spacing(3)-1px)]`.
const SIZES = {
  default: { h: 32, px: 12, gap: 8, text: 14, icon: 16, radius: 8 },
  sm: { h: 28, px: 10, gap: 6, text: 14, icon: 16, radius: 8 },
  compact: { h: 28, px: 8, gap: 4, text: 12, icon: 14, radius: 6 },
  xs: { h: 24, px: 8, gap: 4, text: 12, icon: 14, radius: 8 },
  micro: { h: 20, px: 6, gap: 4, text: 11, icon: 12, radius: 4 },
  tiny: { h: 16, px: 4, gap: 4, text: 11, icon: 12, radius: 4 },
};
// Icon-only boxes: T3's icon, icon-sm and icon-xs keep their 16/16/14 icons; micro and tiny take 12.
const ICON = { default: 16, sm: 16, compact: 14, xs: 14, micro: 12, tiny: 12 };
export const DISABLED = 0.64;

/** The radius a size draws, for the focus ring stop() draws over it. @param {string} [size] */
export const radiusOf = (size = "xs") => SIZES[size].radius;

// Ghost fills. `hover` and `selected` are the theme's tints of `chrome`; on a card or a popover `hover` can be its own color
// (catppuccin, latte), so there a tint of the text, as T3's accent: 7% hovered, 12% on, as the file tree's rows. In a sidebar
// row or card, as T3's row controls, none: it only lights. On a tab, `raised`, as T3's tab close (`bg-muted`).
const tint = (t, surface, on) => surface === "row" ? null : surface === "tab" ? t.raised
  : surface === "chrome" ? (on ? t.selected : t.hover) : t.foreground + (on ? "1f" : "12");

/**
 * @param {any} t the theme
 * @param {string} id
 * @param {{ variant?: "primary" | "outline" | "danger" | "ghost" | "plain", size?: keyof typeof SIZES, surface?: "chrome" | "card" | "row" | "tab",
 *   text?: string, icon?: string, wide?: boolean, label?: string, color?: string, hot?: boolean, on?: boolean, disabled?: boolean,
 *   act?: (cx: any) => void }} [o]
 *   `text` the words, `icon` an svg path before them (alone: a square button), `label` what assistive tech reads (else `text`).
 *   `wide`: padded as with words though there are none, for children the caller chains after (marks, counts).
 *   Ghost and plain: `color` its color whatever the state (ghost: else `dim`, `foreground` lit; plain: `foreground`), `hot` lit as hovered (an svg takes no hover style, so the caller tracks it),
 *   `on` pressed or its popup open.
 */
export function button(t, id, { variant = "ghost", size = "xs", surface = "chrome", text, icon, wide = false, label, color, hot = false, on = false, disabled = false, act } = {}) {
  const s = SIZES[size], filled = variant !== "ghost" && variant !== "plain", lit = variant === "plain" || (!disabled && (hot || on));
  // primary's border is its fill: drawn, a disabled one's faded edge shows lighter than its faded fill.
  const ruled = filled && variant !== "primary";
  const el = h_flex().id(id).h(s.h).flex_none().items_center().justify_center().rounded(s.radius).text_size(s.text).font_medium()
    .when(Boolean(text) || wide, (b) => b.px(ruled ? s.px - 1 : s.px).gap(s.gap)).when(!text && !wide, (b) => b.w(s.h))
    .when(ruled, (b) => b.border_1().border_color(t.input))
    .when(filled, (b) => b.bg(variant === "primary" ? t.solid : t.raised)
      .text_color(variant === "primary" ? t.solid_foreground : variant === "danger" ? t.ansi1 : t.foreground)
      .when(!disabled, (h) => h.hover((st) => st.opacity(0.9))))
    .when(!filled, (b) => b.text_color(color ?? (lit ? t.foreground : t.dim)).when(on && surface !== "row", (h) => h.bg(tint(t, surface, true)))
      .when(!disabled && !on && surface !== "row", (h) => h.hover((st) => st.bg(tint(t, surface, false)))))
    .when(disabled, (b) => b.opacity(DISABLED))
    .role("button").accessibility_label(label ?? text)
    .when(Boolean(act) && !disabled, (b) => b.cursor_pointer().on_click((_e, cx) => act(cx)));
  return el.when(Boolean(icon), (b) => b.child(svg(icon).size(text ? s.icon : ICON[size]).flex_none()))
    .when(Boolean(text), (b) => b.child(text));
}
