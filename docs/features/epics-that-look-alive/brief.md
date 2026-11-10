## Purpose

"Orchestrator chats become epics" (shipped 2026-11-10) turned the sidebar into a list of epic cards. Using it, the human found four things they don't like (orchestrator chat "Epic Rail Polish", 2026-11-10, with a screenshot of the sidebar):

1. **Creating an epic is annoying.** It takes the pencil (Create menu), then "New epic". And the empty chat shows up at once as a full card ("New chat · Nothing in motion").
2. **Every epic looks the same**: the same blue wash, grid and hub icon tile. It feels repetitive.
3. **The list fills with "Nothing in motion".** In the screenshot all six listed epics read that way. They are today's question chats with no features, and they stay listed for a day after they were written in (epics decision 16). The human: "I feel like we will end up with a lot of epics with 'Nothing in motion'... it doesn't look very good."
4. **The project name at the top of the sidebar ("runcastle") looks too plain**, and the runcastle logo appears nowhere on the dashboard.

The orchestrator's read: 2 and 3 share one cause. Every epic gets the same lit card whether or not anything is happening, so a list of mostly idle epics looks like a list of busy ones.

## Decided with the human

- **A dotted "New epic" placeholder at the top of the epic list.** One click opens a new, empty epic chat. The epic only becomes a real card in the list once the first message is sent. Until then, no "New chat · Nothing in motion" card. (The human's idea; the orchestrator agreed.)
- **Each epic gets its own colour.** Colours come from a fixed set of **relatively dark, muted tones at the same depth as today's blue accent**. The human: "having color variations might be good too here. But only relatively darker colors (on the same level as our blue palette)." The orchestrator had first advised against colour per epic, because the human had rejected "many colors" on the project rail ("A better way to move between projects", decision 2). The human's version, dark and muted, is what is wanted. The epic's card wash, grid and icon take its colour. Both themes must work.
- **Today's epic icons are "so bad. Very low quality."** (the human). Every icon in apps/web is a hand-drawn SVG in `apps/web/src/icons.tsx`, with no icon library. Epic icons move to a proper, good-quality icon set. Each epic gets its own icon, which the orchestrator picks when it names the epic: the naming tool `name_epic` gains an icon, chosen from a fixed list, alongside the name. An epic with no icon yet gets a sensible default.
- **Epics with features in motion keep the full card. An idle epic (nothing moving) is tried as a slim one-line row** with no card head, whose second line says something true instead of "Nothing in motion": when it was last active ("2h ago"), or what it shipped ("3 shipped"). The human wants to see it before committing: "We can see how the slim row looks. Let's try things." The alternative the orchestrator raised, idle epics leaving the list sooner (only while their chat is open or working), was not chosen. It can stay as a Tweak if it helps the comparison.
- **The runcastle logo goes at the top of the project rail** (the thin strip of project tiles at the far left), where the "All projects" grid icon sits now, and **the project name gets more weight**. The logo is not put next to the project name, because on any other project it would read as part of that project's name. The mark exists as `apps/web/public/favicon.svg` (and `site/assets/favicon.svg`). Where "All projects" moves, if the logo takes its place, is for the design.

## How it should be planned

Design-led, planned with the human in this chat. Show mockups as switchable options (Tweaks) on the design page so the human can flip between them, especially the slim idle row next to the full card, the colour set in both themes, and the logo placement. Per `apps/web/STYLE.md`, `apps/web/src/theme.css` is the one token source; the colour set belongs there.

## Must not swallow

- How epics are ordered, grouped or listed (yellow floats to the top, Other features, how long an epic stays listed: epics decisions 7, 8, 16), apart from how an idle epic looks.
- The Backlog, Shipped and Archived shelves.
- Replacing the rest of the app's icons. Only epic icons (and whatever the new placeholder and the logo slot need) move to the new icon set. An app-wide icon swap is its own feature if the human wants it.
- The project rail's behaviour (order, shortcuts, the needs-you dot): only its top slot changes.

## Open, for this feature's grill

- Which icon set (license, size, how it fits the hand-drawn icons that stay), and how many icons the orchestrator picks from.
- How many colours are in the set, how an epic gets one (picked with the name, or assigned in turn), and whether the human can change an epic's colour or icon.
- Exactly what the slim row's second line says, and whether it keeps a small coloured icon.
- How the dotted placeholder behaves on the phone, and whether "New epic" stays in the Create menu too.
- What becomes of the chats listed today: they get a colour and icon by default, or one naming pass.

## Ordering

Cut from `main`, nothing waits on it, and it waits on nothing. Built by its own workers; the orchestrator carries it from the human's plan yes through build and review, then shows it to the human before merging.

Planning mode: grill with you
