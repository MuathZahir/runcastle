# Decisions — Flow redesign: project chat and creation doors

## 1. The flow map is confirmed, and the list's server halves are in scope
**Decision:** The walked flow map (project workspace at rest → live chat → reopen/transcript; the Quick overlay in both modes; draft body → Start; delete; the chat's own `create_feature` door) is the surface this feature redesigns. Conversation identity (one row per Claude Code conversation, grouped by `ccSessionId`) and conversation title derivation are in scope even though they are server changes, because they *are* what the list shows.
**Why:** Walked live on 2026-08-28 against the installed app: reopening a chat provably creates a duplicate row sharing the same `cc_session_id` (three duplicate pairs in the runcastle project), and only 4 of 19 rows there have a human-readable title (`<command-name>/clear…`, `[Image #1]…`, `[Request interrupted by user]`, "date unknown"). A redesigned list over that data would still be unusable, so the data rules ride with the page. The resume greeting for project chats already works (the ux-issues "left undone" note is stale on that point) and needs no work.

## 2. One lap, no map
**Decision:** Spec the whole flow in one lap; no waypoint map.
**Why:** Settled scope — one page, two forms, one dialog — with nothing to research or prototype before decisions can lock. An HTML prototype is produced at the end of ideation so the human sees the result before spec (human's request).

## 3. The landing branch is a launch-time choice on the New chat card
**Decision:** The "this chat's work lands on" select leaves the page chrome. It becomes a small inline branch menu beside **New chat** (`landing on main ▾`); while a chat is live the strip shows the branch it launched with as a static chip. The pick still persists per project (`settings.sessionBranch`); the detected/picked origin is only the menu's default label; "branch gone" is the one error state and blocks New chat until another is picked. The grey explanatory note is deleted. The menu hides `runcastle/*`, `worktree-*` and `afk/*` branches.
**Why:** The control only affects the *next* launch, so a standing setting that is live during a chat is a lie the page had to explain in grey text. Putting the choice at the moment it applies removes the note, the chip and the confusion at once.

## 4. A list row is one Claude Code conversation
**Decision:** Rows sharing a `ccSessionId` collapse into one row, dated by the first launch, marked open when its latest session is live; Reopen resumes the latest session. Session rows with no `ccSessionId` (never picked up) are not listed at all.
**Why:** `--resume` keeps the CLI session id, so every Reopen was minting a duplicate row of the same thread. A never-started row has nothing to read or resume; a greyed row with a disabled Reopen is clutter, not information.

## 5. Titles come from the first substantive human turn
**Decision:** Title derivation skips slash-command turns (`<command-name>…`), `[Request interrupted by user]`, and strips `[Image #n]` tokens before eliding. No such turn → "Untitled", not cached. Titles already cached from junk (starting with `<command-name>` or `[`) are cleared once so they re-derive.
**Why:** 15 of 19 rows on the runcastle project were named after a `/clear`, a `/model`, an image paste or an interruption — the first user turn is not the first thing the human *said*.

## 6. Project workspace at rest: header line, New chat card, conversations — nothing else
**Decision:** Three pieces. (1) Header: `PROJECT · <name>` and one quiet line "Chats run on runcastle/project and land on <branch>." — replacing the consequence sentence, the static branch chip and the landing note. (2) New chat card: "Talk it through", one line of copy ("Bring a raw idea; the chat checks it against what's built and cuts it into features."), **New chat** with the `landing on <branch> ▾` menu. (3) `CONVERSATIONS`: rows of title · relative date · open dot; the row opens the transcript pane; **Reopen** is a ghost button revealed on hover/focus and repeated in the pane. Empty state is one dim line. The "What every chat here already has" card is deleted, with no tooltip replacement.
**Why:** The page was carrying first-use explanation on every visit; the chat's own greeting already says what it knows. A returning user needs the door and the history, spaciously, and nothing that reads like a manual.

## 7. A live chat is the whole body, and the list is one click away without ending it
**Decision:** Live: the terminal fills the body under a strip of `← Conversations` · title chip · live dot · `→ <branch>` chip · short id · **End session**. Going back shows the list with the open conversation as the top row (open dot); its action reads **Open** and simply re-shows the running terminal (reattach, no launch). Transcript stays available on an open conversation.
**Why:** The only exit from a live chat was End session — a dead end on the map. The rail's pinned row already reports `live`, so leaving loses nothing.

## 8. The Quick overlay: one line per mode, picker in the footer line, Notes for drafts
**Decision:** Two tabs kept; both explanatory paragraphs deleted. One line under each heading — Quick change: "Each sentence becomes a ticket; you review, then burn." Park a draft: "A row and a title. Nothing is cut until you Start it." Title input, ticket rows and `+ Add another` stay. The base picker becomes the inline `from <branch> ▾` inside the footer summary line `feature/<slug> · from main ▾ · N tickets + review`; that line plus the button label **Create feature** carry the "this is its own feature" message. Park a draft gains an optional **Notes** textarea stored as the draft's brief.
**Why:** The overlay explained itself in two paragraphs and still buried what mattered (a new branch, a review ticket). A draft parked from Quick could never carry a brief, so its body always read "No brief yet".

## 9. Spacing is on a deliberate rhythm across the whole flow
**Decision:** Every surface in this flow uses one vertical rhythm on Tailwind's 4px scale: 8px inside a control group (label→control, tab→heading), 16px between fields, 24px between sections/cards, 32px between the header and the body. No two adjacent elements closer than 8px or farther than 32px unless one is a section boundary.
**Why:** The human's observation of the current pages: some elements cramped, some stranded. The redesign is judged on spaciousness, so the rhythm is a rule, not taste.

## 10. The draft body shows the idea; the bar owns Start and the base
**Decision:** Draft body = `PARKED` kicker · title · one-liner · brief/Notes as Markdown (empty: one dim "No notes." line). The next-step bar keeps **Start** and gains the inline `from <branch> ▾` picker beside it — always visible, no `Advanced` disclosure. With no usable base the menu reads `from … ▾` in the warn colour and Start is disabled with "pick a branch first".
**Why:** The body repeated what the bar already said about Start, and the one control the human might need sat behind a summary reading "Advanced".

## 11. Delete and the transcript pane: keep the idea, restyle on the primitives
**Decision:** Delete keeps type-the-slug arming, rebuilt on `Dialog` (sm) + `Field`, with a two-sentence lead ("Permanently delete **Title**? Its worktree, branches, running agent and all runcastle data go with it; committed docs stay in git history." + bold "This cannot be undone."). The transcript pane header is `← Conversations` · title · date · Reopen/Open; bubbles stay plain but assistant bubbles render Markdown; the empty states collapse to one dim line naming the case.
**Why:** Both work; the prior audit called delete exemplary. Real transcripts showed `##` and `**` literally.

## 12. New always means a new chat; the one-at-a-time rule is shown in place
**Decision:** The rail's **New** with a chat already live navigates to the project workspace and shows an inline notice on the New chat card — "A chat is already open." with **Open it** and **End it and start new** (ends the live session and launches fresh in one click). No toast, no silent redirect.
**Why:** New's contract is a fresh conversation (`ux-issues`); the launcher allows one live project session per project. The choice belongs where the rule bites, not in an error toast.

## 13. Legacy CSS for this flow is deleted; the files are restructured
**Decision:** Every `styles.css` rule this flow owns (`.pw-*`, this page's `.ws-*`, `.nf-*`, `.qf-*`, `.draft-*`, `.delete-dialog*`, `.convo-*`) is deleted and the surfaces are rebuilt on the primitives with inline Tailwind; shared rules (`.grill-*`, `.peek*`) stay for their owning flows. `ProjectWorkspace.tsx` splits into list, live strip and transcript pane; `QuickForm.tsx` becomes two mode components over a shared shell; the inline branch menu is one primitive (`BranchMenu`) shared by the New chat card, the Quick footer and the draft bar.
**Why:** The migration rule for every flow feature, and the brief puts code quality of these files in scope.
