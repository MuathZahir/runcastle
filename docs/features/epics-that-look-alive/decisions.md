# Decisions — Epics that look alive

Settled with the human in this feature's chat, one at a time. The brief's own
"Decided with the human" list stands; these settle what it left open.

## 1. Epic icons come from Lucide, about 24 of them
**Decision:** Epic icons use `lucide-react`, drawn with a stroke width that matches the app's hand-drawn 16px icons. A fixed list of about 24 icons covering kinds of work (rocket, layers, palette, database, shield, plug, compass, sparkles, bug, …) is what the orchestrator picks from when it names an epic. The rest of the app's icons stay hand-drawn.
**Why:** Lucide is an outline set with round caps and joins, the same family as `icons.tsx`, so the two sit side by side without clashing; it is ISC-licensed and tree-shaken. Phosphor's filled and duotone styles would read as a second family; Tabler is near-identical but heavier. About 24 gives variety without making the orchestrator's pick arbitrary.

## 2. Eight colours, assigned automatically as the least used
**Decision:** The colour set has 8 dark, muted tones at the depth of today's blue accent: blue (today's), teal, green, olive, amber, rust, rose, violet — each with a light-theme counterpart, defined in `apps/web/src/theme.css`. When an epic is created the app gives it the colour least used among the epics listed at that moment, and stores it on the epic; it never changes by itself. The orchestrator picks only the icon.
**Why:** Fewer than 8 repeats on a normal list; more and tones at this depth start to look alike. Least-used keeps neighbours apart. Colour carries no meaning the orchestrator could pick by; the icon does.

## 3. The human can change an epic's colour and icon
**Decision:** The epic card's menu gains "Colour and icon…", opening a small picker with the 8 colours and the icon list. Once the human picks an icon, the orchestrator never changes it again — the same rule as a human rename.
**Why:** An auto-assigned colour or an orchestrator icon the human dislikes would otherwise stay for the epic's whole life. It mirrors the rename the menu already has, and costs one popover.

## 4. The slim idle row: coloured icon, name, "N shipped · 2h"
**Decision:** An idle epic (nothing in motion) is one line: its small coloured icon and its name on the left; on the right, muted, what it shipped and when it was last active ("3 shipped · 2h"), the shipped part only when above zero. The server gains a count of each epic's shipped features. Starting point, not final: the design page shows several slim-row variations as Tweaks beside the full card, and the human picks there.
**Why:** The icon keeps the epic's identity at a glance; both facts are true where "Nothing in motion" was empty. About a third of a card's height. The human wants to compare variations before committing.

## 5. The dotted "New epic" slot is the one way in, on desktop and phone
**Decision:** The dotted "New epic" slot sits at the top of the epic list on desktop and on phone, where it replaces the phone list header's "New epic" button. "New epic" leaves the Create (pencil) menu. Clicking the slot opens an empty epic chat that is not saved until its first message is sent; only then does it become a card in the list.
**Why:** One obvious way to start an epic. Saving on first message means abandoned empty chats never pile up (today `thread.new` writes a session row on click).

## 6. Existing epics get a colour in turn and the default icon
**Decision:** The migration gives every existing epic a colour, spread across the 8 in creation order, and leaves its icon unset so it shows the default icon (a neutral chat bubble — also what any epic shows until the orchestrator picks one). No orchestrator pass picks icons for old epics; the human can give any of them an icon with the picker.
**Why:** A naming pass would wake every old chat for a model call, and most listed epics today are idle question chats that leave the list within a day.

## 7. The project rail and sidebar header get a polish, look only
**Decision:** Scope widens to the look of the project rail and the sidebar header, so they match the polish of the epic cards. Rail: projects become real tiles (fill and edge, not bare initials), the open project gets a clear marker, the needs-you dot sits on the tile's corner, and "+" becomes a dotted tile matching the "New epic" slot. Tiles stay neutral — no colour per project. Header: the project name gets more weight, possibly a quiet status line under it, and its three icon buttons become one tidy group. The rail's behaviour (order, shortcuts, when the needs-you dot shows) does not change. Whether the logo also acts as the "All projects" button (recommended) or the grid button moves elsewhere is chosen by the human on the design page, from variations shown as Tweaks.
**Why:** The human: the rail and header "look very basic" next to the rest of the sidebar. Same strip of screen and same design page as the logo work. Neutral tiles keep the human's earlier "no many colours on the rail" (A better way to move between projects, decision 2).

## 8. Epics in motion sit above idle ones
**Decision:** The epic list orders in three bands: epics with something yellow (needing the human) first, then epics in motion, then idle epics (the slim rows) — each band newest started first. "Other features" (features cut outside any epic) still joins the yellow band when something in it is yellow; otherwise it ends the in-motion band, so it never sits among idle epics.
**Why:** The human, on the design page: "the epics that are working should be at the top. The idle ones should be down." With slim rows mixed among full cards the list read as jumbled. This changes the order the brief kept out of scope ("Orchestrator chats become epics" decision 8, which ordered only yellow-then-rest); the human asked for it.

## 9. The look chosen on the design page
**Decision:** From the design page's Tweaks the human chose: the **tinted** slim idle row (a lightly tinted strip in the epic's colour, coloured icon, name, "N shipped · 2h"; below ~300px of sidebar only the time); the runcastle logo as a **mark at the top of the rail with the "All projects" grid button directly below it** (the logo is not itself a button); and a **large project name** in the sidebar header beside one tidy group of icon buttons. The app's sidebar width does not change.
**Why:** The human's picks among the variations shown side by side (supersedes the "one line, no tint" starting point in 4 and the "logo is All projects" recommendation in 7).
