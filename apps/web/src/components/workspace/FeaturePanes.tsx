import type { ReactNode } from 'react'
import { Button, DimLine } from '../../ui'
import type { FeatureFull } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { copyText } from './copy-text'

/**
 * The shared face of a feature view that cannot do its job (findings F19): what
 * went wrong in words, and the exact detail line to paste into a bug report.
 * `details` is deliberately one copyable string — the two cases differ in what
 * they know, not in how the user gets it out.
 */
export function BrokenFeaturePane({
  tag,
  details,
  children,
}: {
  tag: string
  details: string
  children: ReactNode
}) {
  const toast = useToast()
  return (
    <>
      <div className="ws-banner is-broken" role="alert">
        <span className="ws-banner-tag">{tag}</span>
        <span>{children}</span>
      </div>
      <div className="ws-body">
        <div className="ws-body-inner">
          <div className="broken-detail">
            <DimLine>{details}</DimLine>
            <Button variant="ghost" size="xs" onClick={() => copyText(details, toast)}>
              Copy details
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * What the feature view shows when it crashed outright — the fallback for the
 * error boundary ProjectShell mounts around it (findings F19). Containment is
 * the point: the sidebar, the other features and every other project keep
 * working, and this pane carries the feature id + the error so the crash is
 * reportable rather than mysterious. No title row: a crash this deep means the
 * feature's own data is not trustworthy enough to render.
 */
export function FeatureCrash({ featureId, error }: { featureId: string; error: Error }) {
  return (
    <section className="workspace">
      <BrokenFeaturePane
        tag="BROKEN"
        details={`feature ${featureId} — ${error.name}: ${error.message}`}
      >
        This feature couldn't be rendered. Everything else still works.
      </BrokenFeaturePane>
    </section>
  )
}

/**
 * The degraded feature view for a phase this build does not recognize (findings
 * F19). Read-only by construction: it offers no pipeline, no next step and no
 * action, because every one of those is derived from a phase we cannot place.
 * What it does offer is the bad value itself and the feature's identity, so the
 * user can report it or fix the row instead of staring at a blank page.
 */
export function UnrecognizedPhase({ feature }: { feature: FeatureFull['feature'] }) {
  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <span className="font-mono text-sm font-semibold lowercase">unknown</span>
          <span className="ws-title">{feature.title}</span>
        </div>
      </div>
      <BrokenFeaturePane
        tag="UNRECOGNIZED"
        details={`feature ${feature.id} (${feature.slug}) has phase "${feature.phase}"`}
      >
        This feature's phase is <strong className="font-mono">{feature.phase}</strong>, which this version
        of runcastle doesn't know. Nothing here can be acted on until the row is fixed.
      </BrokenFeaturePane>
    </section>
  )
}
