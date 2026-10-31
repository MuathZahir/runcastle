# Burns build their own image

## Problem

A person setting up runcastle has to build the sandbox image before their first burn. In the app that is a click on Settings → Workers. On a headless server there is no click to make: a burn with no image ends on `could not start image sandcastle:runcastle: Unable to find image …`, which names no fix, and the VPS setup agent had to copy the build's labels and args out of the source to get an image at all. The README tells people to run a command that is not installed.

A project that ships its own `.runcastle/sandbox/Dockerfile` has a quieter version of the same problem. Until someone clicks Build, its burns run on the stock image, without the toolchain the repo asked for. If they edit that Dockerfile, nothing rebuilds it.

## Approach

**What the user sees.** They start a round. If the image is not there, the Work view's round header says it is building the sandbox image, the timer runs, and a few minutes later the tickets start. A second burn on the same machine does not build. If two burns find the image missing together there is one build. If it fails, no ticket has been touched, the round comes back to the lead with the cause and the log file, and the next round tries again. On a server with no browser, `runcastle build-image` does the same build by hand. Settings stops calling a missing image a problem and keeps its Build image button.

**One service.** A new function, `prepareImageBuild`, holds what the tRPC router's `buildImageTerminal` does today up to the plan: resolve the runtime, refresh the stock context, read the host's CLI versions, judge the stock image with `imageFreshness`, call `planImageBuild`. It takes the plain project fields and returns the plan and the notices. The router, the burn and the command all call it. `adoptProjectImage` stays the one writer of the project column and runs after a successful chain, in the button's PTY exit and in the burn.

**Running a plan with no terminal.** `runImageBuild(plan, { runtime, logPath, signal, onLine })` runs each step in order, through the same `buildStepArgs` the terminal uses, spawning through `resolveSpawnTarget` and the host containment `createSystemExec` uses. `createSystemExec` itself does not fit: it buffers output and kills at 60 seconds. Output goes to the log file line by line. Ten minutes with no output kills the build. It resolves to `{ ok: true }` or `{ ok: false, cause, tail }`, with `cause` picked by the same rule ticket errors use (decision 5 of `burns-work-for-any-linux-user`).

**The server's one build slot.** A small module holds a promise queue. `withImageBuildSlot(signal, fn)` serves the burn. The button takes the slot for the life of its PTY, released on `onExit`, and refuses at once if a build is running. The burn re-checks whether a build is still needed after it gets the slot, so a second waiter skips.

**The burn step.** `ensureBurnImage` runs in `burnRun` after the auth, root and engine checks, before the toolchain probe, for `docker` and `podman` sandboxes. It decides from `imageBuildTarget` and `inspectBuiltImage`:

```ts
// target from imageBuildTarget; image from inspectBuiltImage(target.tag)
needsBuild =
  target.kind !== 'refused' && inspectAnswered && (
    !image.present ||                                        // decision 1
    (target.kind === 'project' && overwritable && stored !== target.tag) || // built, not adopted
    imageUidMismatch(image.user, burnUser) !== undefined ||  // decision 2
    (target.kind === 'project' && image.hash !== projectHash) // decision 12
  )
```

`inspectBuiltImage` folds every failure into "not present", so it has to tell a real "no such image" from a failed or timed-out command (`inspectAnswered`). A run-scoped flag allows one build per run.

Three traps in the existing burner, all reachable from this step:

- `cachedExec` memoises every engine command by its args, so a probe or inspect made before the build would answer the same after it. Inspect through the uncached `exec`, and make the toolchain probe only after the build.
- `ctx.project` is a snapshot. After adopting a project image, `resolveSandboxImage(config, ctx.project)` still answers with the old tag, in the burner and in the cache volume step. The run re-reads the project row and every later step reads that.
- A column runcastle wrote whose Dockerfile has since gone resolves to a tag that may not exist, and `imageBuildTarget` answers stock or refuses it outright. The burn releases that column (`releaseProjectImage`) first, on the doctor's own terms, so the run resolves to the stock image it then checks.

**Events and summary.** New event types `burn.image_build_started`, `burn.image_built` and `burn.image_build_failed` are emitted through `ctx.emitEvent`. Started names the tag, the Dockerfile and the log path. `resolveHostAgentVersions` problems become a warning-flagged event, because no toast exists here. Failed carries the output tail. The run's summary leads with the cause and names the log file, which `composeRoundWake` already passes to the lead. An aborted signal throws, so `executeRun` records a cancelled run. The log goes under `logsDir()` as `image-build-<runId>.log`.

**The Work view.** `imageBuildWords` reads the event log: a build is running when the running run has a `burn.image_build_started` event with no `burn.image_built` or `burn.image_build_failed` after it. `TicketsView` shows those words in place of `roundWords`. Then the header reads "Building the sandbox image · first time only, a few minutes" for a first build, and "Rebuilding the sandbox image · a few minutes" for a rebuild, where "first time only" would be untrue. No layout changes, and no design pages.

**The command.** `parseCommand` gains `build-image`, dispatching to a lazy import as `doctor` does. It calls `prepareImageBuild` with no project and `runImageBuild` with `onLine` printing to stdout, needs no database, and refuses as root using the same message as the doctor's root row. `plan.kind === 'refused'` prints the reason and exits 1.

**Doctor and Settings.** The image row's `missing` and `not-built-yet` results drop to `info` severity with the new words, and their fix names both the first burn and the command. `imageReady` already reads `info` as ready, so the checklist stops counting the row with no web change. `ImageBuildAction` keeps offering the button. The `PREREQUISITE` reason text and the settings help line are updated where they say the image needs building by hand.

**Words.** Release notes are generated from commits, so what a release must call out, the regression in decision 9 included, sits in the release runbook until it is pasted in. The README's AFK sandbox section, the "Burns never build" comments, the burner's Rebuild messages (adding `runcastle build-image` where it applies), and the developer probe's fix line are corrected. `docs/adr/0017-burns-build-a-missing-image.md` records the reversal and what still stands.

## Seams

- **`burnRun` with injected deps (existing).** The new `ensureImage` dep sits beside `exec`. Tests observe the emitted events, the returned status and summary, which tickets started, and how many builds ran, for: image present; missing; missing with custom target; wrong UID; project Dockerfile changed; failure; abort.
- **`prepareImageBuild` (new, replaces the router's private helper).** Takes an `ExecFn`, so tests assert the plan for each project state. `planImageBuild`'s own tests stay as they are.
- **`runImageBuild` (new).** Injected spawn, so tests observe step order, stop on first failure, the quiet limit, abort, and `cause` selection.
- **`withImageBuildSlot` (new).** Observes ordering and refusal with no engine.
- **`runDoctor` image row (existing).** Observes severity and text for missing and not-built-yet.
- **`parseCommand` and the CLI's `runBuildImage(argv, log)` (existing and new).** Observes dispatch, refusal, root refusal and exit codes.
- **`imageBuildWords` (new).** Observes the header's words from an event list.
- **A real engine (by hand, decision 10).** The only proof the build, labels and adoption work end to end.

## Out of scope

- The one-line install, token setup and service setup.
- Project-owned image design: what a project image may contain, or how it is authored.
- Rebuilding a drifted image that can run (CLI drift, or a changed stock Dockerfile on its own).
- Rebuilding an image with no agent CLI: that stop stays, and its message gains the command.
- `runcastle build-image --project`.
- Live build output in the app.
- A lock shared with the command.
- A named message for a missing custom image.
- Rootless Docker and `userns-remap`, unchanged from `burns-work-for-any-linux-user` decision 12.

## Open questions

None for the build. The decisions marked to check first are the human's to change.
