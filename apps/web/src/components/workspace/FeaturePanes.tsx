import type { ReactNode } from 'react'
import { Button, Page, PageHeader, PageTopbar } from '../../ui'
import { IconAlert, IconCopy } from '../../icons'
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
    <div className="flex flex-col gap-3 rounded-md bg-danger-subtle px-4 py-3" role="alert">
      <div className="flex items-center gap-2 text-sm font-medium text-danger">
        <IconAlert size={16} className="shrink-0" />
        {tag}
      </div>
      <p className="m-0 text-sm text-text-secondary">{children}</p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-tertiary" title={details}>
          {details}
        </code>
        <Button variant="ghost" size="sm" icon={<IconCopy />} onClick={() => copyText(details, toast)}>
          Copy details
        </Button>
      </div>
    </div>
  )
}

/** The frame both broken panes sit in: the panel's topbar, then a page. */
function BrokenFrame({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <PageTopbar crumbs={[{ label: crumb, icon: <IconAlert /> }]} />
      <Page>{children}</Page>
    </section>
  )
}

/**
 * What the feature view shows when it crashed outright — the fallback for the
 * error boundary ProjectShell mounts around it (findings F19). Containment is
 * the point: the sidebar, the other features and every other project keep
 * working, and this pane carries the feature id + the error so the crash is
 * reportable rather than mysterious. No title: a crash this deep means the
 * feature's own data is not trustworthy enough to render.
 */
export function FeatureCrash({ featureId, error }: { featureId: string; error: Error }) {
  return (
    <BrokenFrame crumb="Feature">
      <BrokenFeaturePane tag="Broken" details={`feature ${featureId} — ${error.name}: ${error.message}`}>
        This feature couldn't be rendered. Everything else still works.
      </BrokenFeaturePane>
    </BrokenFrame>
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
    <BrokenFrame crumb={feature.title}>
      <PageHeader title={feature.title} meta={[{ text: 'Unknown phase' }]} />
      <div className="mt-8">
        <BrokenFeaturePane
          tag="Unrecognized phase"
          details={`feature ${feature.id} (${feature.slug}) has phase "${feature.phase}"`}
        >
          This feature's phase is <strong className="font-mono font-medium text-text">{feature.phase}</strong>,
          which this version of runcastle doesn't know. Nothing here can be acted on until the row is fixed.
        </BrokenFeaturePane>
      </div>
    </BrokenFrame>
  )
}
