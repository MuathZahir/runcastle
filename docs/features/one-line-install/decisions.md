# One-line install — decisions

## 1. Bun and runcastle install before the list; the one yes covers everything else
**Decision:** The small script installs Bun and runcastle straight away, with no question, because that is what the person ran the command for. Both go in their home folder and need no `sudo`. It then hands over to a new `runcastle setup`, which uses the doctor's checks to show everything else that is missing and asks the one yes. If `unzip` is missing, Bun's own installer will not run, so in that case only the script asks for `sudo` to install `unzip` before the list appears.
**Why:** The doctor runs on Bun, so nothing can draw the list on a clean machine until Bun is there. Putting Bun and runcastle on the list would mean writing every check again in shell and PowerShell, and those copies would drift from the doctor. The cost is that someone who answers no keeps Bun and runcastle on their machine.

## 2. With no agent CLI installed, ask once which to install
**Decision:** When neither Claude Code nor Codex is installed, `runcastle setup` asks once, before the list, with a single keypress: Claude Code, Codex or both, defaulting to Claude Code. The answer then appears on the list. With `--yes`, `--agent claude|codex|both` sets it, and leaving that out means Claude Code. If either CLI is already installed, the question is not asked and no agent is added.
**Why:** Each agent needs its own paid plan, so a guess can leave someone with an agent they cannot sign in to. Always installing Claude Code would send ChatGPT-plan users off to install Codex by hand, which is what this feature exists to remove. The choice is not a second approval, and only people with neither CLI see it.

## 3. Docker installs automatically only where Docker's own script supports the system
**Decision:** On Linux, `runcastle setup` installs Docker Engine with Docker's own install script on the systems that script covers: Ubuntu, Debian, Raspberry Pi OS, CentOS, RHEL, Rocky, Fedora and SLES. On any other system, Docker goes in the "you do this afterwards" part of the list with a link, as on Windows and macOS. A working Docker or Podman counts as done. Installing Docker also adds the person to the `docker` group; the list says that group is effectively root access, and the "afterwards" part says to log out and back in.
**Why:** Writing our own install steps for other systems means more code on systems we would rarely test, for a small share of users. Those users follow one link, and a system can be added later.

## 4. No terminal and no `--yes` means show the list and stop with an error
**Decision:** The setup reads its answer directly from the terminal, so `curl | bash` can still ask. A run with no terminal at all and no `--yes` prints the full list, changes nothing further, and stops with an error saying to re-run with `--yes`. With `--yes`, it installs everything it can and prints the "afterwards" steps.
**Why:** Silence must never count as a yes, because that yes can run `sudo` and add someone to the `docker` group. Installing anyway would be friendlier for scripts, but it makes the safe path depend on something the person cannot see. Bun and runcastle are already installed by this point, under decision 1.
