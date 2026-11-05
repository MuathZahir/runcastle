# The software development engine

## Problem

A visitor on Windows cannot get runcastle's install command from the landing page. In the
closing "Start building." section, pressing "Windows" does nothing: the button stays dark and
the command (and what Copy copies) stays `curl -fsSL https://runcastle.dev/install.sh | bash`,
which does not run in PowerShell.

The hero still pitches runcastle as "The IDE for agents. You make the calls." with a
paragraph under it. The project now pitches runcastle as **the software development engine**:
it runs the whole process from idea to merged branch, where other tools hand you an agent and
leave the process to you. The rest of the page already explains the idea, so the hero should
be the hook alone.

## Approach

**The Windows button.** The logic was never broken: the page's component state switches to
Windows and the binder applies it when the button's click handler runs. The click never
reaches the button. The closing castle scene's floor grid (the `.plane` inside the castle's
isometric stage) extends 176px past its box on every side, and from 768px wide upward it lies
on top of both "macOS and Linux" and "Windows". The fix is one style rule: the castle scene
takes no pointer events. Nothing in the castle reacts to hover or click (checked: the
stylesheet has no hover rule under it), so the rule changes nothing else. At phone width the
buttons were already clickable.

Once a visitor picks Windows, the hero's install chip shows the PowerShell command too; they
already read one shared state (decision 3: no OS guessing, no remembering, no hero switch).

**The hero.** The headline becomes exactly "The software development engine." and the
subtitle paragraph under it is removed. The install chip, "Read the docs" link and scene stay
as they are, with no style change (decision 2): three lines on desktop, one on tablet width,
three at phone size.

**The page head** (hand-written, kept by the port):
- `<title>`, `og:title`, `twitter:title`: "runcastle - the software development engine".
- `description`, `og:description`, `twitter:description`: "Stop juggling prompts, branches
  and terminals. runcastle runs every step from idea to merged branch, and only stops for your
  decisions."
- The structured-data block's `description` takes the same sentence.
- `og:image:alt` describes the new card: the headline "The software development engine." beside
  the isometric scene of a request landing on the runcastle tower and features being built.

**The social card.** `site/assets/og.png` is recaptured from the new hero by the recipe in
`site/README.md` (1200x630 at 2x, a real-time browser, about 7 s in, features mid-build). The
image size stays 2400x1260, so its width and height tags do not change.

**Where the edits land** (decision 1). The canvas is out of reach from here, so the lead
edits the generated `site/index.html` and `site/landing.css` to read exactly as a port of the
edited canvas would, and `decisions.md` lists the three canvas edits the human must make. The
docs, compare pages, `styles.css` and `content.css` belong to sibling features and are not
touched.

**Who builds it** (decision 4). The lead, in this checkout, then one review round.

## Seams

- **The served landing page** (existing). Serve `site/` and load it in a real browser at
  1440, 1024, 768 and phone width. Observe: the element under the centre of each OS button
  is the button itself; pressing "Windows" gives it the `on` class and `aria-pressed="true"`,
  turns both command lines into `irm https://runcastle.dev/install.ps1 | iex` and the prompt
  into `>`; Copy puts that command on the clipboard; "macOS and Linux" switches back.
- **The page head** (existing). Read `site/index.html`: the title, descriptions, social tags
  and structured data carry the new copy, and none of the old pitch ("IDE for agents", "IDE
  built for agents", "You make the calls") remains anywhere in the file.
- **The social card** (existing). `site/assets/og.png` is 2400x1260 and shows the new headline.
- **The port round trip** (existing, the human's). After the three canvas edits,
  `node scripts/port-landing.mjs <Main.dc.html>` leaves the three generated files unchanged.

## Out of scope

- The docs (`site/docs/`) and compare (`site/compare/`) pages, `styles.css`, `content.css`:
  sibling features own them.
- Any other landing copy, the hero's layout and type size, an OS switch in the hero, OS
  detection, remembering the choice.
- Deploying runcastle.dev: the orchestrator deploys after the three website features merge.
- Editing the design canvas: the human does it from the list in `decisions.md`.

## Open questions

- Standalone Claude Design, where the canvas lives, closes on 2026-12-14. Where the landing
  page's source of truth goes after that is not this feature's to settle, but the canvas edits
  should be made before then.
