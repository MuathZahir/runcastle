import type { ReactNode } from 'react'
import { BranchMenu, Button, IconButton, Spinner, StatusDot, StatusLabel, cx } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import type { StatusTone } from '../../ui'
import type { ActionKind, CountPill, NextAction, NextStep } from '../../lib/feature-ui'
import {
  IconAlert,
  IconArchive,
  IconArrowRight,
  IconFlame,
  IconGitMerge,
  IconMessage,
  IconMore,
  IconPlay,
  IconRefresh,
  IconSparkle,
  IconStop,
  IconTerminal,
} from '../../icons'

/** Every action leads with an icon (DESIGN.md principle 7) — one per kind. */
const ACTION_ICON: Record<ActionKind, ReactNode> = {
  startDraft: <IconPlay />,
  chat: <IconMessage />,
  converge: <IconSparkle />,
  workNext: <IconArrowRight />,
  resumeConverge: <IconRefresh />,
  burn: <IconFlame />,
  cancelRun: <IconStop />,
  testDriveStart: <IconPlay />,
  testDriveStop: <IconStop />,
  stopDriveAndIterate: <IconStop />,
  fixDrive: <IconTerminal />,
  merge: <IconGitMerge />,
  resolveConflict: <IconAlert />,
  iterate: <IconRefresh />,
  endSessionAndIterate: <IconRefresh />,
  unarchive: <IconArchive />,
}

// A tone is a whole literal, never an interpolated colour name (STYLE.md).
const COUNT_TONE: Record<CountPill['tone'], StatusTone> = {
  danger: 'danger',
  note: 'neutral',
  clear: 'success',
}

/** The sentence ends in a full stop before the guidance that follows it. */
function sentence(text: string): string {
  return /[.!?…:]$/.test(text) ? text : `${text}.`
}

/**
 * The next-step row under the stepper (DESIGN.md §Page anatomy 4): no band, no
 * border, no background. Left, one sentence in `text-secondary` — what is
 * happening, or what you should do (the resolver's title, then its guidance
 * when guidance is on). Right, the ONE primary and at most the secondaries the
 * resolver chose. A disabled action says why as a caption beneath the buttons,
 * and when there is a way out of that reason (decision 20) the caption carries
 * the one click that takes it.
 *
 * `hideChat` drops the constant Chat door from the secondaries when the page's
 * topbar already carries it — the same action, said once. A Chat the resolver
 * promoted to the primary stays: there, talking IS the next step.
 *
 * With nothing to do and nothing happening (a shipped feature), it renders
 * nothing — the stepper already says where the feature is.
 */
