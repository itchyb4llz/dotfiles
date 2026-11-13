// tmux-style prefix, mirroring the herdr TUI's [keys] in ~/.config/herdr/config.toml.
// alt-f (keys.json: "mod.open:prefix") opens this popup; the next key runs its
// action and closes it. Esc, or a key with no action, just closes it.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, focused, panes, terminals, spaces, exec, hc, notify } from "herdr";

// prefix+f, the GUI's herdr-watch (~/.dotfiles/.local/bin/herdr-watch): toggle an nvim "watch" pane
// left of the focused one, at the repo's root, showing every file the agents are changing.
const WATCH_ARGV = ["nvim", "-c", 'lua require("config.watch").start()'];
const isWatch = (t) => t?.labels?.["herdr.watch"] === "1" || (Array.isArray(t?.argv) && t.argv.some((a) => String(a).includes("config.watch")));
const fail = (body) => notify({ title: "herdr-watch", body, level: "error" });

async function toggleWatch() {
  const f = focused();
  const src = f?.pane;
  if (!src) return fail("no current pane");

  // Already open in this tab? Then this is the close half of the toggle.
  const byAddress = new Map(terminals().map((t) => [t.address, t]));
  const labelled = await hc(["ls", "--json", "--label", "herdr.watch=1"])
    .then((r) => new Set((JSON.parse(r.stdout).terminals ?? []).map((t) => t.address)))
    .catch(() => new Set());
  const open = panes().find((p) => p.tab === f.tab && p.terminal && (labelled.has(p.terminal) || isWatch(byAddress.get(p.terminal))));
  if (open) return run("pane.close", { pane: open.pane });

  const machine = spaces().find((s) => s.id === f.space)?.machine ?? null;
  const cwd = panes().find((p) => p.pane === src)?.cwd ?? f.cwd;
  if (!cwd) return fail("no folder for this pane");
  const git = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { on: machine }).catch(() => null);
  const repo = git?.code === 0 ? git.stdout.trim() : null;
  if (!repo) return fail(`not a git repo: ${cwd}`);

  // Splits only go right or down: open it right, then swap it to the left of the
  // agent and give the keyboard back to the agent pane, where you're typing.
  const before = new Set(panes().map((p) => p.pane));
  run("terminal.open", { argv: WATCH_ARGV, folder: repo, place: "right", name: "watch" });
  const made = panes().find((p) => p.tab === f.tab && !before.has(p.pane));
  if (!made) return;
  run("pane.swap", { pane: made.pane, target: src });
  run("pane.focus", { pane: src });
  if (made.terminal && !machine) hc(["label", made.terminal, "herdr.watch=1"]).catch(() => {});
}

// [keystroke, label, action]. Shifted letters are listed both ways because
// GPUI may report them as "shift-c" or "C" depending on the layout.
const KEYS = [
  ["?", "keys help", () => run("app.help")],
  ["h", "split down", () => run("pane.split", { direction: "down" })],
  ["v", "split right", () => run("pane.split", { direction: "right" })],
  ["x", "close pane", () => run("pane.close")],
  ["ctrl-m", "zoom pane", () => run("pane.zoom")],
  ["c", "new tab", () => run("tab.new")],
  ["r", "rename tab", () => run("tab.rename")],
  ["k", "close tab", () => run("tab.close", { confirmed: true })],
  ["p", "previous tab", () => run("tab.prev")],
  ["n", "next tab", () => run("tab.next")],
  ["1..9", "go to tab", null],
  ["shift-c", "new space", () => run("space.new")],
  ["shift-r", "rename space", () => run("space.rename")],
  ["shift-k", "close space", () => run("space.close", { confirmed: true })],
  ["shift-p", "previous space", () => run("space.prev")],
  ["shift-n", "next space", () => run("space.next")],
  ["f", "toggle nvim watch", toggleWatch],
  ["a", "picker (agents first)", () => run("mod.open", { name: "picker" })],
];

const ACTIONS = new Map();
for (const [k, , fn] of KEYS) {
  if (!fn) continue;
  ACTIONS.set(k, fn);
  const m = /^shift-([a-z])$/.exec(k);
  if (m) ACTIONS.set(m[1].toUpperCase(), fn);
}
ACTIONS.set("shift-/", ACTIONS.get("?"));
ACTIONS.set("shift-?", ACTIONS.get("?"));
for (let i = 1; i <= 9; i++) ACTIONS.set(String(i), () => run("tab.select", { index: i }));

export default class Prefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  render(_cx) {
    const t = theme();
    const close = () => { const id = props()?.overlay; if (id) closeOverlay(id); };
    return v_flex()
      .id("prefix")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        // Bare modifier presses (holding shift/ctrl) aren't the key yet.
        if (["shift", "control", "ctrl", "alt", "cmd", "super", "platform", "function"].includes(e.key)) return;
        cx.stop_propagation();
        const fn = ACTIONS.get(e.keystroke) ?? (e.key_char && ACTIONS.get(e.key_char));
        Promise.resolve(fn ? fn() : null).catch((err) => fail(String(err))).finally(close);
      })
      .size_full()
      .p(16)
      .gap(6)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().justify_between().child(div().font_semibold().text_color(t.foreground).child("alt-f …")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .children(
        KEYS.map(([k, label]) =>
          h_flex().gap(12).child(div().w(72).text_color(t.accent).child(k)).child(div().text_color(t.muted).child(label)),
        ),
      );
  }
}
