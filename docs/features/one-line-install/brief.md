## Purpose

The human: "I don't want the user to have to download things himself. Everything has to be streamlined." This reverses the README's line "runcastle never installs anything for you". The human agreed that reversal.

## Understood

The agreed behaviour, following rustup, Homebrew, Coolify and Ollama:
- One command. It detects the machine and shows what is already there, what it will install, and what the person must do afterwards. One yes for the whole list.
- It installs everything it can: Bun, Git, runcastle, the Claude or Codex CLI, and Docker Engine on Linux.
- On Windows and macOS it stops and guides the person through Docker Desktop, because that needs an installer and sometimes a restart. Sign-ins always stay with the person.
- Only list what is missing; never reinstall or upgrade what is there. Say what needs `sudo` before asking. Safe to re-run after a failure. `--yes` for unattended servers. The script is published so people can read it first.
- `runcastle doctor` already checks these requirements and knows each fix: reuse those checks. The new part is a small script that gets Bun onto the machine first.

From the VPS setup report, these belong here:
- Token setup is fragile: `claude setup-token` wrapped across lines on a narrow terminal and the first paste saved 53 of 108 characters. A guided step with hidden input that rejects short values and replaces any existing line, with a `--stdin` form for servers.
- A way to run runcastle as a background service with the right `PATH`, groups and Docker ordering, replacing what the setup agent wrote by hand. A system service running as the user needed no lingering.
- `runcastle serve` is missing from `--help`.
- A short VPS guide covering the `ssh -L 4512:localhost:4512` tunnel. The server must keep listening on 127.0.0.1 only: it has no login.

## Open

- How the Windows path works (PowerShell script), and how the shell script is hosted on runcastle.dev. Note the site's redesign is live from an unmerged branch.
- What the script does when `curl | bash` runs with no terminal to ask on.
- Which agent CLI it offers when neither is installed.
- Whether the Docker install is offered on any Linux or only on distributions Docker's own script supports. Docker's group is effectively root, so say so in the list.

## Must not swallow

- Server hardening: firewall, SSH, Tailscale, swap. That stays the operator's.
- The move to another machine.
- Headless burn commands (`project add`, `feature create`, `burn`). Considered and dropped: no real job for a solo developer.

## Ordering

Waits on "No Node" and "Burns build their own image", so it installs the smaller list and needs no image step. Up next: it starts by itself once both ship.

## Working agreement

Checkpoints the human named, for this whole cut (Burns work for any Linux user, Move runcastle to another machine, No Node, Burns build their own image, One-line install):
1. After "Burns work for any Linux user": the human runs a real burn on the VPS.
2. Before the move: it handles the human's real data.
This feature has no checkpoint of its own: it is carried through to merged without stopping. Publishing a release needs the human's yes.

## Added by the orchestrator, 2026-10-31

From the "No Node" plan (docs/features/no-node/decisions.md, decisions 1, 5, 9, 11), which this install must follow:
- Install Claude Code and Codex with their standalone installers, never through npm or `bun add -g`. Those routes need Node, which the install no longer provides.
- A project that needs Node is that project's own requirement, and runcastle does not check for it. Consider how a clean machine with a JavaScript project finds this out, since the first sign may be `node: not found` in the dev pane at its first drive.
- The stock burn image is unchanged and keeps Node inside the container.
