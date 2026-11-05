import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { LogoMark, PhaseIcon, type PhaseIconPhase } from '../src/icons'
import build from '../../../site/assets/screens/build.png'

/**
 * The README's banner (site/assets/readme-banner.png): the pitch, the four
 * stages a feature passes through, and the build screenshot under them. Laid
 * out at 1280×802; capture it at 2× (2560×1604) after retaking the
 * screenshots, so the picture inside follows the app's colours. Before this
 * page the banner had no source and was redrawn by hand each time.
 */

const STAGES: { label: string; phase: PhaseIconPhase; fill: string }[] = [
  { label: 'Planning', phase: 'spec', fill: 'var(--color-phase-spec)' },
  { label: 'Build', phase: 'implementation', fill: 'var(--color-phase-implementation)' },
  { label: 'Review', phase: 'review', fill: 'var(--color-phase-review)' },
  { label: 'Shipped', phase: 'shipped', fill: 'var(--color-phase-shipped)' },
]

/** The sidebar head's halftone, larger: dots shrinking away from the top right. */
const HALFTONE =
  'radial-gradient(circle, color-mix(in oklab, var(--color-text) 14%, transparent) 1.1px, transparent 1.4px) 0 0 / 12px 12px'

function Banner() {
  return (
    <div className="relative overflow-hidden bg-canvas font-sans text-text" style={{ width: 1280, height: 802 }}>
      <style>{'.stage-icon > svg { color: var(--color-on-primary) }'}</style>
      <div
        aria-hidden
        className="absolute top-0 right-0"
        style={{
          width: 640,
          height: 420,
          background: HALFTONE,
          maskImage: 'radial-gradient(ellipse at top right, black, transparent 70%)',
        }}
      />
      <div className="absolute flex items-center gap-4" style={{ left: 64, top: 54 }}>
        <LogoMark size={26} variant="solid" />
        <span style={{ fontSize: 25, letterSpacing: '-0.01em' }}>runcastle</span>
      </div>
      <h1
        className="absolute m-0 font-semibold"
        style={{ left: 60, top: 118, fontSize: 70, lineHeight: '72px', letterSpacing: '-0.045em' }}
      >
        Stop babysitting
        <br />
        your coding agents.
      </h1>
      <p
        className="absolute m-0 text-text-secondary"
        style={{ left: 64, top: 282, width: 720, fontSize: 21, lineHeight: '29px' }}
      >
        Talk an idea through once, get back a branch to test drive. Claude Code or Codex builds it unattended.
      </p>
      {STAGES.map((s, i) => (
        <div
          key={s.label}
          className="absolute flex flex-col justify-between rounded-t-md text-on-primary"
          style={{ left: 64 + i * 318.5, top: 396, width: 196, height: 76, padding: '12px 14px 10px', background: s.fill }}
        >
          {/* The icon states its own phase hue; the stage-icon rule below outranks it. */}
          <span className="stage-icon flex">
            <PhaseIcon phase={s.phase} size={16} label="" />
          </span>
          <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 500 }}>{s.label}</span>
        </div>
      ))}
      <div
        className="absolute overflow-hidden rounded-t-lg ring-1 ring-border"
        style={{ left: 64, top: 472, width: 1152, height: 330 }}
      >
        <img src={build} alt="" className="block" style={{ width: 1152, height: 720 }} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Banner />
  </StrictMode>,
)
