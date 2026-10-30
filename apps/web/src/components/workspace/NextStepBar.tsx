import type { ReactNode } from 'react'
import { BranchMenu, Button, IconButton, SplitButton, Spinner, StatusDot, StatusLabel, cx } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import type { ButtonVariant, StatusTone } from '../../ui'
import type { ActionKind, CountPill, NextAction, NextStep } from '../../lib/feature-ui'
import {
  IconAlert,
  IconArchive,
  IconArrowRight,
  IconClock,
  IconGitMerge,
  IconInbox,
  IconMessage,
  IconMore,
  IconPlay,
  IconSettings,
  IconSparkle,
  IconStop,
  IconTerminal,
} from '../../icons'

/** Every action leads with an icon (DESIGN.md principle 7) — one per kind. */
export const ACTION_ICON: Record<ActionKind, ReactNode> = {
  startDraft: <IconPlay />,
  markUpNext: <IconClock />,
  moveToBacklog: <IconInbox />,
  chat: <IconMessage />,
  selfPlan: <IconSparkle />,
  stopSelfPlan: <IconStop />,
  stopAgent: <IconStop />,
  openBurnSettings: <IconSettings />,
  testDriveStart: <IconPlay />,
  testDriveStop: <IconStop />,
  fixDrive: <IconTerminal />,
  merge: <IconGitMerge />,
  resolveConflict: <IconAlert />,
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
 * A parked draft's next-step row, in its header (DESIGN.md §Page anatomy 4) —
 * a started feature's actions are its one header row's (design-mode decision
 * 12). No band, no border, no background. Left, one sentence in `text-secondary` — what is
 * happening, or what you should do (the resolver's title, then its guidance
 * when guidance is on). Right, the ONE primary and at most the secondaries the
 * resolver chose. A disabled action says why as a caption beneath the buttons,
 * and when there is a way out of that reason (decision 20) the caption carries
 * the one click that takes it.
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
  split,
}: {
  ns: NextStep
  guidance: boolean
  busy: boolean
  onAction: (kind: ActionKind) => void
  draftBranch?: {
    branches: string[] | undefined
    value: string | null
    detected?: string
    missing: boolean
    onPick: (branch: string) => void
  }
  /**
   * The one action that carries choices behind a caret (Test drive and its
   * scenarios, drive-scenarios decision 7): wherever that kind sits on the row
   * it renders as a {@link SplitButton} under `label`, its main click still
   * `onAction(kind)` and `menu` the rows behind the caret. In the "More" menu,
   * where a menu cannot nest, it stays a plain item under the same label.
   */
  split?: { kind: ActionKind; label: string; picker: ReactNode; menuLabel: string }
}) {
  const secondary = ns.secondary
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

  const labelOf = (a: NextAction): string => (split?.kind === a.kind ? split.label : a.label)
  /** One action's button — the split one where `split` names its kind. */
  const actionButton = (a: NextAction, variant: ButtonVariant, label: ReactNode, key?: number) =>
    split?.kind === a.kind ? (
      <SplitButton
        key={key}
        variant={variant}
        icon={ACTION_ICON[a.kind]}
        disabled={busy || !!a.disabled}
        title={a.disabled ?? a.hint}
        onClick={() => onAction(a.kind)}
        picker={split.picker}
        menuLabel={split.menuLabel}
      >
        {label}
      </SplitButton>
    ) : (
      <Button
        key={key}
        variant={variant}
        icon={ACTION_ICON[a.kind]}
        disabled={busy || !!a.disabled}
        title={a.disabled ?? a.hint}
        onClick={() => onAction(a.kind)}
      >
        {label}
      </Button>
    )

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
          <p className="mt-1.5 mb-0 text-xs text-text-tertiary first-letter:uppercase" role="note">
            {ns.note}
          </p>
        )}
      </div>

      {hasActions && (
        // The group shrinks and wraps; the buttons inside it never do — a
        // group sized to its widest row ran the primary off the page.
        // `ml-auto`: wrapped under a long sentence, the group still sits on
        // the right, the primary last — the same place on every phase.
        <div className="ml-auto flex min-w-0 flex-col items-end gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {shown.map((a, i) => actionButton(a, 'ghost', labelOf(a), i))}
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
                      onSelect={() => onAction(a.kind)}
                    >
                      {labelOf(a)}
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
                {actionButton(
                  ns.primary,
                  ns.primary.danger ? 'danger' : 'primary',
                  busy ? 'Working…' : labelOf(ns.primary),
                )}
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
                  ? 'text-warning-text'
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
