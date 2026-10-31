# Decisions — Burns work for any Linux user

Planned without the human (a self-planning run). Every decision below is my own
recommendation, accepted so the plan could finish, and is marked `**Assumed.**`
until the human confirms it. One independent challenger read the brief and these
decisions; its points are recorded as `**Challenged:**` lines.

Two facts corrected from the brief while planning:

- Doctor does not check the image's UID today. The only UID check is inside
  sandcastle, when a container starts. It compares the image's `USER` with
  `process.getuid()`, and nothing checks the GID at all.
- The bug also hits macOS: a Mac's UID is 501, so it is baked into the image while
  the volume is chowned to 1000. The fix below covers it with no separate work.

## 1. One burn user, decided in one place
**Decision:** Runcastle gets a single answer to "who do burns run as", and every step uses it: the image build, the cache volume's owner, the container's `--user`, and the doctor. With Docker it is the host's UID and the account's primary GID. With no UID to read (Windows) it is `1000:1000`, as today. Podman keeps `1000:1000` (decision 10).
**Why:** The bug is two pieces of code answering the same question differently: the build reads the host, the chown hardcodes 1000. A third answer sits inside sandcastle (`process.getuid()`), so runcastle must now pass its answer in rather than leave that default in place. A host ID that clashes with one already in the base image is not a new risk: the Dockerfile's `groupmod -o` and `usermod -o` allow duplicates, which is how a Mac's GID 20 already builds.
**Assumed.** Alternative: read the user from the built image (`.Config.User`) and chown to that. Rejected because the container runs as the host's user whatever the image says, so the host is the real answer, and a custom image's `USER` can be a name or empty.

## 2. The group ID comes from the user's account, not the current process
**Decision:** The burn user's GID is the primary group in the account database (asked by name, `id -g <user>`), not `process.getgid()`. If that lookup fails, it falls back to `process.getgid()`, and the doctor's image row says so.
**Why:** `sg docker` and `newgrp` change the process's group, so the same user gets a different image depending on which shell built it. The account's primary group does not move. `os.userInfo()` is not used because Bun's version returns the process's group too, measured as a UID-1001 user under `sg docker` in WSL.
**Assumed.** Alternative: keep `process.getgid()` and only warn when it differs. Rejected because a warning leaves the human to fix what the code can get right.
**Challenged:** a silent fallback brings back the brief's "nothing warned" problem. Taken: the doctor now reports the fallback.

## 3. Cache volume access is checked at the start of every run, and the `0:0` is not proven
**Decision:** At the start of each run, a short one-shot container runs as the burn user and tests whether it can write to the volume and the folders directly inside it. The label stops vouching for ownership and only vouches for the layout version. Creating a volume also leaves a small marker file on it, so it is never empty. If a repair happens, the timeline records the owner it found and the burn user it expected. A check that fails or gives no clear answer changes nothing: the burn carries on and never deletes on a guess.
**Why:** The `0:0` the setup agent saw cannot be explained from here, because the VPS and its logs are not reachable. The code has three routes to it. (a) The label is stamped by `volume create`, before the chown, so a server killed between the two, or a failed rollback, leaves a root-owned volume that reads as good forever. That is a real bug either way. (b) Docker copies an image directory's owner onto an empty volume, so a project image with a root-owned `~/.m2`, `~/.gradle` or similar can reset the owner the first time it is mounted. Measured on a real engine, and the stock image has none of those folders, so this route needs a project image. (c) The setup agent may have read `/var/lib/docker/volumes/<name>/`, which is always root-owned, rather than its `_data`, or inspected a volume with `docker run -v` before it existed, which quietly creates an empty one owned by `0:0` (seen during this build). The UID mismatch alone gives `Permission denied` but says 1000, not 0. The per-run check repairs (a) without knowing which route happened. The marker file stops (b), because Docker only copies onto an empty volume. Route (c) needs no fix. The timeline event names the cause if it ever recurs. It costs one short container per run.
**Assumed.** Alternative: keep trusting the label, and only move the label on after the chown. Rejected because that closes route (a) only, and does nothing for a volume left wrong by a past run or a machine move.
**Challenged:** the first draft claimed the per-run check fixed all three routes, but under route (b) a recreated volume would just be reset again, on every burn. It also compared owner numbers, when writing is what actually matters and comparing numbers fails under remapped users. Taken: the marker file and the write test are both from this challenge.

