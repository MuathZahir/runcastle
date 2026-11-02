# Small fixes before publish

## Problem

The pre-publish audit found ten small places where runcastle stops, strands or misleads the human:

- Some agent sessions still stop to ask permission, which stalls them while the human is away.
- A server restart during a test drive leaves the main checkout on the feature branch with its stop script never run, and the app says nothing is driving.
- "A drive is already active" and "Cannot merge while a test drive is active" do not say which drive, or how to stop it.
- A merge refused on a dirty checkout does not say which files, and the agents' own feature docs can be what blocks it.
- Sending drive notes leaves the drive running, and a forgotten drive blocks the lead's rounds and every other merge.
- Saying "all good" after a drive means typing it.
- A round halted by the provider shows "Waiting for you · provider limit" with nothing to click, no reset time, and billing and sign-in problems lumped in or shown raw.
- The merge toast says "feature shipped" when nothing was pushed.
- The chat box drops non-picture files without a word.
- Deleting a project note takes its screenshot with no warning, and a screenshot can only be pasted.

## Approach

Each fix is small and stands alone. Decision numbers refer to `decisions.md`.

**1. Permissions (decisions 1–3).** Every Claude session kind launches in `bypassPermissions`: the setup session, the Fix-it chat and the scenario chat join the lead and the orchestrator. The human's own `ask` rules keep prompting, because Claude Code evaluates them under that mode and over a hook's `allow`. The launch input in the thread launcher stops gating the mode on runtime and kind for Claude. On Codex, the lead (`chat`, `side`) gets `bypassPermissions` too, which the Codex runtime already maps to `danger-full-access` with approvals `never`. Codex host-side kinds keep `workspace-write`. The pre-allowed git rules in the session settings become moot under bypass; keep the MCP allow rules and the skill-pack read rules, and drop the narrowed host-side git rules along with the comment that explains them.

A new **checkout guard** joins the pre-tool hook for the three host-side kinds (`prepare`, `drive-fix`, `scenario`), on both runtimes, beside the edit and install guards. It reads shell commands with the same light parser the lead's line guard uses, and refuses:
- `git add` of a path outside what that kind may write (`.runcastle/` and `.gitignore`; `.runcastle/` only for a scenario chat), including `-A`, `--all` and `.`; the scenario setup errand (`purpose: scenario-setup`) is exempt from this rule only;
- `git commit` with `-a`/`--all`, or with any path staged outside what that kind may write. The hook probes `git diff --cached --name-only` (IO in the hook, like the merge-in-progress probe) and names the paths it found;
- `git checkout`/`switch` to another branch, `reset`, `stash`, `clean`, `restore`, `rebase`, `merge`, `push`, `branch -d/-D`.

Anything it cannot read is allowed. Each refusal tells the agent why and what to do instead. The Claude allow answer the hook gives leads (`permissionDecision: allow`) becomes unnecessary under bypass. Keep it where the session's mode would still prompt, or remove it if no such case remains.

