import { BranchMenu, Button } from '../../ui'
import type { ActionKind, NextStep } from '../../lib/feature-ui'

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
  return (
    <div className="flex min-h-24 items-center gap-6 border-b border-hairline bg-panel-2 px-6 py-4">
      {ns.busy && <span className="size-4 animate-spin rounded-pill border-2 border-hairline-strong border-t-accent" />}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs uppercase tracking-[0.12em] text-text-3">{ns.kick}</div>
        <div className="mt-1 text-lg font-semibold text-text">{ns.title}</div>
        {guidance && <div className="mt-1 max-w-[68ch] text-sm text-text-2">{ns.desc}</div>}
        {ns.note && <div className="mt-2 text-sm text-text-3" role="note">{ns.note}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