## 4. A volume the burn user cannot write to is dropped and recreated, with no version bump
**Decision:** When the check finds a volume the burn user cannot write to, runcastle drops and recreates it, through the path that already handles stale volumes. `BURN_CACHE_VOLUME_VERSION` stays at 1. A writable volume is left alone, so UID-1000 Linux machines and Windows keep their warm caches, and the hand-fixed VPS volume stays as it is. A mismatch on group alone passes the test, because the owner can still write.
**Why:** A volume this user cannot write to could never have been filled by this user, so there is little or nothing warm to lose, and the worst case is one cold burn. A version bump would wipe every healthy cache on every machine to fix a problem on one. A recursive chown in place would also work, but on a multi-GB cache it can outrun the 60-second limit on engine commands, for a case that almost never holds anything worth keeping.
**Assumed.** Alternative: `chown -R` in place to keep whatever is on the volume.

## 5. The ticket error leads with the real cause
**Decision:** A failed setup step's error is reordered so its first line is the cause, read from the command's output: the last line naming a failure (`Permission denied`, `No space left`, `fatal:`, `error:` and similar), otherwise the last line of output. The elided command stays below it, so nothing is lost. The ticket row, the timeline and the retry note all pick this up with no screen change, because they already read the first line. A `Permission denied` under the cache mount also gets a plain sentence naming the volume and the burn user, and halts the run rather than failing each ticket in turn.
**Why:** Today the message starts `Command failed (exit 1): mkdir -p "$HOME/.claude/hooks"…`, because the whole chained setup command is the headline, and the ticket row shows only that line. `mkdir` for the guard was never what failed. The reorder happens in runcastle rather than in the sandcastle patch, which keeps the patch from growing.
**Assumed.** Alternative: change the message in the sandcastle patch (`formatExecFailureMessage`). Rejected because the classifier and the tests already read that format, and ADR-0011 keeps the patch small.

## 6. An image built for the wrong UID is stale, and Rebuild fixes it
**Decision:** The image's freshness verdict gains a reason: its `USER` has a different UID from the burn user. The doctor then says stale with both IDs, and the existing Rebuild button fixes it, including a project image chained on top. A UID mismatch halts the run before any ticket burns, in runcastle's words ("Rebuild from Settings → Workers"), replacing sandcastle's `sandcastle docker build-image` advice, a command runcastle users do not have. A custom image cannot be rebuilt here, so its message says to rebuild it wherever it was made, for that UID. A `USER` that is a name or empty is not judged. A GID-only mismatch is a note on the doctor's image row: it does not make the image stale and never stops a burn, because burns now pass the right group themselves.
**Why:** It reuses the one verdict the doctor and Rebuild already share, so they cannot disagree. The VPS's current image, built under `sg docker`, has the right UID and the wrong GID, so it will carry the note and keep working. Windows is unchanged: sandcastle already compares against 1000 there.
**Assumed.** Alternative: a separate doctor row for the image's user. Rejected because it would be a second opinion on the same image, with a Rebuild button that has to agree with it.
**Challenged:** the first draft told custom images to use a Rebuild that refuses them, never said what counts as a mismatch for a `USER` that is a name or empty, and called a harmless GID mismatch stale. Taken: all three are changed above.

## 7. The doctor reports the cache volume, without blocking the app
**Decision:** A new doctor row reports whether the burn user can write to the cache volume, using the same check as decision 3. In the app it covers the current project's volume, and only where a project is in view, so the first screen starts no container. `runcastle doctor` run by hand has no project list, so it finds every labelled volume through `docker volume ls`; the `--gate` boot check skips this row, because a boot must not start a container per volume. A bad volume reads `stale` at `info` severity, saying the next burn replaces it: nothing needs doing, so it should not fail the report. No volume yet is `ok`.
**Why:** The brief asks the doctor to notice this. Decisions 3 and 4 mean a bad volume no longer stops a burn, so an error row would send the human to fix something that fixes itself.
**Assumed.** Alternative: `error` severity. Stricter, but it fails `runcastle doctor` on a state the next burn clears by itself.

## 8. Tokens: a free offline check everywhere, a live check on request
**Decision:** The token row reports when `~/.runcastle/.env` holds more than one line for the same key, saying burns use the last one. The live check, a one-turn `claude -p` on the token with the smallest model, runs only in `runcastle doctor` when run by hand, never in the app's doctor query and never in the `--gate` boot check. It covers the Claude Code token only. A rejected token fails the row and names the line count. A check that could not reach the service says so and does not fail the row.
**Why:** The app's doctor query holds a 10-second limit per probe and runs on screens the app waits for, and a live call spends the human's usage each time. `claude auth status` cannot do this job, as the docs describe it as reporting login state, not testing the token. The burn itself already halts the run on an auth failure, so the check is only there to catch it sooner, and the moment a human hand-edits `.env` is when they reach for the CLI. Codex burns borrow `codex login`, which has its own row.
**Assumed.** Alternative: run the live check in the app too, remembered per token. It would catch a bad token pasted into Settings, at the cost of a slower first check and a usage charge the human did not ask for.

