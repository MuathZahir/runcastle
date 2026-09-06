import { parsePhase, type Phase } from '@runcastle/core'
import type { GateState } from '../../lib/api'
import { GATE_EXPLAINER } from '../../lib/vocabulary'
import { IconCheck } from '../../icons'

const GATE_NAMES: Record<string, string> = {
  G1: 'Decisions captured',
  G2: 'Spec written',
  G3: 'Tickets approved',
  G4: 'Run clean',
  G5: 'Merged',
}

/**
 * G1 is conditional on `mapped` (ADR-0001 §13.1): its check swaps to
 * `all-waypoints-terminal`, so the short name follows the check, not the id.
 */
function gateName(gate: NonNullable<GateState['next']>): string {
  if (gate.check === 'all-waypoints-terminal') return 'Waypoints resolved'
  return GATE_NAMES[gate.id] ?? gate.id
}

/**
 * The Inspector's gate rail — what the pipeline is waiting for, read-only
 * (decision 6).
 *
 * Read-only is the whole change. The card used to carry an "Override with
 * reason…" link, the form it opened, the consequence line above it and, after
 * an override, an undo banner — three states and two mutations for an escape
 * hatch the human has never used, and most of the card's bulk. The server
 * procedures stay (a wedged check still needs a way out, reachable by an agent);
 * the affordance is gone from the chrome.
 *
 * Pure once its queries have answered, which is the seam the rendered-chrome
 * tests observe it at (apps/web/STYLE.md, tier 1).
 */
export function CurrentGate({ gate, phase }: { gate: GateState; phase: Phase }) {
  return (
    <section className="flex flex-col gap-2">
      <CurrentGateCaption />
      {parsePhase(phase) === null ? (
        // `nextGate` cannot place an unrecognized phase, so it returns no gate —
        // which reads identically to "shipped". Say which it is (findings F19).
        <div className="rounded-md border border-dashed border-hairline-strong p-4 text-sm text-text-3">
          Phase <span className="font-mono">{phase}</span> isn't recognized, so no gate applies.
        </div>
      ) : gate.next === null ? (
        <div className="flex items-center gap-2 text-sm text-ok">
          <IconCheck size={13} />
          Shipped — no gates left.
        </div>
      ) : (
        <GateCard
          gateId={gate.next.id}
          name={gateName(gate.next)}
          description={gate.next.description}
          satisfied={gate.satisfied}
          reason={gate.reason}
        />
      )}
    </section>
  )
}

/**
 * The caption, with the explainer behind an ⓘ (decision 5).
 *
 * "Gates are the human approval points…" used to stand under this caption on
 * every feature, every time — a sentence you need once and then read forever.
 * Help on demand is the text policy the settings and chat flows already locked.
 */
/** The ⓘ itself. No preflight, so it states its own face, size and background. */
const INFO_MARK =
  'grid size-4 shrink-0 cursor-help place-items-center rounded-full border ' +
  'border-hairline-strong bg-transparent p-0 font-sans text-xs leading-none text-text-3 ' +
  'hover:border-text-3 hover:text-text'

/**
 * The sentence it holds. It takes a full row in the caption's normal flow, so
 * opening it moves the gate card down instead of covering what it explains.
 */
const INFO_TIP =
  'pointer-events-none hidden w-[230px] rounded-md border ' +
  'border-hairline-strong bg-panel-3 px-3 py-2 text-sm leading-snug font-normal tracking-normal ' +
  'text-pretty text-text-2 normal-case shadow-menu group-hover/info:block group-focus-within/info:block'

function CurrentGateCaption() {
  return (
    <div className="group/info flex flex-col items-start gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold tracking-[0.09em] text-text-3 uppercase">
          Current gate
        </span>
        <button type="button" className={INFO_MARK} aria-label="What a gate is">
          i
        </button>
      </div>
      <span className={INFO_TIP}>{GATE_EXPLAINER}</span>
    </div>
  )
}

/**
 * One gate, plain name leading. The code is dim mono detail after it (decision
 * 9): "G4" is the pipeline's internal name and says nothing to a newcomer, so it
 * no longer gets to be the headline it used to be.
 */
function GateCard({
  gateId,
  name,
  description,
  satisfied,
  reason,
}: {
  gateId: string
  name: string
  description: string
  satisfied: boolean
  reason: string | undefined
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-hairline bg-panel p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-text">{name}</span>
        <span className="font-mono text-xs text-text-4">{gateId}</span>
      </div>
      <div className="text-sm leading-relaxed text-pretty text-text-2">{description}</div>
      <div className={`flex items-center gap-2 text-sm ${satisfied ? 'text-ok' : 'text-needs'}`}>
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
        <span>{satisfied ? 'Ready to advance' : (reason ?? 'Blocked')}</span>
      </div>
    </div>
  )
}
