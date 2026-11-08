/**
 * runcastle's glossary (ready-to-publish decisions 15-17): one plain sentence
 * per word a newcomer meets. The Glossary dialog lists them all, and a `Term`
 * shows one where the word first appears, so the app says the same sentence
 * everywhere. A word earns an entry only if it is one of the words decision 15
 * settled, or a name the app shows with no other explanation.
 */

export type GlossaryGroup = 'work' | 'building' | 'trying' | 'project'

export const GLOSSARY_GROUP_LABEL: Record<GlossaryGroup, string> = {
  work: 'Your work',
  building: 'Building',
  trying: 'Trying it',
  project: 'The project',
}

export const GLOSSARY_GROUP_ORDER: GlossaryGroup[] = ['work', 'building', 'trying', 'project']

export type GlossaryId =
  | 'feature'
  | 'chat'
  | 'plan'
  | 'design'
  | 'ticket'
  | 'backlog'
  | 'note'
  | 'round'
  | 'worker'
  | 'review'
  | 'review-package'
  | 'test-drive'
  | 'scenario'
  | 'orchestrator'
  | 'held-by'

export interface GlossaryEntry {
  id: GlossaryId
  /** The word as the app writes it. */
  term: string
  /** One plain sentence. No other glossary word is needed to read it. */
  definition: string
  group: GlossaryGroup
  /** The words this one replaced, for anyone who learned those (decision 20). */
  onceCalled?: readonly string[]
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: 'feature',
    term: 'Feature',
    group: 'work',
    definition: 'One thing you want built, with its own branch, its own chat with an agent, and its own docs in your repo.',
  },
  {
    id: 'chat',
    term: 'Chat',
    group: 'work',
    definition: 'A conversation with an agent. Every feature has one, and the orchestrator has its own.',
    onceCalled: ['thread', 'session', 'conversation'],
  },
  {
    id: 'plan',
    term: 'Plan',
    group: 'work',
    definition: 'What the feature’s agent proposes before anything is built: the decisions, the spec, the tickets and any designs. Nothing is built until you say yes.',
  },
  {
    id: 'design',
    term: 'Design',
    group: 'work',
    definition: 'A screen the agent made from the app’s real components and sample data, for you to look at before it is wired up.',
  },
  {
    id: 'ticket',
    term: 'Ticket',
    group: 'work',
    definition: 'A piece of a feature as features were split before workers. Features built that way keep theirs, read only, in History.',
  },
  {
    id: 'backlog',
    term: 'Backlog',
    group: 'work',
    definition: 'Ideas parked for later: a title and a few lines, with no branch and nothing built.',
  },
  {
    id: 'note',
    term: 'Note',
    group: 'work',
    definition: 'Something you noticed, jotted down with Ctrl+J. Notes wait in the project’s inbox until you sort them.',
  },
  {
    id: 'round',
    term: 'Round',
    group: 'building',
    definition: 'How features ran their tickets before workers: in containers while you were away. Features built that way keep theirs, read only, in History.',
    onceCalled: ['burn', 'AFK burn', 'run', 'lap'],
  },
  {
    id: 'worker',
    term: 'Worker',
    group: 'building',
    definition: 'An agent the lead hands one piece of a feature to, in its own container and branch. You can open it, talk to it, and it hands its work back to the lead. It needs Docker or Podman.',
    onceCalled: ['burner', 'lane', 'AFK agent'],
  },
  {
    id: 'review',
    term: 'Review',
    group: 'building',
    definition: 'The worker a feature ends with: it runs the app or the project’s checks, compares the work with the plan and reports what it finds.',
  },
  {
    id: 'review-package',
    term: 'Review package',
    group: 'building',
    definition: 'What the review hands you: screenshots, a recorded walkthrough, the checks it ran and what it found.',
  },
  {
    id: 'test-drive',
    term: 'Test drive',
    group: 'trying',
    definition: 'Running the app on your machine to try it yourself, with a notes panel beside it: a feature’s branch, or main to try everything that has shipped.',
    onceCalled: ['drive mode', 'project drive'],
  },
  {
    id: 'scenario',
    term: 'Scenario',
    group: 'trying',
    definition: 'A script that puts the app in a given state, such as a signed-in user with some data, so a test drive starts where the feature is.',
  },
  {
    id: 'orchestrator',
    term: 'Orchestrator',
    group: 'project',
    definition: 'The project’s own agent. Bring it a raw idea and it checks what exists, cuts the idea into features, and can start, message and merge them when you ask.',
  },
  {
    id: 'held-by',
    term: 'Held by',
    group: 'project',
    definition: 'The orchestrator chat looking after a feature. It hears when the feature needs you and can act on it for you.',
  },
]

export function glossaryEntry(id: GlossaryId): GlossaryEntry {
  const entry = GLOSSARY.find((e) => e.id === id)
  if (!entry) throw new Error(`no glossary entry "${id}"`)
  return entry
}

/** Entries whose word or sentence contains every word of `query`. */
export function filterGlossary(query: string): GlossaryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...GLOSSARY]
  return GLOSSARY.filter((e) => {
    const hay = `${e.term} ${e.definition} ${(e.onceCalled ?? []).join(' ')}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
