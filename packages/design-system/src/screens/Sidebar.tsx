import { Spinner } from '../components/Spinner'
import { StatusDot } from '../components/StatusDot'

type Phase = 'ideation' | 'spec' | 'tickets' | 'implementation' | 'review' | 'shipped'

export interface SidebarFeature {
  /** Feature slug (mono). */
  slug: string
  /** Lifecycle phase — sets the glyph colour. */
  phase: Phase
  /** Show a burning spinner (active run). */
  burning?: boolean
  /** Show a needs-attention dot. */
  needs?: boolean
  /** Dim as shipped. */
  shipped?: boolean
}

export interface SidebarProps {
  /** Feature rows, top to bottom. */
  features?: SidebarFeature[]
  /** slug of the active feature. */
  activeSlug?: string
}

const GLYPH: Record<Phase, string> = {
  ideation: '◆',
  spec: '▤',
  tickets: '☰',
  implementation: '⚙',
  review: '◎',
  shipped: '✓',
}

const DEFAULT_FEATURES: SidebarFeature[] = [
  { slug: 'auth-flow', phase: 'review', needs: true },
  { slug: 'ship-path-bugs', phase: 'implementation', burning: true },
  { slug: 'billing-webhooks', phase: 'tickets' },
  { slug: 'onboarding-tour', phase: 'ideation' },
  { slug: 'dark-mode', phase: 'shipped', shipped: true },
]

/**
 * The features rail: one 28px row per feature — a phase-coloured glyph, the mono
 * slug, and a right-aligned burning spinner or needs-attention dot. A dashed
 * `+ New feature` row sits at the bottom.
 * @category Screens
 */
export function Sidebar({ features = DEFAULT_FEATURES, activeSlug = 'auth-flow' }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="pane-title">Features</div>
      <div className="sidebar-list">
        {features.map((f) => (
          <button
            key={f.slug}
            className={`feature-row${f.slug === activeSlug ? ' is-active' : ''}${f.shipped ? ' is-shipped' : ''}`}
            title={f.slug}
          >
            <span className={`feature-glyph phase-fg-${f.phase}`}>{GLYPH[f.phase]}</span>
            <span className="feature-slug mono">{f.slug}</span>
            <span className="feature-flag">
              {f.burning ? <Spinner title="burning" /> : f.needs ? <StatusDot tone="warn" title="needs attention" /> : null}
            </span>
          </button>
        ))}
      </div>
      <button className="new-feature-row">+ New feature</button>
    </aside>
  )
}
