import { BranchMenu, Button } from '../../ui'
import type { ActionKind, NextAction, NextStep } from '../../lib/feature-ui'

export function NextStepBar({
  ns,
  guidance,
  busy,
  onAction,
  draftBranch,
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
}) {
  // Disabled actions that carry a way out of their own reason.
  const escapes = [ns.primary, ...ns.secondary].filter(
    (a): a is NextAction & { disabled: string; escape: NextAction } => !!a?.disabled && !!a.escape,
  )

  return (
    // `flex-wrap` + the copy column's `basis-[26rem]` are decision 30e: the
    // conflict state mounts the most buttons of any bar, the action buttons
    // never shrink, and without a floor the kick/title/desc collapsed to one
    // word per line in the state that most needs reading. Wide bars are
    // unchanged; a crowded one wraps the actions to their own row instead.
    <div className="flex min-h-24 flex-wrap items-center gap-6 border-b border-hairline bg-panel-2 px-6 py-4">
      {ns.busy && <span className="size-4 animate-spin rounded-pill border-2 border-hairline-strong border-t-accent" />}
      <div className="min-w-0 flex-1 basis-[26rem]">
        <div className="font-mono text-xs uppercase tracking-[0.12em] text-text-3">{ns.kick}</div>
        <div className="mt-1 text-lg font-semibold text-text">{ns.title}</div>
        {guidance && <div className="mt-1 max-w-[68ch] text-sm text-text-2">{ns.desc}</div>}
        {ns.note && <div className="mt-2 text-sm text-text-3" role="note">{ns.note}</div>}
        {/* A refusal with a way out of it (decision 20). The tooltip on the dead
            button says why; this says why WHERE THE EYE IS and puts the one
            click that clears it beside the sentence, so "Stop the test drive
            first" stops being a dead end. */}
        {escapes.map((a) => (
          <div key={a.kind} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-3">
            <span>{a.disabled}</span>
            <Button size="xs" onClick={() => onAction(a.escape.kind)} disabled={busy}>
              {a.escape.label}
            </Button>
          </div>
        ))}
      </div>
      {/* The group shrinks and wraps; the buttons inside it do not. A group
          that refused to shrink was sized to its widest possible row — a long
          branch in the picker beside a secondary and the primary — and ran off
          the right edge of the workspace, which the frame's hidden overflow
          then clipped away with no scrollbar to reach it. */}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {/* `a.disabled` is the reason the server would refuse this action in
                the current state — shown as the tooltip beside the dead button,
                so the user reads why instead of hunting for a vanished verb. */}
            {ns.secondary.map((a, i) => (
              <Button
                key={i}
                variant="ghost"
                disabled={busy || !!a.disabled}
                title={a.disabled ?? a.hint}
                onClick={() => onAction(a.kind, a.waypointId)}
              >
                {a.label}
              </Button>
            ))}
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
                  variant={ns.primary.danger ? 'danger' : 'solid'}
                  disabled={busy || !!ns.primary.disabled}
                  title={ns.primary.disabled}
                  onClick={() => onAction(ns.primary!.kind, ns.primary!.waypointId)}
                >
                  {busy ? 'Working…' : ns.primary.label}
                </Button>
                {draftBranch && ns.primary.disabled === 'pick a branch first' && (
                  <span className="text-sm text-warn">pick a branch first</span>
                )}
              </>
            )}
      </div>
    </div>
  )
}