export function NextStepBar({
  ns,
  guidance,
  busy,
  onAction,
  draftBranch,
  hideChat = false,
}: {
  ns: NextStep
  guidance: boolean
  busy: boolean
  onAction: (kind: ActionKind, waypointId?: string) => void
  draftBranch?: {
    branches: string[] | undefined
    value: string | null
    detected?: string
    missing: boolean
    onPick: (branch: string) => void
  }
  hideChat?: boolean
}) {
  const secondary = hideChat ? ns.secondary.filter((a) => a.kind !== 'chat') : ns.secondary
  // Disabled actions, in button order, each with the reason it cannot fire.
  const refused = [...secondary, ns.primary].filter(
    (a): a is NextAction & { disabled: string } => !!a?.disabled,
  )
  const hasActions = !!ns.primary || secondary.length > 0
  // At most two secondaries beside the primary (DESIGN.md §Page anatomy 4);
  // the rest stay one click away in a "More" menu rather than disappearing.
  const shown = secondary.length > 2 ? secondary.slice(0, 2) : secondary
  const overflow = secondary.length > 2 ? secondary.slice(2) : []
  if (!hasActions && !ns.busy && !ns.alert && !ns.counts && !ns.note) return null

  const lead = ns.title ?? (guidance ? undefined : ns.desc)
  const guide = guidance && ns.desc && ns.desc !== lead ? ns.desc : undefined

  return (
    // Keyed on what it says, so a change of state cross-fades rather than
    // snapping — and a refetch that says the same thing does not.
    <div
      key={`${ns.title ?? ''}|${ns.primary?.kind ?? ''}`}
      className="flex flex-wrap items-start gap-x-6 gap-y-3 animate-fade-in"
      role={ns.alert ? 'alert' : undefined}
    >
      <div className="min-w-0 flex-1 basis-80 text-sm text-text-secondary">
        {(lead || guide) && (
          <p className="m-0 text-pretty">
            {ns.busy ? (
              <Spinner size="sm" className="mr-2 inline-block align-[-2px]" />
            ) : ns.alert ? (
              <StatusDot tone="warning" className="mr-2 align-middle" />
            ) : null}
            {lead && <span className="font-medium text-text">{guide ? sentence(lead) : lead}</span>}
            {lead && guide && ' '}
            {guide}
          </p>
        )}
        {/* The count line is the ONE thing here guidance cannot hide
            (decision 3): the primary follows the count, so a row that hid it
            would be a button whose reason is nowhere on the page. */}
        {ns.counts && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {ns.counts.pills.map((pill) => (
              <StatusLabel key={pill.label} tone={COUNT_TONE[pill.tone]} size="sm">
                {pill.label}
              </StatusLabel>
            ))}
            {ns.counts.trailing && <span className="text-sm text-text-tertiary">{ns.counts.trailing}</span>}
          </div>
        )}
        {ns.note && (
          <p className="mt-1.5 mb-0 text-xs text-text-tertiary" role="note">
            {ns.note}
          </p>
        )}
      </div>

      {hasActions && (
        // The group shrinks and wraps; the buttons inside it never do — a
        // group sized to its widest row ran the primary off the page.
        <div className="flex min-w-0 flex-col items-end gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {shown.map((a, i) => (
              <Button
                key={i}
                variant="ghost"
                icon={ACTION_ICON[a.kind]}
                disabled={busy || !!a.disabled}
                title={a.disabled ?? a.hint}
                onClick={() => onAction(a.kind, a.waypointId)}
              >
                {a.label}
              </Button>
            ))}
            {overflow.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More actions" icon={<IconMore />} disabled={busy} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {overflow.map((a) => (
                    <DropdownMenuItem
                      key={a.kind}
                      icon={ACTION_ICON[a.kind]}
                      disabled={!!a.disabled}
                      title={a.disabled ?? a.hint}
                      onSelect={() => onAction(a.kind, a.waypointId)}
                    >
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {ns.primary && (
              <>
                {draftBranch && (
                  <BranchMenu
                    prefix="from"
                    value={draftBranch.value}
                    branches={draftBranch.branches}
                    detected={draftBranch.detected}
                    missing={draftBranch.missing}
                    onPick={draftBranch.onPick}
                  />
                )}
                <Button
                  variant={ns.primary.danger ? 'danger' : 'primary'}
                  icon={ACTION_ICON[ns.primary.kind]}
                  disabled={busy || !!ns.primary.disabled}
                  title={ns.primary.disabled ?? ns.primary.hint}
                  onClick={() => onAction(ns.primary!.kind, ns.primary!.waypointId)}
                >
                  {busy ? 'Working…' : ns.primary.label}
                </Button>
              </>
            )}
          </div>
          {/* Why a button is dead, where the eye is — beneath it — and, when
              the refusal has a way out (decision 20), the one click that
              takes it, so "Stop the test drive first" is not a dead end. */}
          {refused.map((a) => (
            <div
              key={a.kind}
              className={cx(
                'flex flex-wrap items-center justify-end gap-2 text-right text-xs',
                draftBranch && a.kind === 'startDraft' && draftBranch.missing
                  ? 'text-warning'
                  : 'text-text-tertiary',
              )}
            >
              <span>{a.disabled}</span>
              {a.escape && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ACTION_ICON[a.escape.kind]}
                  onClick={() => onAction(a.escape!.kind)}
                  disabled={busy}
                >
                  {a.escape.label}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
