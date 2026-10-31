# Move runcastle to another machine

## Problem

The human is moving runcastle from a Windows PC to a Linux VPS so work continues with the PC off. Two machines cannot share one database, so the VPS becomes the only home. Without this tool they keep whatever repos they have pushed and lose the feature list, the chats, the notes and any unfinished work. Copying the files by hand fails in several ways: the live database is in WAL mode, paths inside it are Windows paths, Claude Code keeps chats in folders named after those paths, and several repos have no remote at all.

## Approach

The human stops runcastle and runs one command on the old machine:

```
runcastle move muath@vmi3713868            # add --dry-run to only look
```

It prints a report, asks for a yes, packs, copies the pack over `scp`, and runs `runcastle move-in` on the other end through `ssh`. When it ends, the human starts runcastle on the new machine and finds every project, feature, chat and note where they left it. Without a host, `move` stops after packing and prints the `scp` and `move-in` commands that finish the job.

### The report

`move` (with or without `--dry-run`) builds one report. It reads the database through a read-only connection, so it works with the server up.

- **Blocks:** a real run with the server up; a round marked running; a main checkout on a feature's branch; a checkout mid-merge or mid-rebase; two projects with one folder name. From the destination: an older runcastle, a Windows host, too little disk, existing projects or a target folder without `--replace`.
- **Moves:** per project, repo size, branch count, uncommitted file count, features, chats, and the old and new paths.
- **Will need attention:** commands to be cleared, `.env*` and other ignored names with sizes, stash counts, burner worktrees with leftovers, projects with no remote or with commits their remote lacks, chats that will end, repos that use LFS or submodules (which a bundle does not carry).
- **Stays behind:** a fixed short list (decision 12), with sizes where cheap.

With a host, `move` sends the manifest to `move-in --check` over `ssh`, which answers with the destination half of the report. `ssh` calls resolve the remote binary through a login shell, then fall back to `~/.bun/bin/runcastle`.

### The pack

A single `.tar.gz`, file mode 600, built in the OS temp dir. Nothing outside it is written.

- `manifest.json`: pack format version, runcastle version, source platform, home, data dir and Claude dir, and per project its id, name, repo path, default branch, branch tips, remotes, and which checkouts carry uncommitted work. Also a sha256 for each part and row counts per table.
- `db/runcastle.db`: a consistent copy made with SQLite's `VACUUM INTO`, which reads committed state whatever the WAL holds. Refusing while the server runs stays anyway, because logs and chats are written beside the database.
- `data/`: `config.json`, `sessions/` (minus `codex-home/auth.json`, `stderr` logs and launch artifacts, which are rewritten at each launch), `reviews/`, `annotations/`, `project-notes/`, `design-crops/`, `stories/`.
- `claude/<encoded-old-path>/`: the Claude project folder of each repo path and each session's worktree path. A folder is found from `~/.claude/projects` by the encoded path, or by a session's transcript id when the name is over Claude Code's 200-character limit (longer names carry a hash the tool cannot recompute).
- `repos/<project-id>.bundle`: `git bundle create --all`.
- `wip/<project-id>/<slug-or-main>/`: `changes.patch` from `git diff --binary HEAD`, `files/` holding whole copies of changed and untracked non-ignored files, and `head.txt`.

### Moving in

`move-in <pack> [--replace] [--repos-dir <dir>]`:

1. **Check.** Verify hashes and manifest, refuse on a blocker, and repeat the destination checks. Refuse while the server runs. A systemd-managed server is told apart only by the port and `/health`, and the message says to stop it.
2. **Stage.** Unpack to `<dataDir>.incoming/`. Rebuild each repo in a new sibling folder of its target (`git init`, fetch `+refs/*:refs/*` from the bundle, restore the remote URLs, check out the branch the old machine had checked out).
3. **Rewrite the database copy.** In one transaction, rewrite `projects.repo_path`, `sessions.worktree_path` and `sessions.transcript_path` by prefix: old repo path to new, old data dir to new, old Claude dir plus encoded folder to new. Matching folds case and slashes when the source was Windows, and rewritten paths use the destination's separators. A path matching no prefix is left alone and counted in the report. Rename Claude folders to the encoding of the new paths (each character outside `a-zA-Z0-9` becomes `-`, Claude Code's own rule). Clear Windows-bound commands and their provenance rows, and drop every verified stamp, only when the source and destination systems differ.
4. **Verify.** Row counts equal the manifest, every branch tip equals the manifest, every session with a conversation has its transcript or none was recorded, and every file hash matches. Any failure removes the staging folders and leaves the destination as it was.
5. **Swap.** With `--replace`, rename the old data dir and target repo folders to `*.before-move-<date>`, keeping `.env` and `install-id` into the new data dir. Merge `config.json`: source values, with `burnConcurrency` and `burnCpus` from the destination. Rename the staged folders into place, and put Claude folders under the destination's `~/.claude/projects`.
6. **Bring over unfinished work.** Apply each main checkout's changes. For a talk worktree with changes, add the worktree at its usual path on the branch or commit recorded in `head.txt` and apply them there. This runs after the swap because a git worktree records absolute paths. A patch that fails leaves its whole copies in `<repo>.uncommitted/<slug>/`, named in the report, and does not fail the move.
7. **Finish.** Write `<dataDir>/move-report.md`, holding the report and the cleared commands' old values. Delete the pack. Print what to do next: restart the server, run Prepare on the listed projects, recreate the listed `.env` files, and stop using the old machine.