## 9. Running runcastle as root is refused, with the reason
**Decision:** On a Linux or macOS host running as root (UID 0), the doctor reports an error and a Claude Code burn stops before any container starts, saying Claude Code refuses to run unattended as root, and to run runcastle as a normal user. Runcastle does not try to map root onto another user.
**Why:** The title says any Linux user, and root is the default login on many VPSes. Baking UID 0 into the image builds without complaint, then fails later: the docs say Claude Code refuses `bypassPermissions` as root. Mapping root to UID 1000 would leave the agent unable to write a root-owned worktree. So the honest fix is a clear refusal.
**Assumed.** Alternative: support root by setting `IS_SANDBOX=1` in the container. Rejected because it works around a safety refusal instead of respecting it.

## 10. Podman stays exactly as it is
**Decision:** Podman keeps `1000:1000`, its create-and-chown-once volume path and no access check. Rootless podman maps the host's user onto 1000 inside the container, so a host UID of 1001 is already handled.
**Why:** The VPS uses Docker, and podman cannot be tested on this machine. Changing an untested path risks breaking what works.
**Assumed.** Alternative: run the access check under podman too, with the burn's `--userns` flags. Worth doing if a podman user reports this bug.
**Challenged:** rootful podman has no user mapping, so it may still have this bug, and decision 1 may clash with the host UID the brief says is baked into the image. The clash does not apply: the code passes no host IDs to a podman build. Rootful podman stays untested here, and this decision stands.

## 11. Built in the lead's own window, proved on the real VPS
**Decision:** No workers. The lead builds this directly: it is one coupled change across the burn cache, the image code, the burner and the doctor, with nothing that runs in parallel and no screen. It lands with typecheck and tests green, a real-container check using a scratch volume and a fake UID of 1001, and the Linux-only pieces (the `id -g` lookup, `sg docker`, the root refusal) tested as a UID-1001 user in WSL. If Docker or WSL cannot be used, the report says so and the VPS burn becomes those pieces' first real run. The Windows machine's own burn must still work. The test that counts is the human's real burn on the VPS, the checkpoint the brief names, and the feature stops there before merge. That burn must run the repair, not skip it: the hand-fixed volume is removed first so a fresh one is created, then its owner is set back to `0:0` for a second burn, which must repair it and record what it found. No review ticket: the VPS burn is the independent check on what matters.
**Why:** Each ticket costs about ten minutes before it starts, and these pieces share files, so tickets would race to land. A sandboxed worker also has no container engine, which is the one thing this needs.
**Assumed.** Alternative: two or three tickets with a review. It would add cost and no extra evidence, since no ticket can run a container.
**Challenged:** decision 4 leaves the hand-fixed volume alone, so a plain VPS burn would never run the repair path, and Windows cannot exercise the Linux-only pieces. Taken: the VPS steps and the WSL run are from this challenge.

## 12. Rootless Docker and user-namespace remapping are named, not supported
**Decision:** The doctor reads `docker info` and reports rootless Docker or `userns-remap` as an error row saying burns are not supported on it. Burns are not blocked, in case a setup happens to work. Supporting these modes is left for later.
**Why:** In both modes the host's UID means something different inside the container, so `--user 1001` no longer matches the bind-mounted worktree. Making that work is a project of its own, and neither is what the VPS runs. Naming it keeps the error honest.
**Assumed.** Alternative: support them, which would need a different identity mapping for Docker, close to podman's.

## 13. One runcastle user per Docker engine
**Decision:** Runcastle supports one Linux user running it per Docker engine. Images and tags are not separated by user. If two users share an engine, a Rebuild from one makes the image read as stale for the other, and the stale message names both UIDs. No user's cache can be deleted by another: volume names carry the project ID, each install has its own IDs, and a run only touches its own project's volume. `runcastle doctor` may list another user's volume as bad; that row is information only.
**Why:** The VPS has `ubuntu` and `muath`, but only `muath` runs runcastle. Per-user image tags would add a dimension to every image decision for a case nobody has.
**Assumed.** Alternative: put the UID in the image tag so users cannot collide.

## 14. The branch reaches the VPS as a local build, not a release
**Decision:** When the build is ready, the lead pushes the feature branch to `origin`. On the VPS, the human runs from a clone of the repo: `git fetch origin`, `bun install`, then `bun run install:local feature/burns-work-for-any-linux-user`, with runcastle stopped. That builds the package exactly as a release does and installs it globally, so the burn tests what users would get. `runcastle --version` shows the `-local.<sha>` suffix. Nothing is published. The human's yes on this plan covers the push.
**Why:** The brief asks for this at the checkpoint. Running from source would test something different from what ships, and publishing needs the human's yes and would put an unproven fix in front of everyone.
**Assumed.** Alternative: run from a checkout on the VPS with `bun run dev`. Quicker to set up, but it is not the installed path the VPS will run.
