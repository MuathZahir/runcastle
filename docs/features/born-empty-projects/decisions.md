# Decisions — born-empty-projects

## 1. One lap, whole feature
**Decision:** Spec the entire feature as a single lap — no map, no thin walking-skeleton lap 1.
**Why:** Three well-scoped touches on already-shipped surfaces; the only real uncertainty (unborn HEAD handling) is a design decision that can be settled in ideation, not something that needs a test drive to discover.

## 2. Git-init offer: one button, no extra confirm
**Decision:** The open-screen "Not a git repository" error state gains a single "Initialize repository" action. Clicking it runs `git init` in the picked folder server-side, then immediately retries the open — the button itself is the confirmation, with no extra dialog. Copy discipline from flow-redesign-onboarding-and-project-chooser holds: problem stated once, path shown once.
**Why:** `git init` in a non-repo folder is safe and non-destructive, so a second confirm step would be ceremony; the human never leaves the screen.

## 3. Init leaves an empty initial commit, no scaffolded files
**Decision:** runcastle's init runs `git init -b main` (respecting the user's `init.defaultBranch` config when set) followed by an empty initial commit: `git commit --allow-empty -m "runcastle: initial commit"`. No `.gitignore`, no README. If the commit fails because git identity (`user.name`/`user.email`) is unset, the error state says exactly that, showing the two `git config` commands — problem stated once, path shown once.
**Why:** The commit is pure plumbing — it makes `main` a resolvable ref so every downstream branch cut works. Scaffolded files would be stack-specific, which the brief forbids. `-b main` matches `detectMainBranch`'s literal `'main'` fallback; a user-configured default branch name is fine because detection handles any real branch once a commit exists.

## 4. Unborn HEAD: silent auto-heal at the branch-cut seam
**Decision:** When runcastle is about to cut a branch (project chat's `runcastle/project`, feature branches, talk worktrees) and the base ref doesn't resolve because HEAD is unborn, it silently makes the same empty `runcastle: initial commit` on the unborn branch, records a timeline event, and proceeds. No offer, no error surface. Git-identity failure gets the same copy as decision 3.
**Why:** Git cannot branch/worktree/merge without a commit, so "tolerating" an unborn HEAD means getting a commit in — and an empty commit is harmless plumbing with existing precedent (auto-committed docs scaffolds). This covers manually-inited repos where the open-screen offer never fires, and turning three surfaces (chat launch, feature create, drive) into consent dialogs would be ceremony with no downside avoided.

## 5. "Empty" = no files besides .git and runcastle's docs scaffolding
**Decision:** A repo counts as empty when its working tree contains no files (tracked or untracked) besides `.git` and runcastle's own `docs/` scaffolding. Computed live and cheaply server-side as part of the prep view — never stored, since emptiness ends the moment code appears. "Zero commits" is not the definition (decisions 3–4 give every repo one empty commit), and manifest recognition would drift into stack detection, which the brief forbids.
**Why:** A folder full of uncommitted code has plenty to prepare; a repo whose only content is feature docs still has nothing to run.

## 6. Empty repos get the normal empty-workspace home, not the prepare CTA
**Decision:** When the repo is empty (per decision 5), the full-body prepare CTA yields to the normal `EmptyWorkspace` home ("Select a feature to begin" + New chat / Draft). The sidebar's quiet prepare rail row stays unchanged — preparation isn't hidden, just no longer pushed.
**Why:** For a born-empty project the genuine next step is to talk to it and cut the first feature, not to prepare a repo with nothing to run; the CTA there is a dead end that reads like a requirement.
