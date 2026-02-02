#!/bin/sh

# default arch init	scripts
if [ -d /etc/X11/xinit/xinitrc.d ]; then
  for f in /etc/X11/xinit/xinitrc.d/?*.sh; do
    [ -x "$f" ] && . "$f"
  done
  unset f
fi

intern=eDP-1
extern=HDMI-1

if xrandr | grep "$extern disconnected"; then
  xrandr --output "$extern" --off --output "$intern" --auto
else
  xrandr --output "$intern" --off --output "$extern" --auto
fi

# dual screen enable
xrandr --output DP2 --primary --mode 1920x1080 --pos 0x0 --output HDMI1 --mode 1920x1080 --left-of DP2

# disbable screen off
if command -v xset >/dev/null; then
  xset s off
  xset -dpms
  xset s noblank
fi

# duplicate screen
# xrandr --output "$extern" --same-as "$intern"

export XCURSOR_THEME=Bibata-Modern-Ice
export XCURSOR_SIZE=16

# only choose 1 window manager
# exec qtile start
exec i3
# exec bspwm
# startxfce4
