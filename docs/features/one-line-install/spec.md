# One-line install

## Problem

A new person has to find and install Bun, Git, an agent CLI and a container runtime by hand before runcastle does anything. `runcastle doctor` names what is missing, but the person still does the work, and the README says "runcastle never installs anything for you". On a VPS it is worse: the agent token is easy to paste wrongly, and keeping runcastle running needs a hand-written service file.

## Approach

### What the person sees

They run one command from runcastle.dev (`curl -fsSL https://runcastle.dev/install.sh | bash`, or `irm https://runcastle.dev/install.ps1 | iex` on Windows). Bun and runcastle appear in their home folder. Then they see one list with three parts: what is already there, what will be installed (each line saying if it needs `sudo`), and what they must do afterwards. One yes installs the lot. They finish with sign-in steps and start runcastle.

Running it again after a failure only lists what is still missing.

### The small scripts

`install.sh` (bash, for Linux and macOS) and `install.ps1` (Windows) live in the static site. Each does only this:

1. Stop if running as root or through `sudo`, on Linux and macOS (decision 6).
2. If Bun is missing, install it with Bun's own installer, with no `bun` on `PATH` at that moment, or the installer skips the shell config and new terminals cannot find runcastle. On a machine with `zsh` and no `~/.zshrc`, create one first, because Bun's installer only writes to a file that exists. If `unzip` is missing on Linux, ask one yes and install it first. If Bun is older than 1.3.14, ask one yes and run `bun upgrade`. `--yes` answers both.
3. If runcastle is missing, or its `--help` does not mention `setup` (an install too old to have it), run `bun add -g runcastle@latest`.
4. Hand over to `runcastle setup`, passing on its arguments and reading from the terminal rather than the pipe.

The body sits in a function called on the last line, so a cut-off download runs nothing. A `site/_headers` rule serves both scripts as plain text.

### `runcastle setup`

A new subcommand holds all the real logic, in TypeScript, on every system.

It runs the doctor's existing probes, plus Bun's minimum version, and turns the results into an **install plan**: an ordered list of items, each with a label, whether it needs `sudo`, a warning if any, and how to install it. Items a machine cannot install automatically become "afterwards" steps instead. The plan is a pure function of the probe results and machine facts (system, Linux distribution, which package managers exist, whether the session has a desktop), so every case can be tested with no real machine.

- **Git:** the system's package manager on Linux (`apt-get`, `dnf`, `yum`, `pacman`, `zypper`, `apk`, with `sudo`), `winget` on Windows, `brew` on macOS. A Mac without Homebrew gets an "afterwards" step, `xcode-select --install`, which opens Apple's own dialog. A Windows machine without `winget` gets a link.
- **Agent CLIs:** the standalone installers the doctor already names, never npm or `bun add -g`. Question and `--agent` as in decision 2. A CLI below the adapter's minimum version is listed as an update (decision 8).
- **Docker:** Docker's own script on the systems in decision 3, followed by adding the person to the `docker` group. Elsewhere, and on Windows and macOS, an "afterwards" step with a link.
- **Afterwards:** starting Docker Desktop, logging out and back in after the group change, opening a new terminal when `PATH` changed, the agent sign-in commands, `runcastle token` where burns need it, and `runcastle service install` on a Linux machine with no desktop session. Sign-ins always stay with the person.

The one yes is Enter or `y`; any other key is a no. Installers run with their question-asking turned off where they have any: Codex's would otherwise ask to start Codex, a second question that would hang a `--yes` run.

Setup does not stop at the first failure. It tries every item, re-runs the probes with the installers' folders added to its own `PATH`, reports what is still missing, and exits non-zero if anything failed. With no terminal and no `--yes`, it prints the list, changes nothing and exits non-zero (decision 4).

The doctor's install advice stays the single source for install commands, so setup and the doctor cannot disagree.

### `runcastle token`

A guided step for the unattended Claude Code token, with a `--stdin` form for servers. It tells the person to run `claude setup-token`, reads the value with hidden input, and refuses a value too short to be a real token. It saves through the existing function that replaces any existing line in `~/.runcastle/.env`, then runs the doctor's live call to the service and reports it. The length check and the removal of spaces and line breaks both belong in that shared function, so the app's token card gets them too.

### `runcastle service install` and `remove`

As in decision 7. Writes a system service with `sudo`, running as the person's user, with `PATH` holding Bun and the agent CLIs, ordered after Docker. The user's own groups, `docker` included, apply to a service run this way. The server keeps listening on 127.0.0.1 only.

### Smaller pieces

- `runcastle serve` and the new commands appear in `--help`.
- The landing page's "Get started" section and the README's install section show the two commands and keep `bun add -g runcastle` as the manual route. The README's "runcastle never installs anything for you" goes. Other site pages that show `bun add -g` as the first step change to match.
- A short VPS guide covers the commands in order and the `ssh -L 4512:localhost:4512` tunnel, and says the server has no login so it must stay on 127.0.0.1.

### Release order

The npm release goes out first and the site deploy second, because the scripts call `runcastle setup`. Both need the human's yes.

## Seams

- **New: the install plan function.** Given probe results and machine facts, it returns the plan. Lets tests assert every system's list, including what needs `sudo`, what is only an "afterwards" step, and that nothing already fine is listed.
- **New: the setup runner.** Takes a plan, an injected command runner and an injected prompt. Lets tests observe what ran, in what order, what happens on a failure, on no terminal and on `--yes`.
- **Existing: `runDoctor`.** Reused as is, through its injected exec.
- **Existing: `saveAfkCredential`.** Gains the length check and strips spaces and line breaks; the token command and the app share it.
- **New: the service file renderer.** A pure function from user, paths and `PATH` to the file's text.
- **Existing: `parseCommand`.** New commands are unit-tested at the same dispatch.
- **Existing: the platform smoke workflow.** Gains a step that runs `install.sh` or `install.ps1` from the checkout against the built package, on every system. The scripts themselves are tested end to end in clean Linux containers.

## Out of scope

- Server hardening: firewall, SSH, Tailscale, swap.
- The move to another machine.
- Headless burn commands (`project add`, `feature create`, `burn`).
- Installing Docker Desktop, or any sign-in on the person's behalf.
- Services on macOS and Windows.
- Anything a person's own project needs (decision 9).
- A `404.html` for the site.

## Open questions

- Whether `irm | iex` needs `_headers` at all on Cloudflare Pages, which can only be measured after a deploy. The rule is harmless either way.
