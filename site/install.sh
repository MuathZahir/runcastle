#!/usr/bin/env bash
# runcastle installer for Linux and macOS:
#   curl -fsSL https://runcastle.dev/install.sh | bash
#
# It puts Bun and runcastle in your home folder, then hands over to
# `runcastle setup`, which shows what else is missing and asks one yes.
# Arguments are passed on to setup (--yes, --agent claude|codex|both).
#
# The whole body is in main, called on the last line, so a cut-off download
# runs nothing. Prompts read /dev/tty: the pipe holds stdin.

MIN_BUN_VERSION="1.3.14"

say() { printf '%s\n' "$*" >&2; }

# True when /dev/tty really opens, not merely exists.
have_tty() { ( : </dev/tty ) 2>/dev/null; }

# ask <question>: 0 for yes, 1 for no, 2 when there is nobody to ask.
ask() {
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  have_tty || return 2
  local reply=""
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r reply </dev/tty || return 1
  case "$reply" in y | Y | yes | YES | Yes) return 0 ;; *) return 1 ;; esac
}

# version_lt <a> <b>: true when a < b, compared number by number.
version_lt() {
  local IFS=. i
  local -a a=(${1%%[-+]*}) b=(${2%%[-+]*})
  for i in 0 1 2; do
    if [ "${a[i]:-0}" -lt "${b[i]:-0}" ]; then return 0; fi
    if [ "${a[i]:-0}" -gt "${b[i]:-0}" ]; then return 1; fi
  done
  return 1
}

# Ask one yes for a step that needs it; stop when it is not given.
confirm_or_stop() {
  local question="$1" manual="$2" status=0
  ask "$question" || status=$?
  case "$status" in
    0) return 0 ;;
    2)
      say "No terminal to ask on. Run this yourself, or re-run the installer with --yes:"
      say "  $manual"
      return 1
      ;;
    *)
      say "Not done. To do it yourself: $manual"
      return 1
      ;;
  esac
}

refuse_root() {
  local name="${SUDO_USER:-}"
  if [ -z "$name" ] || [ "$name" = root ]; then name="runcastle"; fi
  say "runcastle must not be installed as root."
  say "Claude Code refuses to run unattended as root, so every burn would fail."
  say ""
  say "Create a normal user with sudo (run these as root):"
  say "  sudo adduser $name"
  say "  sudo usermod -aG sudo $name"
  say ""
  say "Then log in as $name and run this installer again."
}

# Install unzip, which Bun's installer needs, with the first package manager found.
install_unzip() {
  local manager cmd=""
  for manager in apt-get dnf yum pacman zypper apk; do
    command -v "$manager" >/dev/null 2>&1 || continue
    case "$manager" in
      apt-get) cmd="sudo apt-get update && sudo apt-get install -y unzip" ;;
      dnf) cmd="sudo dnf install -y unzip" ;;
      yum) cmd="sudo yum install -y unzip" ;;
      pacman) cmd="sudo pacman -S --noconfirm unzip" ;;
      zypper) cmd="sudo zypper --non-interactive install unzip" ;;
      apk) cmd="sudo apk add unzip" ;;
    esac
    break
  done
  if [ -z "$cmd" ]; then
    say "unzip is required to install Bun, and no package manager was found. Install unzip, then re-run."
    return 1
  fi
  say "unzip is required to install Bun. This needs sudo: $cmd"
  confirm_or_stop "Install unzip?" "$cmd" || return 1
  bash -c "$cmd"
}

ensure_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    if [ "$(uname -s)" = Linux ] && ! command -v unzip >/dev/null 2>&1; then
      install_unzip || return 1
    fi
    say "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash || return 1
    export PATH="$HOME/.bun/bin:$PATH"
    command -v bun >/dev/null 2>&1 || { say "Bun installed, but is not on PATH."; return 1; }
    return 0
  fi

  local current
  current="$(bun --version 2>/dev/null)"
  if version_lt "$current" "$MIN_BUN_VERSION"; then
    say "Bun $current is older than $MIN_BUN_VERSION, which runcastle needs."
    confirm_or_stop "Upgrade Bun?" "bun upgrade" || return 1
    bun upgrade || return 1
  fi
}

ensure_runcastle() {
  local help=""
  if command -v runcastle >/dev/null 2>&1; then
    help="$(runcastle --help 2>&1)"
    case "$help" in *setup*) return 0 ;; esac
  fi
  say "Installing runcastle..."
  bun add -g "${RUNCASTLE_INSTALL_SPEC:-runcastle@latest}" || return 1
  command -v runcastle >/dev/null 2>&1 || { say "runcastle installed, but is not on PATH."; return 1; }
}

main() {
  ASSUME_YES=0
  local arg
  for arg in "$@"; do
    if [ "$arg" = --yes ] || [ "$arg" = -y ]; then ASSUME_YES=1; fi
  done

  if [ "$(id -u)" = 0 ]; then
    refuse_root
    return 1
  fi

  # Bun's global bin may not be on PATH yet, in a fresh shell or after an earlier run.
  export PATH="$HOME/.bun/bin:$PATH"

  ensure_bun || return 1
  ensure_runcastle || return 1

  if have_tty; then
    runcastle setup "$@" </dev/tty
  else
    runcastle setup "$@"
  fi
}

main "$@"
