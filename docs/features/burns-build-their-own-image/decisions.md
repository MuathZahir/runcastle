# Decisions — Burns build their own image

Planned without the human (a self-planning run). Every decision below is my own
recommendation, accepted so the plan could finish, and is marked `**Assumed.**`
until the human confirms it.

Three facts corrected from the brief while planning:

- The stop the brief quotes is not a burn's. `burn-cache-probe.ts` is a developer
  script (`bun run burn-cache:probe`). A real burn stops in the burner's image
  preflight: `docker run` tries to pull `sandcastle:runcastle` from a registry,
  fails, and the run ends on `could not start image …: Unable to find image …`,
  which names no fix at all.
- The shipped feature `burns-rebuild-a-drifted-sandbox-image-themselves` does not
  rebuild anything, whatever its title says. Its decision 2 chose warn-only after
  designing auto-rebuild in full, and that is where "burns never build" comes from.
- A project that ships `.runcastle/sandbox/Dockerfile` but has never built it runs
  on the stock image today, because nothing has written the project's image column
  yet. So "is the image missing" cannot be asked of the name a burn resolves to.

## 1. A burn builds when the image it should run on does not exist yet
**Decision:** After the cheap checks pass (auth, not root, engine up) and before any ticket starts, a container burn asks the build target, the same question the Build button asks (`imageBuildTarget`), what image this project should run on. It builds when that image is managed by runcastle and either is not on the machine, or is a project image that is built but not yet adopted as the project's. That covers the stock image and a project's own Dockerfile. A built project image is adopted, so every later step of the run uses it. `noSandbox` runs build nothing. Only the engine's own "no such image" answer means missing: an inspect that fails or times out builds nothing, and the burn goes on to today's checks.
**Why:** The title's promise is that the first burn just works, and a burn with no image can do nothing else useful. Asking the build target rather than the resolved name is what catches the project Dockerfile that was never built, which today quietly runs on stock. A burn on a project with its own Dockerfile should never fall back to stock.
**Assumed.** Alternative: build only the stock image and leave project Dockerfiles to the button. Smaller, but a headless server would still dead-end on any project with its own Dockerfile.
**Challenged:** the image check reports "not present" on any failure, so a wedged engine would start a pointless build. Taken: the last sentence of the decision is from this challenge.

## 2. A burn also builds over an image it cannot start; drift stays a warning
**Decision:** Besides the missing case, a burn builds a managed image built for another UID, which today stops the run and says to Rebuild. An image that can run is left alone: CLI drift and a changed stock Dockerfile keep today's warning and the burn carries on. The exception is decision 12, a project's own edited Dockerfile. When a project build runs, the stock image is rebuilt first if it is stale, as the Build button already does, because the project image is built on it. Messages that still say Rebuild also name `runcastle build-image`, where that command can fix it. That covers an image with no agent CLI, which stays a stop: only very old images are in that state, and finding it needs a container, so the build step cannot see it first.
**Why:** The shipped warn-only decision still holds for the reason it gave: a drifted image can run, and rebuilding it saves one click for a lot of waiting. An image a burn cannot start is the same case as a missing one: there is nothing to protect, and the burn's other answer is a click that a headless server cannot make.
**Assumed.** Alternative: missing images only, and let a wrong UID stop the run with the command named. One condition fewer, for a rare case.
**Challenged:** the first draft left a wrong UID as a stop on the grounds that it is rare, which is no reason when the burn cannot run anyway, and it claimed a burn never replaces an existing image, which the project build's stock step contradicts. Taken: both are changed above. The challenger's wider rule, every stop that says Rebuild, is not taken for the agent-CLI stop, for the reason given.

## 3. Custom images are never built, and behave exactly as they do today
**Decision:** A hand-typed tag, a machine-wide `sandboxImage`, `RUNCASTLE_SANDBOX_IMAGE` and leftover tags from older versions are not runcastle's to build. The build target already refuses them, and a refusal means the burn skips this step and goes on as today, including `docker run` pulling a registry image it does not have.
**Why:** It is the same line the Rebuild button draws, and pulling on first use is how a custom image from a registry works now. A clearer "custom image not found" message is not needed to deliver this feature.
**Assumed.** Alternative: stop custom images with a named message when they are missing. It would break the pull.

