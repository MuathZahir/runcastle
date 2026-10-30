import type { ProjectNote } from '@runcastle/core'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { PROJECT_ID } from '../../../.runcastle/preview/shell-fakes'

/**
 * Sample data for the Orchestrator page (docs/features/the-orchestrator-s-page):
 * a project with a long chat history across weeks, three chats live, and a few
 * open notes from a drive.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function chat(
  id: string,
  title: string,
  ago: number,
  state: ThreadEntry['state'] = 'idle',
  runtime: ThreadEntry['runtime'] = 'claude-code',
): ThreadEntry {
  return { id, title, role: 'project', state, createdAt: now - ago, updatedAt: now - ago, runtime }
}

export const busyChats: ThreadEntry[] = [
  chat('c1', 'Cut the UI work into seven features', 1 * MIN, 'waiting'),
  chat('c2', 'Why did the burn of #14 stall overnight?', 3 * DAY, 'waiting'),
  chat('c3', 'Triage the notes from Tuesday’s drive', 2 * MIN, 'working'),
  chat('c4', 'Plan the changelog release flow', 2 * HOUR),
  chat('c5', 'Which features touch the drive slot?', 5 * HOUR),
  chat('c6', 'Sidebar threads: what shipped and what didn’t', 26 * HOUR),
  chat('c7', 'Retry policy for failed burns', 30 * HOUR, 'idle', 'codex'),
  chat('c8', 'Merge order for the look-the-part features', 3 * DAY + HOUR),
  chat('c9', 'Is the review agent worth it on style changes?', 4 * DAY),
  chat('c10', 'Docker freeze after sleep — what to do', 5 * DAY),
  chat('c11', 'Landing page copy, second pass', 9 * DAY),
  chat('c12', 'Split the settings page', 12 * DAY, 'idle', 'codex'),
  chat('c13', 'Codex runtime parity checklist', 16 * DAY),
  chat('c14', 'Scenario fixtures: who owns them?', 21 * DAY),
  chat('c15', 'Burn concurrency on an 8-core laptop', 27 * DAY),
  chat('c16', 'First ideas for drive scenarios', 41 * DAY),
  chat('c17', 'What does “ready” mean for a feature?', 58 * DAY),
  chat('c18', 'Rename laps to rounds', 73 * DAY),
]

function note(id: string, text: string, ago: number, extra: Partial<ProjectNote> = {}): ProjectNote {
  return {
    id,
    projectId: PROJECT_ID,
    text,
    status: 'open',
    createdAt: now - ago,
    updatedAt: now - ago,
    ...extra,
  }
}

export const busyNotes: ProjectNote[] = [
  note('n1', 'The Working shelf’s light keeps going after the burn finished', 20 * MIN, {
    driveBranch: 'main',
    driveCommit: 'a3f9c21',
  }),
  note('n2', 'Merge dialog: the branch name wraps under the button on a narrow window', 45 * MIN, {
    driveBranch: 'main',
    driveCommit: 'a3f9c21',
  }),
  note('n3', 'Would love a way to pin a chat I keep coming back to', 3 * HOUR),
  note('n4', 'Settings → Models: the Codex row has no description', 26 * HOUR),
  note('n5', 'Search doesn’t find drafts by their brief', 2 * DAY),
  note('n6', 'Toast for a failed rename is cut off', 2 * DAY + HOUR),
  note('n7', 'Typing fast in the note field drops a character now and then', 4 * DAY, {
    status: 'triaged',
    outcome: 'routed into',
  }),
  note('n8', 'The drive’s URL bar could copy on click', 6 * DAY, {
    status: 'triaged',
    outcome: 'dismissed',
  }),
]

/** The latest chat's log: what the Orchestrator opens on. */
export const chatLog = [
  { i: 0, at: now - 20 * MIN, type: 'prompt', id: 'p1', text: 'Cut the UI work into features we can merge one at a time.', source: 'human' },
  { i: 1, at: now - 20 * MIN, type: 'turn_started' },
  {
    i: 2,
    at: now - 12 * MIN,
    type: 'agent_text',
    messageId: 'm1',
    text: 'Seven features, in merge order:\n\n1. The whole app matches the sidebar\n2. Threads in the sidebar\n3. The chat looks the part\n4. The Orchestrator\n5. Test drive looks the part\n6. Review looks the part\n7. Settings looks the part\n\nShall I create them as drafts?',
  },
  { i: 3, at: now - 10 * MIN, type: 'turn_ended', reason: 'end_turn' },
]
