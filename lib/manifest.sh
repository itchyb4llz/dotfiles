# Single source of truth for what ~/.dotfiles tracks.
# Sourced by both ./jack-in (deploy dotfiles -> live machine) and
# ./uplink (capture live configs -> dotfiles).
#
# Each entry: "group:type:relative/path"
#   group = shared | omarchy | vanilla
#   type  = file | dir   (documentation only — linking works the same either way)
# relative/path is relative to both $HOME and the dotfiles repo root, since
# the repo mirrors $HOME's layout 1:1.
#
# file-level entries (fish, tmux, herdr, herdr-app) are deliberately NOT whole-directory:
# those apps keep runtime state (logs, sockets, session files) alongside their
# config, so linking the whole directory would strand that state behind the
# symlink. Everything else here was checked and holds nothing but config.

MANIFEST=(
  # ---- shared: useful regardless of which WM profile you're running ----
  "shared:file:.bashrc"
  "shared:dir:.local/bin"
  "shared:dir:.config/alacritty"
  "shared:file:.config/fish/config.fish"
  "shared:dir:.config/lazygit"
  "shared:file:.config/tmux/tmux.conf"
  "shared:file:.config/tmux/utility.conf"
  "shared:file:.config/starship.toml"
  "shared:file:.claude/settings.local.json"

  # ---- omarchy: current Hyprland/Omarchy setup ----
  "omarchy:dir:.config/foot"
  "omarchy:file:.config/herdr/config.toml"
  # herdr-app (the GUI) keeps sockets, telemetry, view state and its own shipped
  # mods/layouts/themes in the same folder, so only the pieces that are mine are
  # linked: keys, settings, the herdr-t3 layout and my mods.
  "omarchy:file:.config/herdr-app/keys.json"
  "omarchy:file:.config/herdr-app/settings.json"
  "omarchy:file:.config/herdr-app/layouts/herdr-t3.json"
  "omarchy:file:.config/herdr-app/layouts/herdr-t3.svg"
  "omarchy:dir:.config/herdr-app/mods/prefix"
  "omarchy:dir:.config/herdr-app/mods/tab-move-left"
  "omarchy:dir:.config/herdr-app/mods/tab-move-right"
  "omarchy:dir:.config/herdr-app/mods/t3-actions"
  "omarchy:dir:.config/herdr-app/mods/t3-agents"
  "omarchy:dir:.config/herdr-app/mods/t3-chrome"
  "omarchy:dir:.config/herdr-app/mods/t3-files"
  "omarchy:dir:.config/herdr-app/mods/t3-home"
  "omarchy:dir:.config/herdr-app/mods/t3-inbox"
  "omarchy:dir:.config/herdr-app/mods/t3-menu"
  "omarchy:dir:.config/herdr-app/mods/t3-new-menu"
  "omarchy:dir:.config/herdr-app/mods/t3-pane"
  "omarchy:dir:.config/herdr-app/mods/t3-picker"
  "omarchy:dir:.config/herdr-app/mods/t3-spaces"
  "omarchy:dir:.config/herdr-app/mods/t3-tabs"
  "omarchy:dir:.config/hypr"
  "omarchy:dir:.config/omarchy/bar/modules"
  "omarchy:file:.config/omarchy/shell.json"
  # Herdr GUI follows the Omarchy theme: template rendered per theme, hook publishes it.
  "omarchy:file:.config/omarchy/themed/herdr-app.json.tpl"
  "omarchy:file:.config/omarchy/hooks/theme-set.d/20-herdr-app"

  # ---- vanilla: legacy X11 WM setup (i3 / qtile / bspwm) ----
  "vanilla:file:.xinitrc"
  "vanilla:dir:.config/bspwm"
  "vanilla:dir:.config/dunst"
  "vanilla:dir:.config/ghostty"
  "vanilla:dir:.config/i3"
  "vanilla:dir:.config/i3status"
  "vanilla:dir:.config/kitty"
  "vanilla:dir:.config/mpv"
  "vanilla:dir:.config/picom"
  "vanilla:dir:.config/polybar"
  "vanilla:file:.config/qtile/autostart.sh"
  "vanilla:file:.config/qtile/colors.py"
  "vanilla:file:.config/qtile/config.py"
  "vanilla:file:.config/qtile/sxhkdrc"
  "vanilla:file:.config/qutebrowser/config.py"
  "vanilla:file:.config/redshift/redshift.conf"
  "vanilla:dir:.config/rofi"
  "vanilla:dir:.config/sxhkd"
  "vanilla:dir:.config/vimb"
)