## 4. One build plan, run two ways
**Decision:** The steps that gather a build (refresh the stock context, read the host's CLI versions, judge the stock image, call `planImageBuild`, adopt on success) move out of the tRPC router into one service function. The Build button keeps running that plan in its terminal. Burns and the command run the same plan's steps one by one with no terminal, streaming output to a log. Nothing new decides tags, labels or args.
**Why:** The brief asks for no second build path, and the labels and args are exactly what the VPS setup agent had to copy by hand. A plan is already data, so only the thing that executes it has two forms: a terminal the human watches, and a process that runs alone.
**Assumed.** Alternative: run the burn's build inside a hidden terminal session, reusing the PTY code. It would need a session nobody is attached to, and the PTY's output is meant for a screen rather than a log.

## 5. `runcastle build-image` exists, and builds the stock image
**Decision:** A new subcommand runs the stock plan with its output on the terminal and exits non-zero on failure. It takes no arguments and needs no running server. It always runs the build, so an image with nothing to change finishes in seconds from the layer cache, and it doubles as the headless Rebuild. A machine-wide custom image makes it refuse with the existing reason. Run as root, it refuses with the doctor's message, because the image would be built for UID 0.
**Why:** The one-line install needs a way to build without the app, and the VPS report asked for this. It is about 20 lines over decision 4's service, and it gives headless servers the fix the app's button gives everyone else. Project images are left out because they need the database (who typed the tag, adopting the result), and burns build them when they are missing, changed or unusable (decisions 1, 2 and 12).
**Assumed.** Alternative: `runcastle build-image --project <path>` for the full chain. It would also catch a project image's CLI drift on a headless server, but that image still runs, and the flag brings the database into a command that otherwise needs none.
**Challenged:** stock-only left a headless dead end for an edited project Dockerfile, the problem the brief opens with. Taken as decision 12 rather than as a flag. `sudo runcastle build-image`, or an install script running as root, would also have baked in UID 0. Taken: the root refusal.

## 6. A missing managed image no longer counts as a problem
**Decision:** The doctor's image row reports a missing stock image or an unbuilt project Dockerfile at `info` severity: "not built yet — the first round builds it, which takes a few minutes". Settings → Workers stops counting it as something in the way and keeps the Build image button for anyone who would rather build ahead. `runcastle doctor` no longer fails on it. A custom image that is missing stays an `error`.
**Why:** The checklist's rule is that it counts "everything a burn is actually blocked on", and a burn is no longer blocked. Leaving it red would send people to a click this feature exists to remove, and would fail the one-line install's doctor check on a healthy new machine.
**Assumed.** Alternative: keep it an `error` so the human knows a slow first burn is coming. The row's words say so without failing the report.

## 7. One image build at a time on the server
**Decision:** The server runs one image build at a time, whoever started it. A burn that needs a build while another is running waits for it, then looks again, and only builds if the image is still not there. So two burns finding it missing produce one build, and the second carries straight on. Pressing Build image while a burn is building is refused with a message saying a burn is building it. A burn that needs a build while the button's build runs waits for it the same way. `runcastle build-image` is a separate process and is not covered.
**Why:** The stock image is shared by every project and a project image is built on top of it, so one queue is simpler than a lock per image and is always correct. Waits are short compared with what they save. The command is left outside because two builds of one tag cannot corrupt anything: the layers are shared, and the last one to finish holds the tag. The worst case is wasted minutes when someone runs the command by hand during a first burn.
**Assumed.** Alternative: a lock file so the command takes part. It brings stale locks after a crash, to prevent a harmless race.

## 8. The wait shows in the round's header, and the timeline records it
**Decision:** While a burn builds, the Work view's round header reads "Building the sandbox image · first time only, a few minutes" in place of "Running · 0 of 3 landed", beside the round's existing timer, and the tickets sit waiting as usual. The run records two timeline events, started and finished, naming the image, the Dockerfile and how long it took. There is no live build log in the app. The full log is a file in runcastle's data folder, and the timeline names it.
**Why:** A burn is something the human leaves running, so what they need is to see it is not stuck and why no ticket has started. The header already has a moving line and a timer, so this is one wording change with no new layout. A live log would need either a stream of events kept forever or a new panel.
**Assumed.** Alternative: show the build's last line of output in the header. It reassures more on a slow build, but the line would have to reach the screen as a stream of permanent events or a new live channel.
**Challenged:** a raw last line needs no parsing, the output is already streamed for the quiet limit, and a human who sees nothing moving for minutes may press Stop. The cost is getting a changing line to the screen rather than reading it, and the timer is already moving, so this answer stands.

## 9. A failed build ends the run before any ticket, and the next round tries again
**Decision:** A build gets one attempt per run. If it fails, the run fails before any ticket starts, and every ticket stays waiting rather than marked failed. The run's summary leads with the cause, taken from the build's output by the same "last line naming a failure" rule as ticket errors, then says "the sandbox image did not build" and names the log file. The last lines of output go on the timeline event. The round's return message carries that summary to the lead, who tells the human or starts the round again once the cause is fixed. A project image that fails to build stops the run: it never falls back to the stock image. Stop during a build kills it and cancels the run as usual. A build goes quiet for 10 minutes with no output and it is treated as failed, which covers a wedged engine without capping a long but healthy build.
**Why:** A failed build is nearly always the network, the disk or a broken project Dockerfile, none of which an instant retry fixes, and each ticket would hit the same wall. Tickets did nothing wrong, so they should not count as failed. Falling back to stock would run a project's tickets without its toolchain, which is the silent wrong answer decision 1 removes.
**Assumed.** Alternative: retry once automatically, for a brief network failure. It delays the real message by the length of a second failed build.
**Challenged:** with decision 1, a repo carrying a broken Dockerfile that nobody ever built goes from running on stock to a failed run, a regression the plan had not named. This answer stands, because the stock run was silently wrong, but it is listed to check first and goes in the release notes.

## 10. Built in the lead's own window, proved on a real engine
**Decision:** No workers. The lead builds this directly, then runs typecheck and tests. It also proves it against a real Docker engine: a burn that finds the stock image missing builds it, runs a ticket, and a second run does not build; and a scratch project with its own small Dockerfile builds, adopts and runs on its image. The check runs only with no burn active on the engine, tags the stock image aside first and puts it back afterwards. Docker is not running on this machine as this plan is written. If it cannot be started when the work runs, the ready message says at the top that the build path is unproven, and the proof moves to the VPS through the local install (`bun run install:local <branch>`), which needs no release. The human's yes on this plan covers pushing the branch for that. The checkpoints the human named for this cut are unchanged, and this feature has none of its own. No review ticket: the real-engine check is the independent evidence for what matters.
**Why:** It is one coupled change across the image service, the burner, the doctor and one line of the Work view, so tickets would only race to land. A sandboxed worker also has no container engine, which is the one thing this needs to be proved on.
**Assumed.** Alternative: two tickets (server, web) and a review. More cost, no more evidence, since no ticket can run a container.
**Challenged:** a VPS burn only runs this code after a release, which needs the human's yes, so the feature could merge with the build never run, and the check deleted a shared tag that live burns may use. Taken: the local-install route, the unproven notice and the tag set aside are from this challenge.

## 11. The reversal is written down as an ADR
**Decision:** This feature adds an ADR saying burns build a missing managed image, that everything else about image builds stands (a drifted image is never rebuilt by a burn), and why. It cites `sandbox-agent-clis-track-the-host-version` decision 5 and `burns-rebuild-a-drifted-sandbox-image-themselves` decision 2. The README's false lines and the comments and fix texts that say burns never build or point only at the button are corrected in the same change.
**Why:** "Burns never build" has been argued twice and is repeated in the code. The earlier feature promised an ADR that was never written, so a reader today would find the rule in the code and no reason for this exception.
**Assumed.** Alternative: leave it to the feature's own `decisions.md`, which is harder to find than the ADR folder.

## 12. A burn rebuilds a project image whose Dockerfile changed
**Decision:** When a project's built image no longer matches the repo's `.runcastle/sandbox/Dockerfile` (the hash label the doctor already reads differs), the burn builds it before any ticket, as in decision 1. Only the project's own image counts here. A stock image whose Dockerfile changed after a runcastle upgrade keeps today's behaviour, unless a project build needs it as its base. The Dockerfile read is the one in the project's main checkout, the same one the Build button reads.
**Why:** When a tool is missing, a burn's stop says to add it to that Dockerfile and rebuild. Without this, the human makes the edit and the next burn runs on the old image, and on a headless server the only way out would be deleting the image by hand. An edit to that file is the repo saying what it needs, and only that project uses the image, so this is not the shared-image case the warn-only decision weighed.
**Assumed.** Alternative: `runcastle build-image --project <path>`, so a human rebuilds it by hand. It keeps "a burn never replaces an image" true, but leaves the human one more step after the edit, and the app one more thing to explain.
