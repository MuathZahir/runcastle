# The chat looks the part

## Problem

The chat is where the human spends most of their time in runcastle, and it was
built just before the app's shared style settled. Next to the sidebar it now
looks unfinished. Every item in a thread sits the same 24px from the next, so a
long conversation reads as an even list rather than questions and answers. The
floating composer does not line up with the messages above it: it is off by the
scrollbar's width. The composer is three stacked pieces on three different
grounds: the task-list tab, the box, and a caption with a lone meter ring under
it. Your message bubble and the changed-files card each mix their own tint
instead of wearing the shared card. The notice cards that float over the chat
still carry marks the design guide has retired: an uppercase eyebrow, a glow and
a tinted pill. The header puts the thread in bold beside a dimmed feature title,
which reads backwards.

## Approach

The chat keeps the shape the human approved in "Chat as web components": a
floating composer, the agent's words as full-width prose, your words in a bubble
on the right, work folded to "Worked for …", and asks docking in the composer's
place. This feature restyles that shape and fixes its layout. It adds no
behaviour. Because every agent conversation renders through the one chat column
(feature chats, side threads, scenario and Fix-it chats, the Orchestrator's
chats, the preparation chat), all of them change at once.

What the human sees:

- **Turns, not a list.** The parts of one turn sit 12px apart: your message,
  the work line, the answer, the changed-files card and an answered ask. A turn
  starts after 32px. Your message, runcastle's own line and the dividers
  ("Now on …", "Conversation compacted", a notice line) each start one.
- **One column edge.** The thread, the composer and every ask dock share one
  760px column. The floating foot is padded by the thread's measured scrollbar
  width, so its edges match the messages above. The thread's scrollbar is the
  app's thin, quiet one. The thread fades as it passes under the header, the
  same way it fades under the composer.
- **Three materials, one per job.** Raised floats over the thread (the
  composer, a message being edited, an ask, a notice card). The well sits in
  the thread (your message, a turn's changed files, a subagent). Inset is
  code-shaped, inside the other two (a command, output, a diff, an attached
  image). Raised and well share a 1px top highlight. They are defined once in
  the chat's materials module (`thread/surfaces.ts`) and every container uses
  one of them.
- **Your message keeps today's bubble** (the human's pick), which is the well.
  The changed-files card wears the well too. Runcastle's own line keeps its small mark, now in
  the shared accent-subtle look instead of a hand-mixed tint.
