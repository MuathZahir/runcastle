# Decisions — Agents show files in chat

Made by the feature's lead with no human present (a self-planning run). Each
decision carries the main alternative it was chosen over. The human confirms or
changes them on the plan preview.

## 1. The tool is `show_file`, for every agent that has a chat
**Decision:** One tool, `show_file`, on runcastle's own MCP server, offered to every session kind that owns a thread: the feature chat, side threads, scenario and Fix-it chats, the orchestrator and the preparation chat. Sandboxed ticket and review workers do not get it.
**Why:** A worker has no chat to show anything in, and its files live inside a container the server cannot read. Its screenshots belong to "Review keeps its screenshots". This narrows the brief's agreed "every agent" to every agent the human talks to.
**Assumed.** Alternative: offer it to workers too, and have the file appear in the feature's main chat.

## 2. A file is copied into its thread when shown, and lives as long as the thread
**Decision:** `show_file` copies the file into the thread's own session folder, under a name the server mints, the moment it is called. The thread's log names the copy. The copy is never updated: it shows the file as it was when shown.
**Why:** The human already accepted copying, so a card keeps working after merge deletes the worktree. The thread's folder is where its sent images already live, and nothing removes those folders at merge.
**Assumed.** Alternative: a shared folder across threads, de-duplicated by content.

## 3. The server serves copies only, never a path
**Decision:** A new read-only route serves a thread's copied files by their minted name. No URL ever carries a path on disk, and a name the server would not have written is a 404. It follows the same rule as the sent-image route beside it.
**Why:** The app has no login, so a route that takes a path would hand out the disk. With minted names the route can only ever reach what an agent deliberately showed. The route sits under `/api` with the rest of the app, so the phone link's access control covers it the same way; it adds no protection of its own.
**Assumed.** Alternative: serve the original file in place, and give up surviving a merge.

## 4. The tool shows files from the project and from temp, and refuses the rest
**Decision:** `show_file` accepts a path inside this project's repo, any of its worktrees, runcastle's review evidence, a copy already shown in one of this project's threads, or the system temp folder (where agents save screenshots). A relative path starts at the session's own folder. Links are resolved first, so a link cannot point out of those places. Anything else is refused with a reason the agent can act on, and nothing appears in the chat.
**Why:** The orchestrator must reach a feature's worktree and temp screenshots, or its main job fails. Keeping out the rest of the disk stops an agent tricked by a web page from putting `~/.ssh` into a chat that will soon be reachable from a phone. It is a few lines of checking, not a permission system.
**Assumed.** Alternative: accept any path the agent can read, since it could paste that text into the chat anyway.
**Challenged:** Drop the allowed list and refuse a short list of secret files (`.env*`, `.ssh`, key files) instead. The list is weak protection, because a tricked agent can copy a file into temp or paste it as text. It misses the likeliest leak, a `.env` inside the repo. It also refuses real requests such as a PDF in Downloads.

## 5. One file is capped at 100 MB, and big files stay out of the way
**Decision:** A file over 100 MB is refused with a reason. There is no per-thread or total limit. An image over 10 MB shows as a card rather than inline, and the viewer reads only the first 1 MB of a text file, says so, and offers Download for the rest.
**Why:** The cap stops an agent copying a database dump or a build folder by mistake, and it fits a long walkthrough video. One person's disk needs no quota machinery. The lower limits keep a chat opening quickly on phone data.
**Assumed.** Alternative: a single 25 MB cap, which is simpler but refuses recordings.

## 6. What a file does is decided by what it is
**Decision:** The server sorts a file when it is shown, and the chat follows that:
- PNG, JPEG, GIF, WebP and SVG show inline. Clicking opens them large.
- Markdown opens rendered, in a viewer inside the app.
- HTML opens in the viewer inside a sandboxed frame (decision 7).
- Anything else that is text, whatever its extension, opens in the viewer as plain monospaced text.
- PDF, video and audio open in a new browser tab, where the browser shows them.
- Everything else downloads.

The viewer always offers Download.
**Why:** All of this works from a phone browser with no new dependency and no desktop program. Checking for binary bytes instead of keeping an extension list means a `.tf` or `.prisma` file works without anyone teaching runcastle about it. A PDF reader inside the app would be a large dependency for what the browser already does. Android's browser may download the PDF rather than show it, which is acceptable.
**Assumed.** Alternative: every non-image file simply opens in a new tab, with no viewer. That is less to build, but Markdown would read as raw text on a phone and HTML could not be opened safely.

## 7. HTML runs in the plan preview's sandbox, and the server never serves it as a page
**Decision:** HTML opens in the same locked frame the plan preview uses: scripts run, but it has no access to the app and cannot make any network request. The route itself never answers with `text/html`, and SVG opened directly has its scripts switched off. So an agent-written file cannot act against an app with no login.
**Why:** The unauthenticated server can start burns and merges, and a page served from its own address could call all of that. The frame already exists and is tested. External images in an HTML report will not load, which is the price.
**Assumed.** Alternative: treat HTML as a download. That is safer still, but agents' HTML reports would be useless on a phone.

