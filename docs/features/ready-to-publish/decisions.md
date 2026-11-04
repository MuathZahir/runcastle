# Ready to publish — decisions

Planned without the human (a self-planning run, 2026-11-03). Every decision
below is assumed until the human confirms it. One independent challenger read
the brief and these decisions; decisions 4, 9, 13, 14, 15, 16 and 17 were
changed after it, and 18 to 21 come from the branches it raised.

Decisions 8, 9, 13 (the banner), 16 and 17 are designs. Per the brief's working
agreement they wait for the human's own yes: the screens are left uncommitted
until then, and the redrawn banner is shown to the human before the review
round.

On 2026-11-04 the human approved all seven designs in the Design tab. The
project's orchestrator then agreed the plan as it stands and started round 1,
under the brief's working agreement; the human has not confirmed the decisions
themselves, so they stay assumed.

## 1. The README is fixed to the app; the server does not open a browser
**Decision:** The README says what the app does today: run `runcastle`, then open the address it prints. The server does not open a browser by itself.
**Why:** runcastle often runs where no browser can open (a VPS, SSH, WSL, a container), and the owner runs it that way. Detecting a desktop reliably on three platforms is new machinery for a one-click saving; most terminals already make the printed address clickable.
**Assumed.** Alternative: open the browser on the first boot of a desktop install.

