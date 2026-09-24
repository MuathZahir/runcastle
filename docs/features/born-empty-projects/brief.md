## Why this feature exists

Runcastle's onboarding assumes an existing, committed codebase. Someone starting a brand-new project in an empty folder hits three walls in a row, observed by the human on 2026-09-20 while creating a project for `jev-browser-extension`:

1. **Non-git folder:** the open-project screen refuses with "Not a git repository" and a `git init` hint — the human has to leave runcastle, run `git init` themselves, and come back.
2. **Zero-commit repo:** after a manual `git init`, creating a project chat session fails with `fatal: not a valid object name: 'main'` (screenshot on record). Diagnosis: `git init` creates an **unborn HEAD** — no commit, so no `main` ref — and the project-session launcher tries to cut `runcastle/project` from `main`. The whole pipeline shares this assumption: feature branches, worktrees, and test drives all cut from a ref that must resolve to a commit.
3. **Preparation pushed at an empty project:** `improve-preparation` (shipped) deliberately made the whole empty-project page a CTA to prepare — designed for existing codebases. For a repo with no code there is no dev command, no drive setup, nothing to establish; the CTA is a dead end that reads like a requirement.

## The shape of the fix

- **Offer, not hint.** When the picked folder is not a git repo, the error becomes an offer: runcastle runs `git init` in that folder on the human's confirmation. This upgrades a settled decision — `docs/features/flow-redesign-onboarding-and-project-chooser/decisions.md` #(open screen): "Errors state the problem once ('Not a git repository' + `git init` hint)" — from hint to action. Keep the decided copy discipline (problem stated once, path shown once).
- **The unborn-HEAD question is the design center.** Two candidate answers, to be settled in the grill: (a) runcastle makes an initial commit at init time (what does it commit — empty commit? a scaffolded `.gitignore`/README?), or (b) the launcher and branch machinery tolerate an unborn HEAD. Note (b) also covers people who ran `git init` manually, like the human did — (a) alone leaves the screenshot bug reachable. Possibly both. The launcher seam was hardened before against a different failure (`project-chat-branch-collision`, shipped — stale-branch recut in packages/server launcher/git services); this is the same seam's remaining hole.
- **Preparation CTA for empty repos:** softened, deferred, or replaced with an empty-project-appropriate next step. What "empty" means here (no commits? no recognizable manifest?) is a grill question.

## What it must NOT swallow

- No redesign of the onboarding/chooser flow — `flow-redesign-onboarding-and-project-chooser` (shipped) owns that design; this changes one error state's behavior within it.
- No redesign of preparation itself — `flow-redesign-preparation` and `improve-preparation` (both shipped) own that surface; this only conditions when it is urged.
- No scaffolding of the user's application code — runcastle initializes the *repo*, never the project's stack.

## Already settled nearby

- Non-git error copy discipline: flow-redesign-onboarding-and-project-chooser decisions.md.
- Empty-page prepare CTA and interactive-only preparation: improve-preparation.
- Launcher resilience precedent (delete-and-recut of the runcastle-owned `runcastle/project` branch): project-chat-branch-collision.