## 8. A shown file stays in view, after the turn's work and before its final words
**Decision:** A shown file appears the moment it is shown, even in the middle of a long turn, and never folds into "Worked for 3m 43s". It sits after the turn's work and ahead of the agent's final words. The work above it keeps growing while the turn runs.
**Why:** Accepting work means seeing the screenshots without opening anything. The same placement is already used for an answered question inside a turn, so it reads as part of the turn and its order never jumps.
**Assumed.** Alternative: show it at the exact point in the turn where it was called, with the work block split around it. That is more faithful but breaks the one fold each turn has.

## 9. A file can carry a short caption
**Decision:** `show_file` takes an optional one-line `caption`, shown with the file. The tool's description tells agents to use it to say what the file shows, and to put what they need from the human in their words after it.
**Why:** The agent's words before a tool call fold away into "Worked for…", so "here is the empty state" would vanish and leave a bare picture. A caption stays with the file, including in the orchestrator's thread on a phone.
**Assumed.** Alternative: no caption, and rely on the agent's final words alone.

## 10. One file per call, and a turn's files read as one group
**Decision:** `show_file` takes one file. Everything a turn shows sits together as one group, so calls with work between them still end up side by side. A group shows its first four files; the rest wait behind "Show N more", opened in place.
**Why:** One file per call gives each its own result, so one refused file does not hide the others, and the tool stays simple for both runtimes. The fold after four keeps twenty screenshots from pushing the agent's question off a phone screen.
**Assumed.** Alternative: a list of paths in one call.

## 11. Shown files are part of the thread's log, so a reopened chat shows them
**Decision:** A shown file is one more event in the thread's log, so reopening or resuming a chat shows it exactly as it first appeared, and old chats keep it. A branched thread keeps it. Copying a thread as Markdown gives a link. Nothing is sent back to the agent on resume: the tool's result in its own conversation is its only record.
**Why:** The log is already the thread's whole record, read with no agent running, and server and web fold it the same way. Sent images behave identically.
**Assumed.** Alternative: a database table of shown files.

## 12. The viewer is a full-window dialog, not the side panel
**Decision:** A viewed file opens in the app's full-window dialog: the file's name and path, Download, Close, and the content scrolling. It looks like a doc's Open full window, and an image opens the same way as a note's picture.
**Why:** The dialog works from every chat. The panel differs between a feature and the Orchestrator, a scenario chat has none, and a phone has no side-by-side. This is a deliberate exception to the design rule "docs are read in place, never in a dialog": that rule is about a feature's docs, and a shown file belongs to the chat, not to a panel view.
**Assumed.** Alternative: open it in the feature's panel beside the chat, as a doc is read.
**Challenged:** Keep the dialog, but give each viewed file its own URL, so a phone's back button closes it rather than leaving the chat and a notification can link to it. The back button belongs to the phone view, which will meet it on every dialog, so it stays out of this feature.

## 13. No accept button
**Decision:** There is no accept button. The human replies "merge it" in the orchestrator's chat and the existing check-in takes it from there. Rejecting works the same way: "the second one is wrong" in words, which the group's order and captions make easy to say, and the orchestrator passes that on to the feature with the file's path.
**Why:** The brief asked for one only if a real reason turned up. None did: the reply box is already there on every screen, and a button would need its own idea of which feature it accepts.
**Assumed.** Alternative: an Accept and Reject pair under a group of shown screenshots.

## 14. The orchestrator is told to show evidence, and can re-show what a feature showed
**Decision:** The feature lead's skill says to show the screenshots it took in its own chat. `read_feature_chat` (how the orchestrator reads a feature's chat) lists the files that chat showed, with their captions and the path of each copy. The orchestrator's skill says to re-show them with `show_file` when it asks the human to accept a feature. If a feature with a screen showed nothing, it asks the lead to take some. A feature with nothing to look at gets no files, and the orchestrator says so.
**Why:** A tool nobody is told to use does not deliver "accept from your phone by looking". Using the copies rather than the originals means this still works after merge deletes the worktree and after temp is cleaned, including "show me that feature" a week later. It needs no new tool.
**Assumed.** Alternative: the lead names its screenshot paths in its ready message, and those paths die with the worktree.

## 15. One file means one file
**Decision:** `show_file` copies a single file. A folder is refused. A Markdown or HTML file that points at other files beside it shows those as broken, and the tool's description tells agents to make such a file self-contained or show the pieces separately.
**Why:** Working out a file's dependencies and copying them along is a large job for a rare case, and it would quietly widen what leaves a worktree.
**Assumed.** Alternative: rewrite Markdown's relative image links and copy those images too.

## 16. Showing a file waits for nobody
**Decision:** A shown file does not pause the agent, ask anything, or notify anyone, and it adds no stop to any way of working. When the orchestrator is carrying a cut through to merged, it shows the evidence in its report and keeps going. When it stops to ask the human to accept, the same files sit above the question.
**Why:** The tool shows things; deciding when the human must look stays with the working agreement. Telling the human a file arrived is "Agents can notify your phone".
**Assumed.** Alternative: a shown file marks the feature as waiting for the human.

## 17. A shown file cannot be taken back
**Decision:** There is no delete. Rewinding past a file removes it from the chat, but the copy stays in the thread's folder.
**Why:** A branched thread may still use that copy, and an agent showing a secret in the human's own chat is rare and the same harm as pasting it. A delete control earns its place only once real use asks for it.
**Assumed.** Alternative: a delete action on each shown file, which removes the copy and leaves a "removed" line.
