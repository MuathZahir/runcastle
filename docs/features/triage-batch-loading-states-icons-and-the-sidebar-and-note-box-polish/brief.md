# Triage batch — loading states, icons, and the sidebar and note-box polish

## Ticket 1

The loading spinner never rotates: on the feature page, "Loading feature…" shows one still frame of the spinner (apps/web/src/components/Workspace.tsx:520 → Loading in apps/web/src/ui.tsx → Spinner in apps/web/src/ui/button.tsx, class animate-spin). Expected: it spins. Suspected cause, to confirm first: the global `prefers-reduced-motion: reduce` rule in apps/web/src/theme.css (~line 343) forces `animation-iteration-count: 1` and a near-zero duration on every element, which freezes an infinite spinner on a machine with Windows animation effects turned off. Fix it so a progress indicator still says 'working' under reduced motion (for example, exempt the spinner from the clamp, or swap in a slow opacity pulse under reduced motion). Don't just delete the reduced-motion rule. A screenshot of the problem is at .runcastle-attachments/pnote_qB7ud8TVO2Jy.png in your workspace — Read it before starting.

## Ticket 2

Replace the feature page's "Loading feature…" spinner line (apps/web/src/components/Workspace.tsx:520) with a skeleton shaped like the feature page it's loading: title bar, branch line, the phase stepper row, and the summary rows (Review / Checks / Test drive / Tickets / Laps), built from the theme tokens in apps/web/src/theme.css and following apps/web/STYLE.md. Keep the existing 300ms delay before anything shows, so a fast load still shows nothing. The shared Loading component stays as it is for other callers. A screenshot of the problem is at .runcastle-attachments/pnote_qB7ud8TVO2Jy.png in your workspace — Read it before starting.

## Ticket 3

Opening a feature page takes noticeably long before the page shows, longer than a local app should for reading one feature. Diagnose it and fix it: measure what the feature page waits on before it renders (the tRPC query or queries behind Workspace.tsx's loading gate, and the server work behind them: DB reads, git calls, filesystem reads of docs, anything spawned), find the slow part, and fix it. Likely suspects to check: a git or filesystem call on the request path, one query serially waiting on another, or the gate waiting on a query the page doesn't need to show its first paint. Record the before and after timings in your digest. If the real fix is too big for one ticket, fix what you can and say in the digest exactly what is left and why.

## Ticket 4

The settings button in the footer looks almost identical to the light/dark-mode (sun) button beside it: both read as a sun. Change the settings icon to one that reads unmistakably as a gear/cog (a proper toothed cog from the app's icon set) and check that the pair are easy to tell apart at a glance in both themes. A screenshot of the problem is at .runcastle-attachments/pnote_37zzH_F2CzJ0.png in your workspace — Read it before starting.

## Ticket 5

In the sidebar feature list, hovering a feature row shows its three-dot (more actions) button right on top of the row's status dot (seen on 'Weekly digest email'), so the two overlap. Expected: they never collide. Either the status indicator and ticket count give way to the three-dot button on hover, or the button gets its own slot, so the row reads cleanly both hovered and not. Check rows with and without a ticket count (e.g. '0/10', '2/2'). A screenshot of the problem is at .runcastle-attachments/pnote_d6KA8skb3gn3.png in your workspace — Read it before starting.

## Ticket 6

The quick note composer (the jot-a-note popover with 'to runcastle', '↵ save', 'esc close') is a single line that cuts off long text: the start of the note scrolls out of view (the screenshot shows '…lso, some pages need more structure…'). Make the input grow downward as the note gets longer or when the user adds a new line, animating the height change smoothly, up to a sensible max height after which it scrolls. Enter still saves; decide on and keep a way to add a newline (e.g. Shift+Enter) consistent with that. A screenshot of the problem is at .runcastle-attachments/pnote_dUiEx8tPh1sb.png in your workspace — Read it before starting.
