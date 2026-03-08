export TERM="xterm-256color"
export HISTCONTROL=ignoredups:erasedups
export EDITOR="vim"
export VISUAL="vim"
export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH:$HOME/.local/bin:$HOME/.config/composer/vendor/bin:$HOME/.cargo/bin/:$HOME/.console-ninja/.bin:$PATH:$HOME/Developments/flutterSDK/bin/:$PATH:$HOME/.pub-cache/bin:$PATH:/opt/google/chrome"

unset HISTFILE

set -o vi
bind -m vi-command 'Control-l: clear-screen'
bind -m vi-insert 'Control-l: clear-screen'

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

bind "set completion-ignore-case on"

alias ..='cd ..'
alias .='tmux new-session -s 1'
alias ls='exa --color=always --group-directories-first --icons'
alias la='exa -aG --color=always --group-directories-first --icons'
alias ll='exa -la --color=always --group-directories-first --icons'
alias vim='nvim'
# alias vim='lvim'
alias em='/usr/bin/emacs -nw'
# alias rm='rm -rf'
alias rm='trash'
alias mv='mv -i'
alias cp='cp -rf'
alias gs='git status -s'
alias gc='git commit '
alias ga='git add '
alias gl='git log --oneline'
alias gp='git push'
alias gd='git diff'
alias youtube-dl-music='youtube-dl --extract-audio --audio-format mp3'
alias checkupdates='checkupdates | less'
# alias dev='tmux new-session \; split-window -v -l 30% \; split-window -h'
alias z='yazi'
alias gg='lazygit'
alias zz='du -sh'

zd() {
  local dir
  dir=$(find "$HOME/Projects/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null |
    fzf-tmux -p --reverse)

  if [[ -n "$dir" ]]; then
    cd "$dir" || return
  fi
}

# eval "$(starship init bash)"