**2. Cut-off drives (decisions 4, 5, 13, 14).** On boot, after sessions and runs are reconciled, each project is checked once. The server finds the newest drive-start event of each kind (`testdrive.started`, `projectdrive.started`, `prep.dryrun.started`) that has no matching stop after it. For a feature drive (any purpose, a review agent's drive included, since it switches the checkout the same way) it also requires that the main checkout's HEAD is that feature's branch. For a match, it puts a drive record back in the project's slot with a new `cutOff: true` flag, no dev pane and no readiness poll. For a feature drive, `previousBranch` comes from the start event's data, and the base branch is the fallback. `activeDriveInfo` reports `cutOff`. Stop is the normal stop path for that drive kind: the stop script runs, `drive.env` is deleted, and a feature drive checks out `previousBranch`. Every existing stop entry works on it unchanged: the Stop button, the orchestrator's `drive` tool with `stop`, and a merge or delete that auto-stops. Shutdown is unchanged.

The UI shows a cut-off drive wherever it shows a drive, with the words "cut off by a restart" and a Stop button. The drive page does not offer to open a dev server for it.

**3. Named blockers (decision 6).** Every refusal caused by the drive slot uses the server's existing `slotHeldReason(held)`, which is already used for project drives. That covers the feature-drive start (`DENY_ACTIVE`), the dry-run start and the merge's "test drive is active" refusal. On a feature's page, the standing notice with Stop shows for any drive held by something other than this feature's own drive. The holder sentence comes from the existing web helper. Stop calls the right mutation for the holder's kind: feature drive, project drive or dry run. A live review agent's drive gets the notice without Stop, worded as ending with its review round. A cut-off drive gets Stop whatever its purpose, review included, because no round is behind it any more. The unused web `slotHeldReason` is either used for this or deleted.

**4. Merge on a dirty checkout (decision 18, which replaces 7).** The merge never commits anything itself. It computes the paths it would touch:
- the files the feature branch changes since its merge base with the base branch (`git diff --name-only <base>...<feature>`);
- when HEAD is not the base branch, the files that differ between HEAD and the base, since the merge checks the base out and back;
- every staged path, because git would record those into the merge commit.

It intersects that set with the dirty paths (tracked changes and untracked files). If anything is left, it refuses and names those files with the existing `truncatedFileList` (the first five, then how many more). Any other dirty file does not block the merge, docs-only noise included, and git carries it through untouched. The raw `git status` check goes.

**5 and 6. Drive notes (decisions 8, 9, 15).** While this feature's drive runs, the send line on the drive page and the after-drive notice in the chat offer two buttons. "Send and stop drive" is the primary: it stops the drive through the existing stop path, then sends the notes, and sends them even if the stop failed (that failure shows as a failed Stop does). "Send, keep driving" is the quieter one. When there are no unsent notes, the send line shows "All good" instead of nothing. It calls the existing `notes.send`, which already sends "Drive done, all good — no notes", and stops a running drive first in the same way.

Remove the note statuses nothing writes any more: `promoted`, `carried` and `done`, so only `open` is left. Remove every reader too: the client's send filter, the note row's "Promoted to #…" text, the drive-note store's `carried` check and the outcome's note resolution. A migration turns existing rows with those statuses into `open` and stamps `sentAt` where it is missing, so old notes are never sent again. The `ticket_id` column stays.

**7. Provider halt (decisions 10, 16).** The runner sorts a provider halt into three kinds using the halt headline it already reads:
- `usage`: usage limit, rate limit or quota. It tries to read a reset time from the headline: Claude's `…|<epoch seconds>` suffix, or a `resets <time>` phrase.
- `billing`: credit balance or billing.
- `auth`: authentication, unauthorized, invalid API key, or an OAuth or setup token.

It sets a waiting reason the status line recognises:
- "provider usage limit · resets 5pm" (or without the reset part when there is none);
- "provider billing problem — check your account";
- "provider sign-in failed — check your login or API key".

The status line shows Resume next to any of these. Resume calls a new feature-scoped mutation that delivers one message to the lead as the human ("The provider halt is cleared — pick up where the round stopped."). That delivery already clears the waiting reason.

**8. Merge toast.** It becomes "Merged into <base branch> on this machine — nothing was pushed".

**9. Chat box (decision 11).** When a paste or a file pick contains files that are not pictures, the composer attaches the pictures and shows a short error toast naming each file it skipped.

**10. Project notes (decision 17).** Delete in the notes card asks inline, "Delete this note and its screenshot?", with Keep and Delete. The wording drops "and its screenshot" when the note has none. The note capture form gets an "Add picture" file button (`accept="image/*"`) beside paste. It uploads through the same function paste uses, following the drive notes' picture button.

## Seams

- **Thread launch input** (existing): the permission mode each session kind and runtime launches with. A unit test covers the kind × runtime table.
- **Pre-tool guard evaluation** (existing, extended): a new pure `evaluateCheckoutGuard` beside the edit, install and lead guards, tested on commands. The hook route wires it in and supplies the staged-paths probe.
- **Drive slot API** (existing): `activeDriveInfo`, `testDrive(stop)`, `stopProjectDrive` and the dry-run stop, now also used for cut-off records. Add a new boot function, `recoverCutOffDrives(ctx)`, that is testable against a scratch repo with seeded events.
- **Slot refusals** (existing): the start and merge refusals, which should now carry the holder's name.
- **`mergeFeature`** (existing): the dirty refusal, its file list, and a merge that goes ahead past unrelated dirty files.
- **`notes.send` and the drive stop mutations** (existing): the web flows compose them.
- **Runner halt classification** (existing, extended): a pure function from a halt headline to `{ kind, resetsAt? }`, plus a new tRPC `feature.resume` mutation over `deliverToLead`.
- **Web components** (existing): the standing notices, the drive notes send line, the drive chat notice, the feature status line, the composer, the notes card and the note capture form. They are tested at the component tier `apps/web/STYLE.md` describes.

## Out of scope

- Header buttons, state words, pings, permission prompts shown as a waiting state, and rounds killed by a restart all belong to the sibling feature "You always know what's waiting".
- Vocabulary renames belong to "Ready to publish".
- Attaching non-picture files to a chat turn.
- Resuming by itself at a provider's reset time.
- Stopping drives on server shutdown.
- Restarting the review round whose drive was cut off: that belongs to the sibling feature, which owns restart-killed rounds. This feature only returns the checkout.

## Open questions

- **Overlap with "You always know what's waiting"**, which runs in parallel. Both touch the feature status line (Resume here, state words there) and possibly the thread launcher. Whichever merges second resolves the conflict. The Resume button should sit in the status line's existing action slot, so the sibling's wording changes can wrap it.
- **How Claude Code words a usage limit.** It changes between versions, so reading the reset time is best-effort. With no reset time, the line still says "provider usage limit" and still offers Resume.
