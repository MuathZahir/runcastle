import type { ThreadEntry } from '../src/lib/chat-thread'

/**
 * Threads for /preview/sidebar-threads.html (threads-in-the-sidebar), in the
 * order the sidebar shows them: a feature's main chat first, then the rest by
 * when they were started, newest first; the Orchestrator's chats newest
 * started first. Keyed by the title of the busy sample's feature they belong to.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

let n = 0
function t(title: string, over: Partial<ThreadEntry> = {}): ThreadEntry {
  n += 1
  return { id: `thread_${n}`, title, role: 'side', state: 'idle', updatedAt: now - 3 * HOUR, runtime: 'claude-code', ...over }
}

export const featureThreads: Record<string, ThreadEntry[]> = {
  'Sidebar refresh': [
    t('Plan the sidebar refresh with me', { role: 'main', state: 'waiting', updatedAt: now - 4 * MIN }),
    t('Why does the bay draw square corners?', { updatedAt: now - 2 * HOUR }),
    t('Try a film grain behind the head', { state: 'working', updatedAt: now - 1 * MIN }),
    t('Scenario chat · Fix busy-project', { role: 'scenario', updatedAt: now - 1 * DAY }),
    t('Count well contrast in the light theme', { updatedAt: now - 2 * DAY }),
    t('Shelf chevrons turn the wrong way', { updatedAt: now - 3 * DAY }),
    t('Orchestrator icon: three options', { updatedAt: now - 4 * DAY }),
    t('Export the decision log for the ADR', { updatedAt: now - 6 * DAY }),
  ],
  'Prepare reruns stale checks': [
    t('Rerun the checks that went stale', { role: 'main', state: 'working', updatedAt: now - 1 * MIN }),
    t('What counts as stale?', { updatedAt: now - 5 * HOUR }),
    t('Scenario chat · New scenario', { role: 'scenario', updatedAt: now - 1 * DAY }),
  ],
  'Scenario fixtures for drives': [t('Seed a busy project for every drive', { role: 'main', updatedAt: now - 40 * MIN })],
}

const PROJECT_TOPICS = [
  'Cut threads into the sidebar',
  'What shipped this week?',
  'Triage the notes from Monday',
  'Why did round 3 of the burn fail?',
  'Merge the chat feature',
  'Plan the launch film',
  'Is the Codex runtime ready?',
  'Re-run preparation after the bun upgrade',
  'Split the design system feature',
  'Which features wait on the sidebar?',
]

/** About as many chats as this repo's Orchestrator holds: 80. */
export const orchestratorThreads: ThreadEntry[] = Array.from({ length: 80 }, (_, i) =>
  t(i < PROJECT_TOPICS.length ? PROJECT_TOPICS[i] : `${PROJECT_TOPICS[i % PROJECT_TOPICS.length]} (${Math.floor(i / 10) + 1})`, {
    role: 'project',
    state: i === 0 ? 'working' : i === 7 ? 'waiting' : 'idle',
    updatedAt: i === 0 ? now - MIN : now - (i * i + 2) * 37 * MIN,
  }),
)
