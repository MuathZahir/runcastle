import { backlogDependencies, stuckReason, unstartedState, type DependencyRef } from '@runcastle/core'
import type { NextAction, NextStep } from './types'
import type { ResolverInput } from './resolver-input'
import { blockers, waitingReason } from '../dependencies'
import { SELF_PLAN_ACTION } from './chat'

const DRAFT_BASE_BLOCKED = {
  loading: 'Loading the branch list…',
  unpicked: 'pick a branch first',
} as const

const MOVE_TO_BACKLOG: NextAction = { label: 'Move to backlog', kind: 'moveToBacklog' }

/**
 * The server's skipped-autostart message (`startUpNextDependents`) when the
 * dependencies merged into different branches — the one stuck reason where no
 * base is the right default, so the page leaves the picker empty.
 */
export function upNextBasesDiffer(problem: string | null): boolean {
  return !!problem && problem.includes('merged into different branches')
}

/** "a", "a and b", "a, b and c" — slugs as a sentence names them. */
function slugList(deps: DependencyRef[]): string {
  const slugs = deps.map((d) => d.slug)
  return slugs.length < 2 ? (slugs[0] ?? '') : `${slugs.slice(0, -1).join(', ')} and ${slugs.at(-1)}`
}

/** "a ships" / "a and b ship". */
function ships(deps: DependencyRef[]): string {
  return `${slugList(deps)} ${deps.length === 1 ? 'ships' : 'ship'}`
}

export function resolveDraft({ full, ctx }: ResolverInput): NextStep {
  // Unmerged dependencies outrank a missing base (ADR-0013): picking a branch
  // would not make Start clickable while the draft still waits.
  const blocked =
    waitingReason(full.dependsOn) ?? (ctx.draftBaseMissing ? DRAFT_BASE_BLOCKED[ctx.draftBaseMissing] : null)
  const disabled = blocked ? { disabled: blocked } : {}
  const start: NextAction = { label: 'Start', kind: 'startDraft', ...disabled }
  // Beside Start, never instead of it (features-plan-themselves decision 12):
  // it starts the draft the same way, so it waits on the same thing.
  const selfPlan: NextAction = { ...SELF_PLAN_ACTION, ...disabled }
  const open = blockers(full.dependsOn)

  switch (unstartedState(full.feature, full.dependsOn)) {
    // Waiting is not backlog (decision 8): the human can say "yes, as soon as
    // it ships" right beside the Start that cannot fire yet.
    case 'blocked': {
      const caption = `Start when ready: starts by itself when ${ships(open)}; it can't be undone.`
      return {
        kick: 'NEXT STEP',
        title: 'Start this feature',
        desc: 'In the backlog. You can make it start by itself instead, as soon as what it waits on ships.',
        primary: start,
        secondary: [selfPlan, { label: 'Start when ready', kind: 'markUpNext', hint: caption }],
        busy: false,
        note: caption,
      }
    }
    // A backlog dependency will never move by itself (decision 14), so that is
    // what the bar leads with.
    case 'upNext': {
      const parked = backlogDependencies(full.dependsOn)
      return {
        kick: 'UP NEXT',
        ...(parked.length > 0
          ? {
              title: `Won't start until you start ${slugList(parked)}`,
              desc: `${slugList(parked)} ${parked.length === 1 ? 'is' : 'are'} in the backlog, so nothing will move ${parked.length === 1 ? 'it' : 'them'}. It starts by itself once ${open.length === 1 ? `${slugList(open)} has shipped` : `${slugList(open)} have all shipped`}.`,
            }
          : {
              title: `Starts by itself when ${ships(open)}`,
              desc: `Its branch will be cut from the branch ${open.length === 1 ? `${slugList(open)} merges` : 'they merge'} into. Nothing launches and no tokens are spent.`,
            }),
        secondary: [MOVE_TO_BACKLOG],
        busy: false,
      }
    }
    // It meant to start by itself and did not (decision 5): the reason, and
    // Start as for any draft — still refused while an archived dependency
    // stands, because the server's Start gate holds.
    case 'stuck':
      return {
        alert: true,
        kick: 'NEXT STEP',
        title: "Didn't start by itself",
        desc: asSentence(full.upNextProblem ?? stuckReason(full.dependsOn), full.dependsOn),
        primary: start,
        secondary: [selfPlan, MOVE_TO_BACKLOG],
        busy: false,
      }
    default:
      return {
        kick: 'NEXT STEP',
        title: 'Start this feature',
        desc: 'In the backlog — Start cuts its branch, writes the brief, and opens the grill with you. Plan it yourself makes the plan without you.',
        primary: start,
        secondary: [selfPlan],
        busy: false,
      }
  }
}

/**
 * A stuck reason as the bar's description: the reasons are written lowercase
 * for the sidebar's hover, and the server's autostart messages lead with what
 * the title already says ("didn't start by itself: …"), so drop that lead-in
 * and start the sentence with a capital — unless it starts with a slug, which
 * is a name and keeps its own spelling.
 */
function asSentence(reason: string, deps: DependencyRef[]): string {
  const body = reason.replace(/^(?:didn't|couldn't) start by itself:\s*/i, '')
  if (deps.some((d) => body.startsWith(`${d.slug} `))) return body
  return body.charAt(0).toUpperCase() + body.slice(1)
}
