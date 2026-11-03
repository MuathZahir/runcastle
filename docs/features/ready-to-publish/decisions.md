# Ready to publish — decisions

Planned without the human (a self-planning run, 2026-11-03). Every decision
below is assumed until the human confirms it.

## 1. The README is fixed to the app; the server does not open a browser
**Decision:** The README says what the app does today: run `runcastle`, then open the address it prints. The server does not open a browser by itself.
**Why:** runcastle often runs where no browser can open (a VPS, SSH, WSL, a container), and the owner runs it that way. Detecting a desktop reliably on three platforms is new machinery for a one-click saving; most terminals already make the printed address clickable.
**Assumed.** Alternative: open the browser on the first boot of a desktop install.

## 2. The README shows the four stages the app shows
**Decision:** The README's loop is the app's four stages, Planning, Building, Review and Shipped, told as they work now: you talk the feature through with its agent, say yes to its plan, rounds of workers build it, a review round checks it, you test drive and merge. The six-phase table, the "gates with overrides" paragraph and the "two clicks" claim go, because the app has none of them.
**Why:** The brief asks for the README to match the UI, and the UI has four stages and no gate overrides.
**Assumed.** Alternative: keep six phases in the README as a finer account of the same work.

## 3. Code names stay; only words a person reads change
**Decision:** The sweep changes text a person reads: UI strings, error messages shown in the app, the README, CLI output, and the skill text that shapes what agents say in chat. Code identifiers, database tables, tRPC and MCP names, settings keys and CLI command names keep their old names (`burns`, `dispatch_round`, `runcastle build-image`). Settings search keeps the old words as aliases, so typing "burn" or "AFK" still finds the page.
**Why:** Renaming identifiers is a wide refactor with migrations and no reader. Keeping old words as search aliases helps anyone who learned them.
**Assumed.** Alternative: rename identifiers too, so code and UI agree.

## 4. The usage ping stays on by default, is told before it is sent, and turns off in Settings
**Decision:** The usage ping (the boot request that checks for a newer version and counts the install as active, carrying a random install ID, the version and the platform) stays on unless the human turns it off. The first-run wizard says what it sends, with a checkbox that is ticked by default, and Settings → General gets the same switch. A fresh install sends nothing to runcastle's endpoint until the human has passed that wizard step; until then the update check asks npm directly. `DO_NOT_TRACK` still turns it off whatever the switch says. Turning it off keeps the update banner, which then asks npm.
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

## 9. The phone setup is findable from the sidebar and the command menu
**Decision:** A phone icon joins the sidebar's bottom row of icons (beside Settings, theme and notifications) and a "Use runcastle on your phone" entry joins the command menu (Ctrl+K); both open Settings → General at "On your phone". The README gets an "On your phone" section. On a phone itself the icon is not shown.
**Why:** Nothing in the app points at the section today. The bottom row is where the machine-level controls already sit, and the command menu is where a searcher looks.
**Assumed.** Alternative: only the command menu entry and the README, with no new icon.

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
**Decision:** After the words change, every README screenshot that shows an old word or the six phases is recaptured from the real app on a scratch data dir, the way the current ones were made. The banner's six coloured phase blocks become the four stages. The lead does this between the build round and the review round, so the review checks the README with its new pictures.
**Why:** A README whose pictures say "Burn 10 tickets" and show six phases contradicts its own text. Capturing needs the running app with sample data, which a sandboxed worker cannot set up.
**Assumed.** Alternative: keep the old pictures and fix only the text and alt text.

## 14. runcastle.dev is not part of this feature
**Decision:** The website's pages under `site/` keep their words; only the README's pictures, which happen to live in `site/assets/`, change (decision 13). The site's redesign lives on a separate, unmerged branch, so sweeping it here would collide. The README is the stranger's first read on GitHub and npm, and that is what this feature fixes.
**Why:** Two branches rewriting the same pages would conflict, and the site's own redesign is the right place to adopt the new words.
**Assumed.** Alternative: sweep `site/` too in this feature.
