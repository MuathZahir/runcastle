import type { UnrunnableGateFigure } from '../../lib/feature-ui/run'
import { StatusLabel } from '../../ui'
import { IconAlert } from '../../icons'

/**
 * Persistent run-level account of verification the sandbox could not execute:
 * one warning line saying what it means, then a quiet row per command — the
 * command in mono, the exact error beneath it. No tinted box: the glyph and the
 * word carry the warning.
 */
export function UnrunnableGates({ gates }: { gates: readonly UnrunnableGateFigure[] }) {
  if (gates.length === 0) return null
  return (
    <section className="mb-6 flex flex-col gap-2" role="alert">
      <div className="flex flex-col gap-0.5">
        <StatusLabel tone="warning" icon={<IconAlert />} size="sm" strong>
          Verification unavailable
        </StatusLabel>
        <p className="m-0 pl-5.5 text-sm text-text-secondary">
          The sandbox lacked a command or runtime. Ticket results were kept; these gates still need
          checking.
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col p-0 pl-5.5">
        {gates.map((gate) => (
          <li key={gate.command} className="flex flex-col gap-0.5 border-t border-border-subtle py-2 first:border-t-0">
            <code className="font-mono text-xs text-text">{gate.command}</code>
            <span className="font-mono text-xs break-words text-text-tertiary">{gate.error}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
