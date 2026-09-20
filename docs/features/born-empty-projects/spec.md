# Born-empty projects

## Problem

Someone starting a brand-new project in an empty folder hits three walls in a row. The open-project screen refuses a non-git folder with an error and a `git init` hint, forcing them to leave runcastle, run the command themselves, and come back. If they do that, the repo they return with has an unborn HEAD — `git init` makes no commit, so no ref resolves — and the next step (a project chat, or creating a feature) dies with `fatal: not a valid object name: 'main'`, because every branch cut in the pipeline assumes the base ref resolves to a commit. And once the project finally opens, the whole page is a call-to-action to *prepare* the project — a flow designed for existing codebases — even though a repo with no code has no dev command, no drive setup, nothing to establish.

## Approach

From the user's perspective: picking a non-git folder now shows the same single error, but with an **Initialize repository** action in it. One click and runcastle initializes the repo, makes an empty initial commit, and retries the open — they never leave the screen. A repo they inited by hand (zero commits) just works: project chat, feature creation and everything downstream succeed without ceremony. And a born-empty project's home is the normal empty-workspace ("select a feature to begin" / new chat / draft), not the full-body prepare CTA.

The shape, in three pieces:

**1. Init offer (decisions 2–3).** The open flow gains a repo-initialization mutation on the project router: given the picked folder path, it runs `git init -b main` (respecting the user's `init.defaultBranch` config when set — detection handles any real branch name once a commit exists) followed by an empty initial commit with subject `runcastle: initial commit`. The web open-project screen replaces the passive `git init` hint in the "Not a git repository" failure note with the Initialize repository button; on success it immediately re-submits the open. The button is the confirmation — no extra dialog. Copy discipline from the onboarding redesign holds: problem stated once, path shown once. The picker is untouched; non-repo folders remain pickable and the offer lives only in the open error state.

**2. Unborn-HEAD auto-heal (decision 4).** The git service gains one shared heal primitive: when a branch cut is about to use a base ref that does not resolve because HEAD is unborn, it makes the same empty `runcastle: initial commit` on the unborn branch, emits a timeline event, and proceeds. It is wired into the seams that cut branches — project-chat branch recut, feature-branch creation (including the base-resolution step whose current failure is a misleading "detached HEAD" message on unborn repos), and talk-worktree creation — and must fire *before* any of those raise their existing errors. No offer, no consent surface: an empty commit is harmless plumbing with existing precedent (auto-committed docs scaffolds). Both this and piece 1 share the initial-commit primitive.

**Git identity failure (both pieces):** runcastle never sets `user.name`/`user.email`. If the initial commit fails because identity is unset, the surfaced error says exactly that and shows the two `git config` commands to run — one problem, one path, same copy in both surfaces.

**3. Prepare CTA yields on empty repos (decisions 5–6).** The server's prep view gains an `empty` signal: the working tree contains no files, tracked or untracked, besides `.git` and runcastle's own `docs/` scaffolding. It is computed live per request, never stored — emptiness ends the moment code appears. The web workspace-view selector treats an empty repo like a prepared one for routing purposes: no features + unprepared + empty routes to the normal empty workspace, not the prepare workspace. The sidebar's quiet prepare rail row is unchanged — preparation is no longer pushed, not hidden.

## Seams

- **`project.open` tRPC mutation (existing).** Observes the non-git rejection and, after piece 1, the successful retry-after-init. Error identity/copy is already pinned by web tests.
- **Repo-init mutation on the project router (new).** The one new seam: given a folder path, returns success (repo inited + initial commit made) or a typed failure (notably missing git identity). Testable directly against temp folders.
- **Git-service branch-cut functions (existing).** Project-branch recut, feature-branch creation, and talk-worktree creation, exercised against a zero-commit temp repo: each must succeed and leave the `runcastle: initial commit` behind, instead of throwing `not a valid object name`.
- **Feature creation service (existing).** End-to-end observation for piece 2: `createFeature` against a zero-commit repo yields a feature branch, talk worktree, and scaffolded docs.
- **Prep view (existing, extended).** Gains the `empty` field; testable server-side against temp repos with/without content, with `docs/`-only content counting as empty.
- **Workspace-view selector in the web lib (existing).** Pure function; the routing change (empty ⇒ empty workspace, not prepare) is directly unit-testable, and the open-project screen's failure-note action is component-testable.

## Out of scope

- No redesign of the onboarding/chooser flow — the shipped flow-redesign owns it; this changes one error state's behavior and leaves the directory picker untouched.
- No redesign of preparation — only *when* it is urged changes; the prepare workspace, rail row, and host-settings keys are untouched.
- No scaffolding of the user's application code — no README, no `.gitignore`; runcastle initializes the repo, never the stack.
- No setting of git identity on the user's behalf — the error names the fix; running it stays the human's call (the doctor/setup route already exists for this).
- No stored repo-state columns — no `defaultBranch`, `hasCommits`, or `isEmpty` on the project row; emptiness is computed live.

## Open questions

None — all decisions locked in ideation.
