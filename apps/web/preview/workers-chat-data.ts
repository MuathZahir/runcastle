import type { FileChange, ShownFile, ThreadItem, ToolCall } from '../src/lib/chat-thread'
import type { WorkerAssignment, WorkerEntry } from '../src/lib/workers'

/**
 * Sample data for /preview/workers-chat.html (interactive-workers decisions 5,
 * 7, 15, 16, 21, 23): one worker's chat at each moment it has to show. The
 * feature is "Sidebar refresh"; its lead handed the header to a worker "with
 * you". Every worker, file and picture is made up.
 */

export const FEATURE = 'Sidebar refresh'
export const BRANCH = 'feature/sidebar-refresh'

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** A made-up screenshot of the sidebar's head, as the worker's dev server draws it. */
function headShot(variant: 'first' | 'second'): string {
  const searchFill = variant === 'first' ? '#2a3140' : '#161b25'
  const chevron = variant === 'first' ? 'M228 34 l8 8 l8 -8' : 'M230 36 l5 5 l5 -5'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="560" viewBox="0 0 1200 560">
<rect width="1200" height="560" fill="#0b0e14"/>
<rect x="0" y="0" width="420" height="560" fill="#05070b"/>
<rect x="24" y="22" width="28" height="28" rx="7" fill="#5b8def"/>
<rect x="64" y="30" width="140" height="12" rx="3" fill="#c9cfdb"/>
<path d="${chevron}" stroke="#7b8394" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<rect x="300" y="20" width="32" height="32" rx="7" fill="${searchFill}"/>
<circle cx="314" cy="34" r="6" stroke="#9aa3b4" stroke-width="2" fill="none"/>
<rect x="340" y="20" width="32" height="32" rx="7" fill="#161b25"/>
<path d="M356 28 v12 M350 34 h12" stroke="#9aa3b4" stroke-width="2"/>
<rect x="24" y="84" width="372" height="64" rx="12" fill="#0f1a2e" stroke="#244177"/>
<rect x="40" y="100" width="32" height="32" rx="8" fill="#183057"/>
<rect x="84" y="104" width="110" height="12" rx="3" fill="#e6e9ef"/>
<rect x="84" y="124" width="160" height="9" rx="3" fill="#4d6a9c"/>
<rect x="24" y="176" width="372" height="56" rx="10" fill="#0d1018"/>
<rect x="40" y="190" width="200" height="11" rx="3" fill="#c9cfdb"/>
<rect x="40" y="210" width="130" height="8" rx="3" fill="#4a5262"/>
<rect x="24" y="244" width="372" height="56" rx="10" fill="#0d1018"/>
<rect x="40" y="258" width="170" height="11" rx="3" fill="#c9cfdb"/>
<rect x="40" y="278" width="110" height="8" rx="3" fill="#4a5262"/>
<rect x="460" y="20" width="716" height="520" rx="12" fill="#0e131e" stroke="#1d2433"/>
<rect x="490" y="56" width="260" height="16" rx="4" fill="#2a3140"/>
<rect x="490" y="92" width="520" height="10" rx="3" fill="#1d2433"/>
<rect x="490" y="114" width="460" height="10" rx="3" fill="#1d2433"/>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function shot(id: string, variant: 'first' | 'second', caption: string): ShownFile {
  return { id, src: headShot(variant), name: `sidebar-head-${variant}.png`, path: `.runcastle/shots/sidebar-head-${variant}.png`, size: 184_000, as: 'image', caption }
}

const call = (over: Partial<ToolCall> & Pick<ToolCall, 'id' | 'kind' | 'title'>): ToolCall => ({ status: 'completed', ...over })

const HEAD_CHANGES: FileChange[] = [
  {
    path: 'apps/web/src/components/Sidebar.tsx',
    added: 18,
    removed: 9,
    lines: [
      { op: ' ', text: '<div className="flex h-10 shrink-0 items-center gap-0.5">' },
      { op: '-', text: '  <IconButton label="Search" size="md" icon={<IconSearch />} />' },
      { op: '+', text: '  <IconButton label="Search or jump to" size="sm" icon={<IconSearch />} />' },
    ],
  },
  { path: 'apps/web/src/components/ProjectSwitcher.tsx', added: 11, removed: 6, lines: [] },
]

/** The first pass: read, build, start the dev server, show the human. */
const FIRST_PASS: ThreadItem[] = [
  {
    kind: 'work',
    id: 'w1',
    seconds: 214,
    steps: [
      { kind: 'thought', id: 'th1', seconds: 5, text: 'Read the decisions on the head first, then the current Sidebar head and the switcher.' },
      {
        kind: 'tools',
        id: 't1',
        calls: [
          call({ id: 'c1', kind: 'read', title: 'docs/features/sidebar-refresh/decisions.md' }),
          call({ id: 'c2', kind: 'read', title: 'apps/web/src/components/Sidebar.tsx' }),
          call({ id: 'c3', kind: 'read', title: 'apps/web/src/components/ProjectSwitcher.tsx' }),
        ],
      },
      {
        kind: 'tools',
        id: 't2',
        calls: [
          call({ id: 'c4', kind: 'edit', title: 'apps/web/src/components/Sidebar.tsx' }),
          call({ id: 'c5', kind: 'edit', title: 'apps/web/src/components/ProjectSwitcher.tsx' }),
          call({ id: 'c6', kind: 'execute', title: 'bun run --cwd apps/web dev --host 0.0.0.0 --port 5173' }),
        ],
      },
    ],
  },
  { kind: 'shown', id: 'sh1', files: [shot('s1', 'first', 'The head after the first pass, dark theme')] },
  {
    kind: 'agent',
    id: 'a1',
    model: 'Opus 5.5',
    text:
      'A first pass on the head is up — **Open preview** in the header shows it live.\n\n' +
      '- The switcher, search and new-chat button now share one 24px row, with the project mark in its accent tile.\n' +
      '- Search keeps its ⌘K hint in the tooltip only, so the row stays quiet.\n\n' +
      'What would you change?',
  },
  { kind: 'changes', id: 'ch1', files: HEAD_CHANGES },
]

const SECOND_PASS: ThreadItem[] = [
  { kind: 'user', id: 'u1', text: 'Closer. The search button is too loud next to the switcher, and the chevron is a bit big. Make both quieter.' },
  {
    kind: 'work',
    id: 'w2',
    seconds: 48,
    steps: [
      {
        kind: 'tools',
        id: 't3',
        calls: [
          call({ id: 'c7', kind: 'edit', title: 'apps/web/src/components/Sidebar.tsx' }),
          call({ id: 'c8', kind: 'edit', title: 'apps/web/src/components/ProjectSwitcher.tsx' }),
        ],
      },
    ],
  },
  { kind: 'shown', id: 'sh2', files: [shot('s2', 'second', 'Search on the canvas ground, the chevron at 10px')] },
  {
    kind: 'agent',
    id: 'a2',
    model: 'Opus 5.5',
    text:
      'Search now sits on the canvas until hovered, and the switcher’s chevron is 10px in the muted grey.\n\n' +
      'If this is right, say so or press **Hand back** and I will write the summary for the lead.',
  },
]

const ASSIGNMENT: WorkerAssignment = {
  label: 'Header',
  purpose: 'Project switcher, search and the new-chat button',
  kind: 'with-you',
  goal: 'Restyle the sidebar head to decisions 4–6: one 24px row, the project mark in its accent tile, search and "+" as quiet icon buttons.',
  doneWhen: 'You say the head looks right in both themes.',
  model: 'Opus 5.5',
  startedBy: 'lead',
}

const HEADER_WORKER: WorkerEntry = {
  id: 'worker_header',
  label: 'Header',
  purpose: ASSIGNMENT.purpose,
  status: 'needs-you',
  kind: 'with-you',
  startedBy: 'lead',
  createdAt: now - 3 * HOUR,
  updatedAt: now - 4 * MIN,
}

/** One moment of a worker's chat. */
export interface WorkerMoment {
  key: 'with-you' | 'started-by-you' | 'handed-back' | 'failed' | 'old-side-chat'
  label: string
  worker: WorkerEntry
  assignment: WorkerAssignment
  items: ThreadItem[]
  /** Its dev server runs: the header offers Open preview. */
  previewRunning: boolean
  /** The handback, when it went: the chat's last line. */
  handedBack?: { commits: number; files: number; by: 'you' | 'worker' }
}

export const MOMENTS: WorkerMoment[] = [
  {
    key: 'with-you',
    label: 'With you',
    worker: HEADER_WORKER,
    assignment: ASSIGNMENT,
    items: [...FIRST_PASS, ...SECOND_PASS],
    previewRunning: true,
  },
  {
    key: 'started-by-you',
    label: 'Started by you',
    worker: {
      id: 'worker_grain',
      label: 'Try a film grain behind the head',
      purpose: '',
      status: 'needs-you',
      startedBy: 'you',
      createdAt: now - 20 * MIN,
      updatedAt: now - 2 * MIN,
    },
    assignment: { label: 'Try a film grain behind the head', purpose: '', kind: null, model: 'Sonnet 5.5', startedBy: 'you' },
    items: [
      {
        kind: 'user',
        id: 'rb',
        from: 'runcastle',
        text: 'You are a worker on Sidebar refresh, started by the human with no assignment. The feature’s state and the lead’s latest turns follow; wait for the human.',
      },
      { kind: 'user', id: 'u1', text: 'Could the halftone behind the head be a film grain instead? Just try it, I want to see it before I bring it to the lead.' },
      {
        kind: 'work',
        id: 'w1',
        seconds: 63,
        steps: [
          {
            kind: 'tools',
            id: 't1',
            calls: [
              call({ id: 'c1', kind: 'read', title: 'apps/web/src/components/SidebarParts.tsx' }),
              call({ id: 'c2', kind: 'edit', title: 'apps/web/src/components/SidebarParts.tsx' }),
              call({ id: 'c3', kind: 'execute', title: 'bun run --cwd apps/web dev --host 0.0.0.0 --port 5173' }),
            ],
          },
        ],
      },
      {
        kind: 'agent',
        id: 'a1',
        model: 'Sonnet 5.5',
        text: 'Done: the halftone is swapped for a static grain at 4% in the text colour. **Open preview** shows it. Keep it and hand it back, or drop it?',
      },
    ],
    previewRunning: true,
  },
  {
    key: 'handed-back',
    label: 'Handed back',
    worker: { ...HEADER_WORKER, status: 'handed-back', updatedAt: now - 1 * MIN },
    assignment: ASSIGNMENT,
    items: [
      ...FIRST_PASS,
      ...SECOND_PASS,
      { kind: 'user', id: 'u2', text: 'Yes, that’s it. Hand it back.' },
      {
        kind: 'work',
        id: 'w3',
        seconds: 21,
        steps: [{ kind: 'tools', id: 't4', calls: [call({ id: 'c9', kind: 'execute', title: 'git commit -m "Header: quieter search and chevron"' })] }],
      },
      {
        kind: 'agent',
        id: 'a3',
        model: 'Opus 5.5',
        text: 'Handed back to the lead, with your two notes (quieter search, smaller chevron) in the summary.',
      },
    ],
    previewRunning: false,
    handedBack: { commits: 3, files: 2, by: 'you' },
  },
  {
    key: 'failed',
    label: 'Failed',
    worker: {
      id: 'worker_data',
      label: 'Worker list data',
      purpose: 'Serve each feature’s workers to the sidebar',
      status: 'failed',
      kind: 'on-its-own',
      startedBy: 'lead',
      createdAt: now - 90 * MIN,
      updatedAt: now - 3 * MIN,
      failure: 'container stopped unexpectedly',
    },
    assignment: {
      label: 'Worker list data',
      purpose: 'Serve each feature’s workers to the sidebar',
      kind: 'on-its-own',
      goal: 'Add the workers to the feature list item: label, purpose, kind, status, with a test for the groups.',
      doneWhen: 'The server’s tests pass and the sidebar reads the workers from the list.',
      model: 'Sonnet 5.5',
      startedBy: 'lead',
    },
    items: [
      {
        kind: 'work',
        id: 'w1',
        seconds: 380,
        steps: [
          {
            kind: 'tools',
            id: 't1',
            calls: [
              call({ id: 'c1', kind: 'read', title: 'packages/core/src/schemas.ts' }),
              call({ id: 'c2', kind: 'edit', title: 'packages/core/src/schemas.ts' }),
              call({ id: 'c3', kind: 'edit', title: 'packages/server/src/services/features.ts' }),
              call({ id: 'c4', kind: 'execute', title: 'bun test packages/server', status: 'failed', output: 'Killed' }),
            ],
          },
        ],
      },
      { kind: 'error', id: 'e1', message: 'The worker’s container stopped unexpectedly (exit 137, out of memory) during “bun test packages/server”. The lead was told.' },
    ],
    previewRunning: false,
  },
  {
    key: 'old-side-chat',
    label: 'Old side chat',
    worker: {
      id: 'side_old',
      label: 'Why does the bay draw square corners?',
      purpose: '',
      status: 'handed-back',
      startedBy: 'you',
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY,
      oldSideChat: true,
    },
    assignment: { label: 'Why does the bay draw square corners?', purpose: '', kind: null, model: 'Opus 5', startedBy: 'you' },
    items: [
      { kind: 'user', id: 'u1', text: 'Why does the Working bay draw square corners on its first row?' },
      {
        kind: 'agent',
        id: 'a1',
        model: 'Opus 5',
        text: 'The first row inside the bay takes `rounded-lg` like a row on its own, so its corners stand out of the bay’s. Rows inside a card should take `rounded-md` so the corners nest — `nested` on `SidebarFeatureRow` does that.',
      },
      { kind: 'user', id: 'u2', text: 'Thanks — tell the lead.' },
      { kind: 'agent', id: 'a2', model: 'Opus 5', text: 'I can’t reach the lead from a side chat; paste this into its chat.' },
    ],
    previewRunning: false,
  },
]