## 2. The README shows the four stages the app shows
**Decision:** The README's loop is the app's four stages, Planning, Build, Review and Shipped (the names the app's stage icons carry), told as they work now: you talk the feature through with its agent, say yes to its plan, rounds of workers build it, a review round checks it, you test drive and merge. The six-phase table, the "gates with overrides" paragraph and the "two clicks" claim go, because the app has none of them.
**Why:** The brief asks for the README to match the UI, and the UI has four stages and no gate overrides.
**Assumed.** Alternative: keep six phases in the README as a finer account of the same work.

## 3. Code names stay; only words a person reads change
**Decision:** The sweep changes text a person reads: UI strings, error messages shown in the app, the README, CLI output, and the skill text that shapes what agents say in chat. Code identifiers, database tables, tRPC and MCP names, settings keys and CLI command names keep their old names (`burns`, `dispatch_round`, `runcastle build-image`). Settings search keeps the old words as aliases, so typing "burn" or "AFK" still finds the page.
**Why:** Renaming identifiers is a wide refactor with migrations and no reader. Keeping old words as search aliases helps anyone who learned them.
**Assumed.** Alternative: rename identifiers too, so code and UI agree.

## 4. The usage ping stays on by default, is told before it is sent, and turns off in Settings
**Decision:** The usage ping (the boot request that checks for a newer version and counts the install as active, carrying a random install ID, the version and the platform) stays on unless the human turns it off. The first-run wizard says what it sends, with a checkbox that is ticked by default, and Settings → General gets the same switch. A fresh install sends nothing to runcastle's endpoint until the human has passed that wizard step; until then the update check asks npm directly. `DO_NOT_TRACK` still turns it off whatever the switch says. Turning it off keeps the update banner, which then asks npm. The README says it in one line beside the install commands, and keeps the full account further down.
**Why:** The ping is anonymous and small, and an opt-in count would be near zero, which makes it useless for knowing whether anyone uses runcastle. What the brief objects to is that it is hidden, so it is told up front, before the first send, with a one-click way out.
**Assumed.** Alternative: make it opt-in (off until the human ticks it).

## 5. E2E-FINDINGS.md and the unused stub error class are deleted
**Decision:** The root `E2E-FINDINGS.md` (a build-era test log carrying the owner's Windows path and private setup) is deleted; git history keeps it, and the feature docs that cite it stay as written. The never-thrown "not yet implemented" stub error class and its error mapping go, with the comments that still describe stubs. `CLAUDE.md`, `CONTEXT.md` and `docs/features/` stay, and the README gets one line saying `docs/features/` is runcastle's own build record, made with runcastle.
**Why:** Nothing reads the findings log but old feature docs, and the stub class has no caller. Deleting beats moving: a moved file still carries the private path.
**Assumed.** Alternative: move the findings log under `docs/` with the private details scrubbed.

## 6. The README says up front that building needs a container runtime and agent credentials
**Decision:** The README's prerequisites list two tiers in one table near the top: what you need to run runcastle at all (Bun, Git, a signed-in Claude Code or Codex), and what you need before the first round of workers can build anything (Docker or Podman running, and agent credentials: `runcastle token` for Claude Code, `codex login` for Codex). The wizard's workers step stays skippable but says plainly that you need it before your first round.
**Why:** Talking a feature through works without a container, so the wizard should not block on it; but a stranger should not learn at their first round that nothing can build.
**Assumed.** Alternative: make the workers step required in the wizard.

## 7. Turning on the phone link names the tailnet's one-time HTTPS step
**Decision:** When Tailscale answers "Serve is not enabled on your tailnet" with a "To enable, visit" address, runcastle stops waiting at once and shows a plain step instead of raw CLI output: "Your tailnet needs HTTPS turned on once", with that address as a link (Tailscale's DNS admin page when no address was printed) and a Try again button. The Linux operator hint keeps working as it does.
**Why:** Tailscale's own docs say Serve needs HTTPS certificates enabled once per tailnet, and a non-interactive run cannot click through that consent; today the human waits for the timeout and then reads CLI text.
**Assumed.** Alternative: have runcastle enable HTTPS through Tailscale's API (needs an API key from the human).

## 8. The phone half is a short numbered walkthrough beside the QR code
**Decision:** With the link on, the "On your phone" section shows four numbered steps beside the QR code: install Tailscale on the phone, sign in to the same Tailscale account, scan the code, add the page to the home screen. Under them one line says that on an iPhone, notifications only work from the home-screen app. Before the link is on, the section shows the same steps greyed, so the human sees the whole path before starting.
**Why:** The brief asks for a real walkthrough; four steps are the whole job, and the iPhone limit is the one surprise that costs people notifications.
**Assumed.** Alternative: a single paragraph with the same facts.

## 9. The phone setup is findable from a help menu and the command menu
**Decision:** The sidebar's bottom row (Settings, theme, notifications) gains one question-mark icon. It opens a small help menu with two entries: "Glossary" (decision 16) and "Use runcastle on your phone", which opens Settings → General at "On your phone". The command menu (Ctrl+K) gets the same two entries, and the README gets an "On your phone" section. On a phone itself the phone entry is not shown.
**Why:** Nothing in the app points at the section today. One icon with a menu adds a single control to a row that already holds three, where a phone icon and a help icon would add two.
**Assumed.** Alternative: a phone icon of its own in the bottom row.

## 10. On a phone, a notice whose fix needs the computer says so
**Decision:** In a phone chat, a notice whose fix needs the desktop (a drive, a terminal, uncommitted changes to commit) says "on your computer" and offers no button that cannot work there; notices whose fix works from the phone keep their button. This closes the open item left by the phone feature.
**Why:** Hiding them would hide real problems; offering a button that cannot work on a phone is the bug.
**Assumed.** Alternative: hide desktop-only notices on a phone.

## 11. The live phone check and the clean-machine installer tests are left to the human
**Decision:** The build tests the phone link's server side against fakes of the Tailscale CLI, including its "Serve is not enabled" output. Scanning the code on a real phone over a real tailnet, and running the macOS and Windows installers on clean machines, need the human's phone, tailnet and machines: the outcome lists them as still to do, with the exact steps.
**Why:** No agent here has a phone or a clean VM, and the brief says not to fake it.
**Assumed.** Alternative: hold the merge until the human has run them.

## 12. The README documents running runcastle on another machine
**Decision:** A README section "On another machine" says that runcastle listens on 127.0.0.1 and needs two ports: 4512 for the app and 4514 for designs. It gives the SSH form, `ssh -L 4512:localhost:4512 -L 4514:localhost:4514 user@host`, and says the phone link (Tailscale) serves both ports for you. It links the VPS guide on runcastle.dev for the server setup.
**Why:** The owner runs runcastle this way, and a design view that loads nothing because 4514 was not forwarded is the trap. The design pass-through on the app port plus two shipped with the designs feature.
**Assumed.** Alternative: describe only the Tailscale route.

## 13. The README's screenshots and banner are recaptured after the sweep
**Decision:** After the words change, every README screenshot that shows an old word or the six phases is recaptured from the real app on a scratch data dir, the way the current ones were made. The banner's six coloured phase blocks become the four stages. The lead does this between the build round and the review round, so the review checks the README with its new pictures. The banner is a design, so the lead shows it to the human for their yes before the review round; the screenshots are captures of approved screens and need none.
**Why:** A README whose pictures say "Burn 10 tickets" and show six phases contradicts its own text. Capturing needs the running app with sample data, which a sandboxed worker cannot set up.
**Assumed.** Alternative: keep the old pictures and fix only the text and alt text.

## 14. runcastle.dev is not part of this feature
**Decision:** The website's pages under `site/` keep their words; only the README's pictures, which happen to live in `site/assets/`, change (decision 13). The site's redesign lives on a separate, unmerged branch, so sweeping it here would collide. The README is the stranger's first read on GitHub and npm, and that is what this feature fixes. The outcome lists every old word and the six phases still on the site, as a handoff to the redesign branch.
**Why:** Two branches rewriting the same pages would conflict, and the site's own redesign is the right place to adopt the new words.
**Assumed.** Alternative: sweep `site/` too in this feature.

## 15. One word per concept
**Decision:** Every place a person reads uses these words, and only these:

| Concept | The word | Retired from what people read |
|---|---|---|
| A batch of tickets built unattended, after your yes | **round** | burn, AFK burn, run (as a noun), lane, lap |
| The sandboxed agent that builds one ticket | **worker** | burner, lane, AFK agent |
| Building unattended, as a property | **unattended** | AFK |
| A conversation with an agent | **chat** | thread, session, conversation |
| The project-level agent, above the features | **orchestrator** (its conversations are orchestrator chats) | project session, project chat |
| Running the app to try it | **test drive**, with its scope beside it where both exist: "Test drive · this feature", "Test drive · main" | drive mode, project drive |
| A feature's stages | **Planning, Build, Review, Shipped** (as the app's stage icons already say) | ideation, spec, tickets (as stages) |

"Round" and "worker" are kept because the app already says them most (about 200 "round" strings against about 40 "burn"), and the agents' own skill text uses them. "Chat" is kept because the create menu and phone already say "New chat"; "New thread", "Conversations" and "Sessions" become "New chat", "Chats" and "Chats". A drive of what has shipped is still a test drive; its scope ("main") is shown beside the word rather than making a second name. Review package, scenario, preparation and backlog keep their names and get glossary entries.
**Why:** The brief asks for one name per concept. Choosing the words the app and agents already lean on keeps the sweep smallest and the result most familiar.
**Assumed.** Alternative: keep "burn" as the verb for starting a round ("Burn 3 tickets"), as the README and early UI did.

## 16. A short glossary, opened from the help menu and the command menu
**Decision:** A Glossary dialog lists sixteen terms in four groups, each with one plain sentence: feature, chat, plan, design, ticket, backlog, note; round, worker, review round, review package; test drive, scenario, preparation; orchestrator, held by. The help menu (decision 9) and a "Glossary" entry in the command menu open it, and it has a filter box. Every definition lives in one list that the inline hints (decision 17) read too, so the app says the same sentence everywhere.
**Why:** The brief asks for a glossary reachable from the app. The bottom row already holds the machine-level controls, and one shared list keeps the definitions from drifting.
**Assumed.** Alternative: a Glossary page inside Settings instead of its own dialog.

## 17. A term is explained where a newcomer first meets it, by a dotted underline
**Decision:** At a fixed set of first-meeting places (the plan's round count, the test drive button, the review package's heading, the orchestrator's header, the "held by" line, the scenario picker, the preparation screen, the workers step of the wizard) the term gets a dotted underline; hovering, focusing, clicking or tapping it shows its one-line glossary sentence and a link that opens the Glossary at that term. Tapping matters because the app is used from phones, which have no hover. Other mentions stay plain text.
**Why:** The brief asks for a one-line explanation where a term first appears. An underline adds no words to the screen, which suits a quiet workbench; underlining every mention would turn the app into a document.
**Assumed.** Alternative: write the explanation as visible text under each term's first appearance.

## 18. Existing installs are told about the usage ping once
**Decision:** An install that already has an install ID (so it finished the wizard before this change) shows a one-time notice, in the update banner's place, saying what the ping sends, with "Turn off" and "OK". Either answer records the choice and the notice never comes back.
**Why:** The wizard disclosure (decision 4) only reaches new installs; people who installed earlier would otherwise keep sending it without ever being told in the app.
**Assumed.** Alternative: rely on the README and the new Settings switch for existing installs.

## 19. The one-line pitch stops saying "burn"
**Decision:** The command-line help, `package.json` description and README tagline all use the README's existing line, "Idea in, merged branch out. On your machine, in your repo." The GitHub repository description is the human's to set; the outcome names the line to paste.
**Why:** The CLI help still says "burn tickets into shipped features", which decision 15 retires, and the README's tagline already reads well without insider words. Changing the GitHub description is an outward-facing act on the human's account.
**Assumed.** Alternative: write a new tagline for launch.

## 20. Glossary entries name the words they replaced
**Decision:** The glossary entries for round, worker, chat and test drive end with a quiet "Once called: …" line (for example "Once called: burn, AFK burn, lap").
**Why:** Old chats, plans and feature docs keep the old words, and so does every early user's memory; one line lets them map old to new without hunting.
**Assumed.** Alternative: leave old words out of the app entirely.

## 21. The README says where to report bugs
**Decision:** The README gets a short "Feedback" line pointing at the repository's GitHub Issues. It puts no maturity label (alpha, beta) on the product; that is the human's call to add.
**Why:** A stranger who hits a problem needs one obvious place to say so; how to label the product's maturity is a launch decision, not a wording one.
**Assumed.** Alternative: also label the README "beta".

## 22. The sibling feature's new card text follows these words
**Decision:** "Orchestrator actions show as cards" runs in parallel and reads its words from decision 15. If it merges first, this feature's word sweep and its guard test cover its card text when this branch takes main; if this feature merges first, the guard test is what tells the sibling which words to fix. No ticket here waits for it.
**Why:** The brief's addition says whichever merges second fixes the words; the guard test (spec, "Words") makes that a failing test rather than a reading job.
**Assumed.** Alternative: hold this feature until the sibling merges.
