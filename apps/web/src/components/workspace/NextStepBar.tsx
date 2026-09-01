import { useState } from 'react'
import { BranchMenu, Button } from '../../ui'
import type { ActionKind, NextAction, NextStep, ReasonPrompt } from '../../lib/feature-ui'

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
  onAction: (kind: ActionKind, reason?: string) => void
  draftBranch?: {
    branches: string[] | undefined
    value: string | null
    detected?: string
    missing: boolean
    onPick: (branch: string) => void
  }
}) {
  // An action carrying a `reason` prompt (Override & converge…) doesn't fire on
  // click: it replaces the buttons with an inline input until the human commits
  // or cancels.
  const [asking, setAsking] = useState<{ kind: ActionKind; prompt: ReasonPrompt } | null>(null)
  const [reason, setReason] = useState('')
  const stopAsking = () => {
    setAsking(null)
    setReason('')
  }
  const click = (a: NextAction) =>
    a.reason ? setAsking({ kind: a.kind, prompt: a.reason }) : onAction(a.kind)

  const kickClass =
    ns.kick === 'IN PROGRESS'
      ? 'is-progress'
      : ns.kick === 'SHIPPED'
        ? 'is-shipped'
        : ns.kick === 'WAITING'
          ? 'is-waiting'
          : ''

  return (
    <div className="nextstep">
      {ns.busy && <span className="spin-ring nextstep-spin" />}
      <div className="nextstep-main">
        <div className={`nextstep-kick ${kickClass}`}>{ns.kick}</div>
        <div className="nextstep-title">{ns.title}</div>
        {guidance && <div className="nextstep-desc">{ns.desc}</div>}
        {/* Fog is shown, never enforced — it warns beside the action without
            gating it (ADR-0001 §13.6). */}
        {ns.fog && (
          <div className="nextstep-fog" role="note">
            <span className="nextstep-fog-icon" aria-hidden="true">
              ⚑
            </span>
            <span>Fog remains — still not specified: {ns.fog}. You can converge anyway.</span>
          </div>
        )}
        {/* Shown, never enforced (decision 7): the drive keys nothing has ever
            proven, said where the eye already is before the click. The button
            beside it stays live. */}
        {ns.warning && (
          <div className="nextstep-warn" role="note">
            <span className="nextstep-warn-icon" aria-hidden="true">
              ⚑
            </span>
            <span>{ns.warning}</span>
          </div>
        )}
      </div>
      <div className="nextstep-actions">
        {asking ? (
          <div className="nextstep-override">
            <input
              className="override-input"
              placeholder={asking.prompt.placeholder}
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="solid"
              className="btn-xs"
              disabled={busy || !reason.trim()}
              onClick={() => {
                onAction(asking.kind, reason.trim())
                stopAsking()
              }}
            >
              {asking.prompt.submitLabel}
            </Button>
            <Button variant="ghost" className="btn-xs" onClick={stopAsking}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            {/* `a.disabled` is the reason the server would refuse this action in
                the current state — shown as the tooltip beside the dead button,
                so the user reads why instead of hunting for a vanished verb. */}
            {ns.secondary.map((a, i) => (
              <Button
                key={i}
                variant="ghost"
                className="btn-xs"
                disabled={busy || !!a.disabled}
                title={a.disabled}
                onClick={() => click(a)}
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
                  onClick={() => click(ns.primary!)}
                >
                  {busy ? 'Working…' : ns.primary.label}
                </Button>
                {draftBranch && ns.primary.disabled === 'pick a branch first' && (
                  <span className="text-sm text-warn">pick a branch first</span>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
