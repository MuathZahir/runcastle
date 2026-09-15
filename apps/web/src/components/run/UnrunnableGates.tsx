import type { UnrunnableGateFigure } from '../../lib/feature-ui/run'

/** Persistent run-level account of verification the sandbox could not execute. */
export function UnrunnableGates({ gates }: { gates: readonly UnrunnableGateFigure[] }) {
  if (gates.length === 0) return null
  return (
    <section className="mb-4 rounded-lg border border-warn/45 bg-warn/8 px-3 py-2" role="alert">
      <div className="text-sm font-semibold text-warn">Verification unavailable</div>
      <div className="mt-0.5 text-xs text-text-2">
        The sandbox lacked a command or runtime. Ticket results were kept; these gates still need
        checking.
      </div>
      <ul className="mt-2 mb-0 list-none space-y-1 p-0">
        {gates.map((gate) => (
          <li key={gate.command} className="grid gap-0.5 rounded-sm bg-panel-2 px-2 py-1.5">
            <code className="text-xs text-text">{gate.command}</code>
            <span className="font-mono text-xs text-warn">{gate.error}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
