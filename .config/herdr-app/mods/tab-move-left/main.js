// Move the shown tab one place left (TUI move_tab_previous), then close at once.
// keys.json: "mod.open:tab-move-left". tab.move only takes an absolute index.

import { View, div } from "gpui-kit";
import { run, props, closeOverlay, spaces, focused } from "herdr";

export default class TabMove extends View {
  init() {
    const f = focused();
    const tabs = spaces().find((s) => s.id === f?.space)?.tabs ?? [];
    const tab = tabs.find((t) => t.id === f?.tab);
    if (tab) {
      const index = Math.min(Math.max(tab.index + (-1), 1), tabs.length);
      if (index !== tab.index) run("tab.move", { id: tab.id, index });
    }
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }
  render() {
    return div();
  }
}
