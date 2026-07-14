// Pinned interface — see docs/UI-SPEC.md §5/§6. W1 replaces this file with the
// real xterm.js implementation; consumers must not depend on anything beyond
// these props.
export interface TerminalViewProps {
  sessionId: string
  wsBase?: string
}

export function TerminalView({ sessionId }: TerminalViewProps) {
  return (
    <div className="terminal-placeholder" data-session-id={sessionId}>
      <span className="mono dim">terminal backend not yet available…</span>
    </div>
  )
}
