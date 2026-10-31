# Agents show files in chat

## Problem

No agent can put anything but words in the chat. The human wants to accept a
feature from the orchestrator's thread, on their phone, by looking at it, and
today the only way to see a screenshot or a report an agent made is to go and
find the file on the machine. Only the images the human attached appear in a
chat.

## Approach

An agent calls one tool, `show_file({ path, caption? })`. An image appears in the
chat at once; any other file appears as a card the human clicks. It works the same
on Claude and Codex because the tool lives on runcastle's own MCP server. A file
stays in view after the turn's work folds, and it survives merge, because what the
chat shows is a copy kept with the thread.

**The tool.** Registered in the MCP server for the thread kinds (`chat`, `side`,
`scenario`, `drive-fix`, `project`, `prepare`) and not for `run`, and added to the
allow rules so it never prompts. It needs the calling session's id, which is also
its thread id, and it refuses a call that resolves to no session. Its description
tells agents to use `caption` for what the file shows, to put what they need from
the human in the words after it, and to make Markdown and HTML self-contained.

It resolves the path (relative to the session's worktree), follows links with a
real-path check, and accepts only: the project's repo, its worktrees, runcastle's
review evidence, a thread's own `shown` folder within this project, and the system
temp folder. It refuses a missing file, a folder, and anything over 100 MB, each
with a sentence the agent can act on. It returns the name and what the file was
sorted as; nothing else goes back to the agent.

**The store.** A new module beside `threads/images.ts`. A file is copied to
`<sessionDir>/shown/<minted id>.<ext>`, the extension kept only when it is short
and alphanumeric, else `bin`. Then one event goes in the thread's log. Sorting
happens here, once:

- `image`: png, jpg, gif, webp, svg, by extension.
- `markdown`: md, markdown.
- `html`: html, htm.
- `browser`: pdf and common video and audio extensions.
- `text`: anything else with no NUL byte in its first 8 KB.
- `download`: the rest.

**The event and the fold.** One new event body in core:

```ts
z.object({ type: z.literal('file_shown'), file: ShownFile })
// ShownFile: { id, src, name, path, size, as, caption? }
// as: 'image' | 'markdown' | 'html' | 'text' | 'browser' | 'download'
```

`path` is relative to the session's worktree when it sits inside it. `appendThreadEvent`
already publishes the live `thread` signal, so the human sees it at once, in any
open client. `foldThread` gains one item, `{ kind: 'shown', id, files }`, which
moves from the design's local type into core. The rules, in the fold's own style:

- A `file_shown` inside a turn acts as an `answered` does: it marks a boundary in
  the segments, so the words before it are no longer the answer; the work renders;
  the turn's one `shown` item takes the file. Later files join that item. Later
  work stays in the work item above it, and the final words follow it.
- A steered message splits the turn, so a new `shown` item starts after it.
- If a `file_shown` is logged before its tool call's first event, the work item
  created afterwards must still land ahead of the `shown` item.
- With no turn open, it folds as its own item.
- Rewinding removes it with the rest of the superseded events. A branch copies the
  event, whose `src` keeps naming the first thread's copy.

`threadMarkdown` writes a link: an image link for an image, a plain link otherwise,
with the caption beside it.

**The route.** `GET /api/threads/:threadId/files/:file` in the existing thread media
routes, validating both names as the image route does. It computes the path from
the two validated names and nothing else. Headers:

- `x-content-type-options: nosniff` on every reply.
- Inline: images, PDF, video and audio, under their own types.
- Everything else, Markdown, HTML and text included, is
  `application/octet-stream` with `content-disposition: attachment`, so it never
  replies `text/html`. The viewer reads those bytes with `fetch`, which ignores
  both headers.
- SVG also carries `content-security-policy: sandbox`, so it runs nothing if opened
  directly. PDF must not carry it: a sandboxed document breaks Chrome's PDF viewer.
- `?download=<name>` saves any file under its own name.
- Byte ranges, for video and for the viewer's first 1 MB of a long text file. The
  range and streaming helpers in the review media routes move somewhere both share.

**The chat.** `ShownFiles` (the group, its pictures and cards) and `FileViewer` (the
full-window dialog) are designed and sit in the thread's components. `ChatThread`
renders a `shown` item. Wiring them means moving the `ShownFile` and `ShownItem`
types to core and dropping the local union from `ChatThread`, nothing more. The
preview page (`/preview/shown-files.html?state=…`) stays as the reference.

**Reaching the orchestrator.** `read_feature_chat` returns a `shown` list of the
files the feature's main chat showed, newest last, each with its caption and the
absolute path of its copy, read from the thread's log. The feature skill tells the
lead to show the screenshots it took. The project skill tells the orchestrator to
re-show those copies when it asks the human to accept a feature, to ask the lead
for some when a feature with a screen showed none, and to say so when there is
nothing to look at. Neither adds a stop to any way of working.

## Seams

- **`foldThread` (existing).** Feed event logs, read `ThreadView.items`. Observes
  placement, grouping, live order, steering, rewind and branch. The main seam.
- **The `show_file` tool (new), through the MCP server's tool function.** Call it
  with a session row and paths. Observes the copy on disk, the log event, how the
  file was sorted, and each refusal: outside the allowed places, a link pointing
  out, a folder, a missing file, too big.
- **`GET /api/threads/:threadId/files/:file` (new).** Observes bytes, the headers
  above, and a 404 for a name the store would not write, including traversal
  attempts. Never `text/html`.
- **`toolsForAudience` (existing).** Observes that every thread kind gets `show_file`
  and `run` does not.
- **`read_feature_chat` (existing).** Observes the `shown` list.
- **`ShownFiles` and `FileViewer` (new, designed).** Tier 1 static markup for the
  group and "Show N more"; tier 2 for opening and closing the viewer.

## Out of scope

- Review taking or saving screenshots ("Review keeps its screenshots").
- The phone layout, and the phone's back button closing a dialog ("Runcastle on
  your phone"). The phone link's access control must cover `/api/threads/*`, as it
  must every other route.
- Telling the human a file arrived ("Agents can notify your phone").
- Editing files, or a file browser.
- An accept button, deleting a shown file, and copying a file's neighbours along
  with it.
- A PDF reader inside the app, and syntax highlighting in the text viewer.

## Open questions

None block the work. The plan preview's Check first group lists the decisions the
human may want to change.
