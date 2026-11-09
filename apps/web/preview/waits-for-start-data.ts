import type { ContextUsage, ThreadItem, ToolCall } from '../src/lib/chat-thread'

/**
 * One never-run feature, "Export notes as PDF", for the design page of
 * docs/features/a-new-feature-waits-for-start: its chat before Start, and the
 * agent's first turn once Start is pressed.
 */

export const TITLE = 'Export notes as PDF'
export const BRANCH = 'feature/export-notes-as-pdf'

/** A refused start, as the launcher words it (decision 8). */
export const REFUSAL = 'Claude Code is not signed in. Run claude login in a terminal, then press Start again.'

/** A fresh session: nothing used yet. */
export const FRESH: ContextUsage = { used: 0, size: 1_000_000 }
/** After the first turn. */
export const AFTER_FIRST: ContextUsage = { used: 38_200, size: 1_000_000, costUsd: 0.62 }

const CALLS: Omit<ToolCall, 'status'>[] = [
  { id: 'c1', kind: 'read', title: 'docs/features/export-notes-as-pdf/brief.md' },
  { id: 'c2', kind: 'search', title: 'export|print in src/' },
  { id: 'c3', kind: 'read', title: 'src/app/NoteToolbar.tsx' },
  { id: 'c4', kind: 'read', title: 'src/server/routes.ts' },
  { id: 'c5', kind: 'read', title: 'src/notes/markdown.ts' },
]

/** The first turn's work, `done` of its calls finished and the next one in flight. */
export function firstWork(done: number, live: boolean, seconds = 0): ThreadItem {
  const shown = live ? CALLS.slice(0, done + 1) : CALLS
  return {
    kind: 'work',
    id: 'w1',
    seconds,
    ...(live ? { live: true } : {}),
    steps: [
      {
        kind: 'tools',
        id: 't1',
        calls: shown.map((c, i) => ({ ...c, status: !live || i < done ? 'completed' : 'in_progress' })),
      },
    ],
  }
}

/** What the agent says first, having read the brief and the code. */
export const FIRST_WORDS: ThreadItem = {
  kind: 'agent',
  id: 'a1',
  model: 'Opus 5.5',
  text: [
    'I read the brief and looked through the notes code. Notes are Markdown, rendered by `src/notes/markdown.ts`; the toolbar in `NoteToolbar.tsx` already has Copy and Share, so Export would sit beside them.',
    '',
    'Two things to settle before I plan:',
    '',
    '1. **One note or several?** The brief says "a note", but the list view has a multi-select that could export a batch.',
    '2. **Rendered on the server or in the browser?** The server already has a route per note, so a server-side PDF is one endpoint; the browser’s print dialog needs no new dependency but looks less polished.',
  ].join('\n'),
}
