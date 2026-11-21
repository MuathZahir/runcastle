# Workers build in the feature's folder

## Problem

A worker today builds inside a Docker or Podman container, on a private clone of the feature branch, and its work only reaches the feature when the lead lands it. A 36-hour run showed what that costs: images missing a toolchain, no shared build cache, 1.6 GB copied per worker, private copies that went stale, container deaths nobody saw. It also needs Docker installed before anyone can build. Leads already run on the host without permission prompts, so the container was never a consistent safety line (ADR-0023).

## Approach

### What the human sees

A worker builds on their machine. The first worker of a feature builds in the feature's own folder, straight on the feature branch, and its commits are there the moment it makes them: no landing. A worker started while another is building gets its own folder and branch, and merges back once the project's checks pass and the lead has skimmed it (decisions 2, 3, 7, 12). The lead builds small things itself (decision 4). Docker is no longer needed to start a worker.

The only visible change in the app is wording. Under a worker's composer, where it runs reads "Feature folder · commits on `<branch>`" or "Own folder · its own branch off `<branch>`", in place of "Sandbox · …". The empty-chat hint and the handed-back line drop "sandbox", and a worker in the feature's folder hands back with no landing step in the line. No screen gains or loses a part, so nothing is designed.

### Where a worker builds

Runcastle picks the folder when the worker starts (decision 7), for the kinds that build (`with-you`, `on-its-own`, `unassigned`):

- **Feature folder** when no other building worker of the feature is working, needs the human, or is handed back but not yet settled. The worker's session gets the lead's worktree as its working folder; its branch is the feature branch.
- **Own folder** otherwise: a new git worktree beside the feature's, on a new branch cut from the feature branch's tip. The project's setup command runs there if one is set; otherwise the assignment says how to prepare it. Packages install from the package managers' shared caches.

The worker row records which it got and its folder, so the service, the guards and the UI read one fact. That needs a column for the folder and a placement value (`feature-folder` | `own-folder`); the engine column stops being required, since a host worker has none. Workers created before this feature keep their sandbox fields and finish the old way; the sandbox code stays until "Sandboxes are removed".

The host worker path already exists for drive workers and the drive review: the session launches with a host briefing and the host permission posture, in a real folder, and commits are recorded per turn without a landing step. Build workers join that path. The worker's briefing drops "inside a sandbox container" and says where it is, what it may not do (decision 10), and, in the feature folder, that the lead and other commits share the branch.

### Handing back, landing, sending back, dropping

- **Feature folder.** The handback lists the commits the worker made since its start (the drive workers' per-turn commit record). The lead settles it as today; "land" on such a worker only marks it landed, since its commits are already on the branch. Send back resumes the same conversation in the same folder. Drop stops it and leaves its commits (decision 13).
- **Own folder.** Landing runs the project's check commands in the worker's folder first (decision 12). On green it merges the worker's branch into the feature branch through the feature's landing queue, as today, and removes the worker's folder and branch. On red it merges nothing and returns the failing output, for the lead to send it back. A merge conflict keeps today's handling: an `on-its-own` worker is sent back to resolve it, up to twice. Drop removes the folder and branch.

### Guards

All checks run in the existing pre-tool hook route; no new hook.

- **The folder lock** (decision 8). While a building worker is in the feature folder and not settled, or a gates review is running there, the lead's edits outside its docs folder are refused, naming who holds the folder and when it frees. Package installs are refused the same way. The lead's shell commands are not parsed for writes; the lock covers its edit tools and installs.
- **Worker edits** stay inside the worker's own folder and the system temp folder, using the edit guard's existing containment check. Today the edit guard would hold a worker to the docs folder; that branch of it becomes the lead-only lock above.
- **Worker commands** (decision 10): any `git push`, `reset --hard`, `rebase`, `commit --amend`, `filter-branch`, `branch -D`/`-d`, `checkout`/`switch` to another branch, `worktree remove`, and `stash`. The sandbox guard's rules (its burn-guard list) that still matter on the host move into this check. The checkout guard used by drive sessions is the model.
- **Every agent** keeps the remote guard (no force push, no recursive delete outside its folders). Its list of a session's own folders gains the worker's folder.
- **The lead's other-checkout guard** must allow the lead to read a parallel worker's branch (`git diff`, `git log`) from its own folder; it already refuses running git inside another worktree, which stays.
- **Windows** (decision 11). The command splitter learns PowerShell's statement separators and `Remove-Item -Recurse`/`rm -r` forms, and Windows paths (backslashes, drive letters, case-insensitive compare). Tests run these forms on every platform.

### The review

A gates review (one that does not drive the app) runs in the feature's folder on the host, on the committed branch (decision 9). Its edit guard allows its handback notes only. `start_review` already requires every worker landed or dropped. A drive review is unchanged.

### Words that change

- The feature skill (`packages/skills`): build-it-yourself rule of thumb, where workers build, the folder lock, splitting parallel work by port and database, and that the lead runs no checks before landing a parallel worker because runcastle does.
- The lead's tool descriptions for the worker tools, the handback text, the worker briefing, the review template's "your own sandbox", the edit and install guards' "docs-only" refusals, and the web wording above.
- `CONTEXT.md` belongs to the orchestrator; the build notes say which lines it must rewrite at merge (git topology, "sandboxed workers", the Docker prerequisite).
- A plain statement of the remaining risk (decision 5) goes in the README's requirements or safety section.

## Seams

- **The pre-tool hook route** (existing): post a tool call for a session of a given kind and folder, observe allow or the refusal text. Covers decisions 8, 10, 11 and the edit containment, including Windows command forms.
- **The worker service against a real temporary git repo** (existing, as the worker service tests do with the engine stubbed): start workers, observe the folder and branch each got, the handback's commits, landing's check run and merge, drop's leftovers. Covers decisions 2, 3, 7, 12, 13.
- **The web's pure wording helpers** (existing): where-it-runs text per placement.

## Out of scope

- Deleting the sandbox code, images, caches, settings page, first-run Docker step and the Docker prerequisite: "Sandboxes are removed".
- How many workers run at once and the visible queue: "One number for how many build at once". The existing slot cap keeps working unchanged.
- The review's rules, the docs shape, plan approval, the involvement setting, autopilot: other features of the epic.
- The drive's two chats and the drive review: unchanged.
- Confining the lead's own edits to its folder: leads keep the guards they have.

## Open questions

- The lead's shell commands can still write files while a worker holds the folder; only its edit tools are locked. Revisit if it shows up.
- Two parallel workers' folders each install packages; on a heavy project that is slow and uses disk. The setup command is the lever; nothing more is built here.
