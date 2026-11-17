#!/usr/bin/env bash
# space-template: give a new herdr workspace the pharmasyncv2 layout, the same one
# herdr-space-template gives herdr-app spaces:
#
#     +----------------------+-----------+
#     |  nvim watch (72%)    |           |
#     |                      |  claude   |
#     +----------------------+  (38%)    |
#     |  shell (28%)         |           |
#     +----------------------+-----------+
#
# Runs on workspace.created. Only a workspace that is still one plain shell is
# touched, so ones made with an agent or a layout already in them are left alone.
set -uo pipefail

# herdr runs plugin commands with a minimal PATH.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
H="${HERDR_BIN_PATH:-herdr}"

AGENT_CMD="claude"   # typed into the right pane; "" leaves it a plain shell
LEFT_RATIO=0.62      # share of the width for the left column (1 - claude's 38%)
TOP_RATIO=0.72       # share of the left column for the watch pane
WATCH_CMD="nvim -c 'lua require(\"config.watch\").start()'"

log() { echo "space-template: $*" >&2; }

ws=$(jq -r '.data.workspace.workspace_id // empty' <<<"${HERDR_PLUGIN_EVENT_JSON:-}")
[ -n "$ws" ] || { log "no workspace in event"; exit 0; }

panes=$("$H" pane list --workspace "$ws") || exit 0
[ "$(jq '.result.panes | length' <<<"$panes")" = 1 ] || exit 0
root=$(jq -r '.result.panes[0].pane_id' <<<"$panes")
cwd=$(jq -r '.result.panes[0].foreground_cwd // .result.panes[0].cwd // empty' <<<"$panes")
[ -n "$cwd" ] || cwd=$HOME

# A plain shell, or nothing in the foreground yet because it is still starting.
fg=$("$H" pane process-info --pane "$root" |
  jq -r '.result.process_info.foreground_processes[0] | (.argv[0] // .name // empty)' | sed 's|.*/||; s|^-||')
case "$fg" in "" | fish | bash | zsh | sh | nu) ;; *) exit 0 ;; esac

# pane split only goes right or down, and --ratio is the share the split pane keeps.
# The root stays top-left (watch); the right split takes claude and the focus.
agent=$("$H" pane split "$root" --direction right --ratio "$LEFT_RATIO" --cwd "$cwd" --focus |
  jq -r '.result.pane.pane_id') || { log "split right failed"; exit 1; }
"$H" pane split "$root" --direction down --ratio "$TOP_RATIO" --cwd "$cwd" --no-focus > /dev/null ||
  { log "split down failed"; exit 1; }

# Labelled like herdr-watch's pane, so prefix+f closes it.
"$H" pane rename "$root" watch > /dev/null
"$H" pane run "$root" "$WATCH_CMD" > /dev/null
[ -z "$AGENT_CMD" ] || "$H" pane run "$agent" "$AGENT_CMD" > /dev/null
