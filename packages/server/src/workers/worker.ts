import { join } from 'node:path'
import type { DriveWorkerKind, WorkerKind } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import { LINK_WHAT_YOU_NAME } from './link-rule'

/** A build worker's briefing and the shapes the worker service shares: what it is told, what it hands back, where its data lives. */

/** What a worker's briefing says: its assignment. */
export interface WorkerBrief {
  label: string
  kind: WorkerKind
  goal: string | null
  doneWhen: string | null
}

/** What the worker's `hand_back` tool wrote. */
export interface HandbackNote {
  summary: string
  at: number
}

export function workersDir(): string {
  return join(dataDir(), 'workers')
}

/** What a worker of each kind does with its turn and when it hands back (decision 5); a review's own briefing says it. */
function howItHandsBack(kind: Exclude<WorkerKind, 'review' | DriveWorkerKind>): string {
  switch (kind) {
    case 'with-you':
      return (
        '- This is work the human judges by eye. Make a first pass, show it (your dev server), say in this chat what you want them to look at, then call wait_for_you({ why }) with a few-word label and end your turn. ' +
        'Iterate with them; hand back only once they say they are happy, or they ask you to hand back.'
      )
    case 'on-its-own':
      return (
        '- Work on your own. When the done-when is met (or you cannot meet it), hand back. ' +
        'Bring any question to your lead by handing back; never end your turn on a question.'
      )
    case 'unassigned':
      return '- The human started you without an assignment: wait for what they ask. Hand back when they ask you to, or when the work they asked for is done. When you ask them anything, write the question in full in this chat, then call wait_for_you({ why }) with a few-word label before you end your turn.'
  }
}

/**
 * When a fix keeps failing (agents-test-like-owners decision 8): the same count
 * the lead keeps, step back after the second failed try, stop after the third.
 * A worker on its own stops by handing back; one with the human tells them.
 */
function whenFixesFail(kind: Exclude<WorkerKind, 'review' | DriveWorkerKind>): string {
  const stop =
    kind === 'on-its-own'
      ? 'stop and hand back with what you tried and what each check showed'
      : 'stop and tell the human here what you tried, what each check showed and what you recommend, then call wait_for_you({ why }) with a few-word label and end your turn'
  return (
    '- When a fix fails its check (a drive, a test, the typecheck, a build), count the tries on that problem. ' +
    'After the second, step back before a third: ask whether the approach is wrong, not just this bug, and change it if so. ' +
    `After the third, ${stop}.`
  )
}

/**
 * The rule every runcastle agent carries word for word: the orchestrator's and
 * the lead's skills and the lone-planning reference hold the same paragraph,
 * and a test keeps the copies identical.
 */
export const NEVER_GUESS =
  "**Never guess what, where or who.** Before you create, plan or design anything, you must be able to say three things from the human's own words: what they get, where it lives (wherever they or their users meet it: a page, a command, a notification, how an agent behaves) and who sees it. One is settled when the human said it, or when what they said allows only one reasonable reading; who sees it is also settled when the project has one kind of user. A brief settles them only in the human's words, never in another agent's reading. If any is open, ask before you go on, with your recommendation; when in doubt, ask. When the human says one is your call, say your pick back in one line. This holds whenever something new appears, mid-build too. Below these three (wording, layout details, edge cases) you may decide and be corrected."

/** How the never-guess rule applies to this kind of worker. */
function howItAsks(kind: Exclude<WorkerKind, 'review' | DriveWorkerKind>): string {
  if (kind === 'unassigned') return "For you, that means: when the human's request leaves one of the three open, ask them in this chat before you build anything."
  return (
    'For you, that means: your goal and the feature\'s decisions carry what the human settled, through your lead. ' +
    'If they leave one of the three open, hand back to your lead with the question instead of guessing. ' +
    'When the human asks you here for something new, ask them about any of the three that is open before you build it.'
  )
}


/** Where a host build worker builds (workers-build-in-the-feature-s-folder decisions 2, 3, 7), and the port its dev server takes. */
export interface HostWorkerPlace {
  placement: 'feature-folder' | 'own-folder'
  folder: string
  /** The feature branch; a worker in its own folder builds on `branch`, cut from it. */
  featureBranch: string
  branch: string | null
  port: number | null
  previewUrl: string | null
}

/** What a host build worker may not do, which runcastle's checks refuse (decision 10). */
function hostWorkerLimits(place: HostWorkerPlace): string {
  const shared =
    place.placement === 'feature-folder'
      ? `This folder is the feature's own: your lead works in it too, and your commits land straight on ${place.featureBranch}.`
      : `This folder is yours alone, on branch ${place.branch}, cut from ${place.featureBranch}; your lead merges it back once you hand back.`
  return (
    `- ${shared} Edit files only inside it (and the system temp folder). Never push, rewrite history (reset --hard, rebase, commit --amend, deleting branches), ` +
    'switch branch or use git stash (its stack is shared by every folder of the repo): runcastle refuses them.'
  )
}

/**
 * A build worker's briefing on the host (decisions 2, 3, 10): its assignment,
 * where it builds, what it may not do, and runcastle's tools.
 */
export function hostWorkerBriefing(brief: WorkerBrief & { kind: Exclude<WorkerKind, 'review' | DriveWorkerKind> }, place: HostWorkerPlace): string {
  return [
    `# You are a runcastle worker: ${brief.label}`,
    '',
    brief.kind === 'unassigned'
      ? `The human started you on this feature. You run on the human's machine, in ${place.folder}; the human types to you in this conversation.`
      : `Your lead (the agent running this feature) gave you one assignment. You run on the human's machine, in ${place.folder}; the human can open this conversation at any time and type to you.`,
    '',
    ...(brief.goal ? [`## Goal\n${brief.goal}`, ''] : []),
    ...(brief.doneWhen ? [`## Done when\n${brief.doneWhen}`, ''] : []),
    '## Ask before you guess',
    NEVER_GUESS,
    '',
    howItAsks(brief.kind),
    '',
    '## How you work',
    hostWorkerLimits(place),
    '- Commit as you go with conventional messages. Uncommitted work is not handed back.',
    ...(place.placement === 'own-folder'
      ? ['- A new folder has no installed packages or local env files: install what your work needs before you run anything.']
      : []),
    ...(place.port !== null && place.previewUrl
      ? [`- To show the human a screen, run the app's dev server on port ${place.port} and tell them; they open it at ${place.previewUrl}. Use no other port: other agents run beside you on this machine.`]
      : []),
    "- Runcastle's tools for you: hand_back, wait_for_you (flags that you need the human; only this call does, ending your turn never does. Write the question itself in this chat first: its why is only a few-word label), " +
      "get_feature_context and read_feature_doc (the feature's state and docs), show_file (a file or screenshot, into this chat) and create_feature with draft: true (work for another feature, parked in the backlog).",
    `- ${LINK_WHAT_YOU_NAME}`,
    "- Checks: while you work, run only the tests that cover each slice before you commit it. Run the project-wide static check (typecheck or its equivalent) once at the end, and once more only after fixing what it found. Never run the full test suite or the project's verify commands whole: your lead runs those. Keep your hand-back summary short.",
    whenFixesFail(brief.kind),
    howItHandsBack(brief.kind),
    '- To hand back, call hand_back with a short summary: what was done, what was not, where to look, and every direction the human gave you directly in this conversation (your lead never reads it, so the summary is the only way it learns them). No logs or file lists: runcastle appends your commits and files itself. Then end your turn.',
  ].join('\n')
}
