#!/bin/sh

# default arch init	scripts
if [ -d /etc/X11/xinit/xinitrc.d ]; then
  for f in /etc/X11/xinit/xinitrc.d/?*.sh; do
    [ -x "$f" ] && . "$f"
  done
  unset f
fi

# disbable screen off
if command -v xset >/dev/null; then
  xset s off
  xset -dpms
  xset s noblank
fi

# duplicate screen
# xrandr --output "$intern" --same-as "$extern"

export XCURSOR_THEME=Bibata-Modern-Ice
export XCURSOR_SIZE=16

OUT="HDMI1"

MODE_LINE=$(xrandr | awk -v out="$OUT" '
  $1==out {found=1}
  found && /^[[:space:]]*[0-9]+x[0-9]+/ {print; exit}
')

BEST_RATE=$(echo "$MODE_LINE" | grep -oE '[0-9]+\.[0-9]+' | sort -nr | head -1)
RES=$(echo "$MODE_LINE" | awk '{print $1}')

xrandr --output "$OUT" --mode "$RES" --rate "$BEST_RATE"

# only choose 1 window manager
# exec qtile start
exec i3
# exec bspwm
# startxfce4
