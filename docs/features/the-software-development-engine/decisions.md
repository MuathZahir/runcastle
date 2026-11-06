# Decisions — The software development engine

Planned without the human on 2026-11-05 (a headless planning run). Every decision
below is assumed until the human confirms it.

Check first: 1, 2, 3

## 1. The fixes land in the generated files; the canvas edits are handed over
**Decision:** The lead edits `site/index.html` and `site/landing.css` directly, so they read
exactly as the next port would write them, and records in this file the four edits the
human must make on the design canvas ("Runcastle Landing Refresh", `project/Main.dc.html`)
so that port does not undo them (see "Canvas edits for the human" below).
**Why:** The canvas cannot be reached from a headless run: the DesignSync tool refuses
until the human runs `/design-login` in an interactive session. The brief names this
fallback. The edits are four small text changes, so the hand-off is cheap and checkable:
after the human edits the canvas, re-running the port must show no diff.
**Assumed.** Alternative: wait until the human runs `/design-login`, then edit the canvas
and re-port, so the canvas stays the only place the page is changed.

## 2. The headline sets as two lines on desktop
**Decision:** The headline becomes "The software development engine." with a fixed line
break after "The software", so desktop reads "The software / development engine." Its
largest size drops from 64px to 58px so the second line fits the hero's left column (529px
at every desktop width). Below that cap it scales with the window as before; a tablet-width
single column also reads as two lines, and a 390px phone keeps the three lines measured
earlier. The subtitle paragraph is deleted and nothing else moves: the install chip rises
into its place with the existing gap.
**Why:** With the subtitle gone the headline is the hero's only text, and "engine." alone on
a third line read worse. A slightly smaller headline beats widening the column, which would
push the headline into the scene on the right. Checked in a browser at 1440, 1366, 1280,
1024, 820 and 390px: two lines on every desktop and tablet width, and the install chip ends at
515px, above the fold of a 1366x768 laptop.
**Assumed.** Alternative: keep the 64px headline on three lines ("The software / development /
engine."), the plan as first drawn.
**Changed by the orchestrator:** it took the challenger's side and asked for two lines on
desktop, by a smaller headline or a wider column, whichever reads best.

## 3. The page does not guess or remember the visitor's system
**Decision:** macOS and Linux stays the default. The Windows button now works, and the
choice made in the closing install section also changes the hero's install chip (they
already share one state). The page does not read the visitor's operating system, does not
remember the choice across visits, and the hero gets no switch of its own.
**Why:** The brief asks for the button to work and for no other landing changes, and the
hero is kept to a headline and one command on purpose. Guessing the system would also be a
fourth edit to hand over for the design canvas, since the page's script is generated from it.
**Assumed.** Alternative: preselect Windows when the browser reports Windows, so a Windows
visitor's hero chip shows the PowerShell command from the first glance.
**Challenged:** the bug is about Windows visitors not getting their command, and the hero
command is the first one they see; on the default, most of them meet `curl | bash` and never
scroll to the switch.

## 4. The lead builds it; one review round closes it
**Decision:** The lead makes the change in this checkout (no worker tickets), then runs one
review round: a single review ticket that loads the page, presses both buttons at desktop
and phone widths, checks Copy, and screenshots the hero and the social card.
**Why:** It is about ten lines across two files plus a recaptured image; a worker would spend
more on its container and install than on the change.
**Assumed.** Alternative: hand the change to a worker ticket.

## Canvas edits for the human

The landing page is generated from the design canvas. Make these four edits in
`project/Main.dc.html` before the next port, or the port will undo this feature:

1. In the hero, change the headline `<h1 class="hl">` text from
   `The IDE for agents.<br>You make the calls.` to `The software<br>development engine.`
2. Delete the hero's subtitle paragraph, the `<p class="lede">` that starts
   "Plan, build, review and test with agents…" (only the hero's one; the other bands keep theirs).
3. In the stylesheet, add `pointer-events:none` to the closing castle's rule
   (`.cs{position:relative;height:330px;…}`), so its floor grid stops covering the
   install section's "macOS and Linux" / "Windows" buttons.
4. In the stylesheet's headline rule (`.hl{font-size:clamp(42px,4.6vw,64px);…}`), change
   the largest size from `64px` to `58px`: `clamp(42px,4.6vw,58px)`.

The `<head>` changes (title, descriptions, social tags, structured data) need nothing on the
canvas: the port keeps the hand-written head.