- **Calls of one kind read as one line.** Two or more calls of one family in
  a row fold into one line that opens to each call: looking around ("Read 3
  files, searched for 1 pattern"), changing files ("Edited 5 files +40 −12"),
  running commands ("Ran 3 commands"). While one is in flight the line reads
  in the present and names it. A failed call adds "· 1 failed". MCP tools,
  skills and reviews keep their own lines.
- **A subagent is a card** (the well): its head names the task and its call count and
  opens to its calls; while it runs, the call in flight shows under the head.
- **One spinner at a time.** The thread's "Working" line is gone; while a turn
  runs the composer says "Working 1m 18s" beside Stop, with no spinner. The
  only spinner is the call in flight. The context meter is a short bar with
  its percentage, and steps aside for "Working" while a turn runs.
- **"/" works anywhere a word starts.** The list of commands and skills opens
  for "/" at the start of the message or after a space, as "@" does for
  files; picking one keeps the rest of the message.
- **The last message's buttons clear the composer.** The thread keeps room
  under its last message for the hover buttons, and the composer's fade is
  24px, so they are never under it.
- **An answer and its changes are one block.** When a turn ends with a
  changed-files card, the answer draws the card under its text, 12px down, and
  the answer's hover actions hang under the card. Before, they floated in the
  gap between the answer and the card (the human's "Weird spacing" note).
- **The composer is one box.** The task list and the background commands are
  its top section, under a hairline. The context meter is the first control on
  its footer's right, before attach, Stop and Send. The working caption ("Feature
  worktree · feature/x") stays under the box. While an ask docks, the ask
  replaces the whole box, as it does today.
- **The notice cards are calm.** The cards keep their place, their stacking and
  their words. The eyebrow is in sentence case and keeps its phase colour. The
  glyph sits in the neutral well. The glow is gone. The title is medium weight.
  The count is plain tertiary text. The action is the shared small secondary
  button.
- **The header leads with the feature.** Over a chat, the feature's title (or
  the project's name) reads in full-strength medium type. The thread in front
  follows it in quiet secondary type, then the status line. The header's
  content and buttons are unchanged.

The shape of it:

- The chat thread component (`ChatThread`) wraps each item in a spacer whose top
  margin depends on whether the item opens a turn (`opensTurn`). It measures the
  scroller's scrollbar width with the same ResizeObserver that measures the
  foot. It draws the top fade. A changes item that follows an answer is passed
  to that answer (`AgentMessage`) and drawn inside it, not on its own.
- The composer (`Composer`) renders its `top` slot inside its box, and takes a
  new `meter` slot at the start of its footer's right side, and a
  `workingSince` that shows the working clock there in the meter's place while
  a turn runs. The thread (`ChatThread`) no longer draws a working line or
  takes `workingSince`; its bottom padding is the foot's height plus 56px. The plan strip
  (`PlanStrip`) loses its tab chrome and becomes a section with a hairline
  under it.
- The work view (`Work.tsx`) folds calls with `groupCalls` (runs of one
  family: explore = read, search, fetch; change = edit, delete, move; run =
  execute) and words them with `groupText`; both are exported and pure, so
  they are unit-tested directly. `Subagent` becomes a card over the same
  grouped list.
- The chat column (`ThreadColumn`) passes the context meter to the composer's
  `meter` slot. Under the box it shows only the working caption.
- The notice deck (`NoticeDeck`) keeps its stacking behaviour. Only the card's
  look changes, and its hue map shrinks to the glyph colour and the eyebrow's
  word colour.
- The shared breadcrumb (`Crumbs`) and the page header row (`PageTopbar`) gain
  an optional `trail` flag. With it, the item before the last reads as the page
  and the last reads quietly. This is the one change to a shared building block.
  It is opt-in, so other pages are unchanged. The feature page (`Workspace`) and
  the project page (`ProjectWorkspace`) set `trail` when a thread crumb follows
  the title.
- The design preview `apps/web/preview/chat.html` is repaired. It still
  imported the thread switcher that "Threads in the sidebar" removed. It now
  draws the header as the app does, and gains a Notices toggle, a running
  subagent moment, and grouped calls in its sample turns.

No server, schema or API change.

## Seams

- **The chat preview** (existing, `apps/web/preview/chat.html`): every moment of
  a thread (working, approval, questions, idle, new thread, notices), in both
  themes. This is where the look is judged.
- **Call grouping** (new, pure): `groupCalls` and `groupText` over lists of
  calls: runs fold only within one family, a lone call stays alone, a file
  edited twice counts once, a call in flight turns its kind's verb present.
- **Static markup of the thread pieces** (existing tier-1 tests in
  `apps/web/test/`): the composer's markup shows the plan strip and the meter
  inside its box. The notice card's markup has no uppercase class, no glow layer
  and a shared button. `Crumbs` with `trail` marks the item before the last as
  the lead. Existing tests that pinned the old classes are updated, not deleted.
- **The chat column in a real DOM** (existing tier-2 test,
  `test/chat-column.test.tsx`): it still sends, steers, answers and branches
  through the restyled pieces.

## Out of scope

- Chat behaviour of any kind: sending, steering, asks, edit and rewind, branch,
  the model controls. This feature changes look and layout only.
- The Markdown renderer's own look (headings, code blocks, tables). It is
  shared with every doc view (decision 8).
- Where threads live and how they switch: the sidebar ("Threads in the
  sidebar").
- The feature's right panel, the test drive, and the Orchestrator page's
  resting content (the chat list, Test drive card). Each is its own feature.
- The shared theme tokens and every other shared building block. Only the
  opt-in `trail` flag on the breadcrumb is added here.

## Open questions

- Which parts of the chat still look off to the human after this round of
  designs.