On first boot, the existing startup handling ends stale sessions, and `ensureTalkWorktree` (the function that re-adds a missing talk worktree) rebuilds the rest when a session opens. `move` deletes its local pack once the remote `move-in` has reported success.

### Code shape

A new `packages/server/src/move/` module with three parts and one small pure core: `scan` (report, read-only), `pack`, `unpack`. The pure core is the path mapping, the Claude folder encoder and the Windows-bound command check, written against an explicit source platform with `node:path`'s `win32` and `posix` functions so they test on any host. The bin gains two commands, `move` and `move-in`, with lazy imports as `doctor` has.

There are no schema changes, tRPC routes or web changes: the app needs no screen, because after the move everything is the existing UI. `isPrepared` stays as it is, so the existing Prepare entry is reached through the report's list and not a new prompt.

## Seams

- **`parseCommand` in the bin (existing):** `move` and `move-in` dispatch and their flags.
- **`scanMove(input) → MoveReport` (new):** the highest seam on the old machine. Run against a temp data dir, temp Claude dir and real scratch git repos, it shows every blocker and report line. It is the check that the source is not changed: file hashes of the fixture before and after a pack are equal.
- **`packMove` then `moveIn` round trip (new):** the main end-to-end test. A scratch data dir and repos go in and a second data dir comes out, with a real boot of `reconcileStaleSessions`, `reconcileStaleRuns` and `ensureTalkWorktree` afterwards. It shows branches, uncommitted work, session rows and folder names on the far side.
- **Failure injection on `moveIn` (new):** a corrupted part or a row-count mismatch at each step leaves the destination byte-identical. A second run with `--replace` succeeds and sets the first aside.
- **`mapSourcePath`, `encodeClaudeFolder`, `isHostBoundCommand` (new, pure):** tables of Windows and POSIX cases. The Windows pack fixture for the round trip is built through these.
- **The rehearsal (manual, not a test):** fake data from the PC to a scratch `RUNCASTLE_DATA_DIR` and `--repos-dir` on the VPS, from a branch build, covering line endings, folder names and one real chat resume. A build from `install-local.ts` with `--no-install` run from a scratch folder leaves the installed runcastle alone.

## Out of scope

- Keeping two machines in sync; it is a one-way move.
- Backups, the VPS itself, the installer.
- Rewriting history text.
- A Windows destination.
- Carrying ignored files, older stashes, LFS objects or submodules (reported, not carried).
- Carrying secrets and logins, or global Claude Code setup.
- Pushing anything to any remote.
- Any new screen, and a Prepare prompt for moved projects.
- Stopping the old server from starting after a move.

## Open questions

- **Chat resume between systems.** The code shows the adapter reopens a conversation by id, and a check in `side-channels.ts` treats a transcript in any project folder as findable, so placing it under the new path should work. Only a real resume on Linux proves it, and that is in the rehearsal. It may need a throwaway project under the real `~/.claude` on the VPS, because a scratch Claude dir has no login; the plan asks the human before doing that.
- **When the real move runs.** It stops the server, and rounds must finish first, so it fits between features. It must come after a release that includes this tool. Timing against the rest of the cut (No Node, Burns build their own image, One-line install) is the human's call at the checkpoint.
- **Old-machine marker.** Decision 9 leaves the old server able to start. If the human prefers a marker that refuses to start it, that is a small addition, and it changes the source after a successful move only.
