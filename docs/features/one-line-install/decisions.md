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

## 5. The scripts live on runcastle.dev, one command per system
**Decision:** `install.sh` and `install.ps1` live in `site/`, so people can read them at the address they run: `curl -fsSL https://runcastle.dev/install.sh | bash`, and `irm https://runcastle.dev/install.ps1 | iex` on Windows. The landing page's "Get started" section and the README show these commands. `bun add -g runcastle` stays documented as the manual route. At launch the npm release goes out first and the site deploy second, because the scripts call `runcastle setup`. Both steps need the human's yes.
**Why:** The site is static files, so one address cannot serve the right script per system. GitHub hosting gives a longer command and ties the install to the repo's layout, and reads no better. Moving the scripts later only changes the address.

## 6. Run as root, the script stops before installing anything
**Decision:** Run as root or through `sudo`, the script stops at the very start, explains why, gives the two commands that create a normal user with `sudo`, and says to re-run as that user. There is no `--allow-root`. The script only names those commands; it does not run them.
**Why:** A fresh VPS usually logs in as root, Claude Code refuses to run unattended as root, and carrying on would put everything in root's home folder and fail at the first burn. An override would only delay that failure, and it can be added later if people need it. Running inside a Dockerfile is not a job this feature aims at.

## 7. The background service is a separate, Linux-only command
**Decision:** `runcastle service install` makes Linux keep runcastle running: it starts when the machine boots and restarts if it crashes, with nobody logged in. It runs as the person's user, with the right `PATH`, after Docker has started. If a service file already exists, it replaces it and says so. `runcastle service remove` undoes it. On macOS and Windows the command says it is not supported. The service is not on the one-yes list; on a Linux machine with no desktop session, the "afterwards" part of the setup suggests it.
**Why:** Without a service, runcastle dies with the terminal, which on a VPS means burns die at logout. People on a laptop do not want it running all the time, so it stays out of the install. Nobody has asked for macOS or Windows services, and they cannot be tested here.

## 8. A tool too old to work counts as missing
**Decision:** This is the one exception to "never upgrade what is there". A tool below the version runcastle needs is treated as missing; anything new enough is never touched, even if it is behind the latest. An old Claude Code or Codex goes on the list as an update from one version to another, under the one yes. An old Bun must be fixed before the list can appear, so the script asks one yes for it first, as it does for `unzip`, and with `--yes` it just upgrades.
**Why:** Leaving a too-old tool alone would report a successful install and then break. Stopping to print the update command would hand the job back to the person, which this feature exists to remove.
