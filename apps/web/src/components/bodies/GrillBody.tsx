import type { Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import { DimLine, SectionTitle, SessionStatusDot } from '../../ui'
import type { FeatureFull } from '../../lib/api'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The ideation / spec phase body (app-redesign). Embeds the real live Claude
 * Code grill session as an inline terminal (over the /ws PTY stream); in the
 * `spec` phase the written spec doc is rendered above the conversation. When no
 * session is live the panel is a quiet empty state — the next-step bar owns the
 * "start a session" action.
 */
export function GrillBody({ full, effective }: { full: FeatureFull; effective: Phase }) {
  const { feature, sessions, docs } = full
  // Prefer a live/launching session; otherwise the most recent one.
  const ordered = [...sessions].reverse()
  const session = ordered.find((s) => s.status === 'live' || s.status === 'launching') ?? ordered[0]
  const specDoc = docs.find((d) => d.relPath.endsWith('spec.md'))

  return (
    <div className="grill">
      {effective === 'spec' &&
        (specDoc ? (
          <DocPanel featureId={feature.id} relPath={specDoc.relPath} />
        ) : (
          <div className="spec-doc">
            <DimLine>spec not written yet — continue the grill to draft it</DimLine>
          </div>
        ))}

      <div className="body-title" style={{ marginTop: effective === 'spec' ? 18 : 0 }}>
        <SectionTitle>{feature.size === 'collapsed' ? 'Session' : 'Grill session'}</SectionTitle>
        <span className="body-hint">— shape the idea with Claude; promote it when it feels concrete</span>
      </div>

      <div className="grill-panel">
        {session ? (
          <>
            <div className="grill-strip">
              <span className="grill-kind">{session.kind}</span>
              <span className="grill-sid">{session.ccSessionId ?? session.id}</span>
              <SessionStatusDot status={session.status} />
              <span className="grill-strip-spacer" />
            </div>
            <div className="grill-term" id="grill-term">
              {session.status === 'ended' ? (
                <div className="grill-empty">
                  <DimLine>session ended — its decisions live in Knowledge</DimLine>
                </div>
              ) : (
                <ErrorBoundary label="terminal">
                  <TerminalView sessionId={session.id} />
                </ErrorBoundary>
              )}
            </div>
          </>
        ) : (
          <div className="grill-empty">
            <DimLine>no grill session yet</DimLine>
            <span className="body-hint">
              Start a session from the next step to shape the idea with Claude before any code.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline render of a knowledge doc (spec.md) beside the conversation. */
function DocPanel({ featureId, relPath }: { featureId: string; relPath: string }) {
  const q = trpc.docs.read.useQuery({ featureId, relPath })
  return (
    <div className="spec-doc">
      <div className="spec-meta">{relPath}</div>
      {q.isLoading && <DimLine>loading {relPath}…</DimLine>}
      {q.error && <DimLine>could not read {relPath}</DimLine>}
      {q.data && <div className="spec-body">{q.data.content}</div>}
    </div>
  )
}
