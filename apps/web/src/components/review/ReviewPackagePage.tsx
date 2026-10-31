import { useEffect, useState, type ReactNode } from 'react'
import type { PackageFinding, ReviewPackage } from '@runcastle/core'
import { IconAlert, IconChevronRight, IconEye, IconX } from '../../icons'
import { Dialog, Disclosure, IconButton, cx } from '../../ui'
import { findingsWords, firstStop, packageBuild, packageShots, packageStops, type PackageStop } from '../../lib/feature-ui/review-package'
import { Markdown } from '../Markdown'
import { PackageFrame, PackageVideoFrame } from './ReviewPackageCard'
import { ReviewCallRow } from './ReviewCallRow'

/** One finding, whole: what happened, where, and how to see it again. */
function FindingBlock({ finding }: { finding: PackageFinding }) {
  const defect = finding.kind === 'defect'
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <h4 className={cx('m-0 flex items-start gap-2 text-base font-medium', defect ? 'text-text' : 'text-text-secondary')}>
        <IconAlert size={16} className={cx('mt-0.5 shrink-0', defect ? 'text-warning' : 'text-icon')} />
        <span className="min-w-0">{finding.title}</span>
      </h4>
      <div className="flex min-w-0 flex-col gap-2 pl-6">
        <p className="m-0 text-sm whitespace-pre-wrap text-text-secondary">{finding.detail}</p>
        <dl className="m-0 grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-tertiary">Where</dt>
          <dd className="m-0 min-w-0 break-words text-text-secondary">{finding.location}</dd>
          {finding.reproStep && (
            <>
              <dt className="text-text-tertiary">To see it</dt>
              <dd className="m-0 min-w-0 break-words whitespace-pre-wrap text-text-secondary">{finding.reproStep}</dd>
            </>
          )}
          <dt className="text-text-tertiary">Cites</dt>
          <dd className="m-0 min-w-0 break-words text-text-tertiary">{finding.citation}</dd>
        </dl>
      </div>
    </article>
  )
}

/** Every finding of the pass on one page, defects first. */
function FindingsBody({ findings }: { findings: readonly PackageFinding[] }) {
  const defects = findings.filter((f) => f.kind === 'defect')
  const observations = findings.filter((f) => f.kind === 'observation')
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-[680px] min-w-0 flex-col gap-8 px-5 py-6">
        {[
          { title: 'Defects', list: defects },
          { title: 'Observations', list: observations },
        ].map(
          ({ title, list }) =>
            list.length > 0 && (
              <section key={title} className="flex min-w-0 flex-col gap-5">
                <h3 className="m-0 text-lg font-semibold text-text">{title}</h3>
                {list.map((finding) => (
                  <FindingBlock key={finding.id} finding={finding} />
                ))}
              </section>
            ),
        )}
      </div>
    </div>
  )
}

/** What the stage shows for the stop in front. */
function StageBody({ stop, walkthrough }: { stop: PackageStop; walkthrough: ReactNode }) {
  switch (stop.kind) {
    case 'video':
      return <div className="flex min-h-0 flex-1 flex-col bg-surface-inset p-3">{walkthrough}</div>
    case 'findings':
      return <FindingsBody findings={stop.findings} />
    case 'shot':
      return (
        <div className="min-h-0 flex-1 bg-surface-inset p-3">
          <img src={stop.shot.src} alt={stop.shot.caption} className="block h-full w-full object-contain" />
        </div>
      )
    case 'call':
      return (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <ReviewCallRow call={stop.call} defaultOpen />
        </div>
      )
  }
}

/** A stop's mark in the list: its thumbnail, or what stands in for one. */
function RowMark({ stop, poster }: { stop: PackageStop; poster?: string }) {
  if (stop.kind === 'shot') return <PackageFrame src={stop.shot.src} alt="" />
  if (stop.kind === 'video') return <PackageVideoFrame poster={poster} />
  const tile = 'grid aspect-[16/10] w-full place-items-center bg-surface-inset'
  if (stop.kind === 'findings') {
    const defect = stop.findings.some((f) => f.kind === 'defect')
    return (
      <span className={tile}>
        <IconAlert size={14} className={defect ? 'text-warning' : 'text-icon'} />
      </span>
    )
  }
  return <span className={cx(tile, 'font-mono text-xs text-text-secondary')}>{stop.call.result.ok ? stop.call.result.status : '—'}</span>
}

/** One row of the package's list. */
function StopRow({ stop, poster, active, onPick }: { stop: PackageStop; poster?: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active}
      onClick={onPick}
      className={cx(
        'flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left transition-colors duration-(--dur-1)',
        active ? 'card' : 'hover:bg-surface-hover',
      )}
    >
      <span className="w-14 shrink-0 overflow-hidden rounded-sm">
        <RowMark stop={stop} poster={poster} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx('line-clamp-2 min-w-0 text-xs', active ? 'text-text' : 'text-text-secondary', stop.kind === 'call' && 'font-mono')}>
          {stop.title}
        </span>
        {stop.kind === 'findings' && <span className="text-xs text-text-tertiary">{findingsWords(stop.findings)}</span>}
      </span>
    </button>
  )
}

/** The verdict and the review's own account: all a package has when it holds nothing else. */
function Words({ pack }: { pack: ReviewPackage }) {
  return (
    <>
      <p className="m-0 px-1.5 text-sm text-text">{pack.verdict}</p>
      {pack.empty && <p className="m-0 px-1.5 text-sm text-text-tertiary">{pack.empty}</p>}
    </>
  )
}

function Account({ pack }: { pack: ReviewPackage }) {
  if (!pack.account) return null
  return (
    <Disclosure size="sm" title="The review’s full account" className="px-1.5">
      <Markdown source={pack.account} />
    </Disclosure>
  )
}

/** The page's body: one thing large on the stage, and everything else listed beside it. */
function PackageBody({ pack, walkthrough }: { pack: ReviewPackage; walkthrough: ReactNode }) {
  const stops = packageStops(pack)
  const [id, setId] = useState(firstStop(stops)?.id)
  const at = Math.max(0, stops.findIndex((stop) => stop.id === id))
  const stop = stops[at]
  const step = (by: number) => {
    const target = stops[at + by]
    if (target) setId(target.id)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // A focused video keeps its arrows for seeking.
      if (e.target instanceof HTMLMediaElement) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!stop) {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[680px] min-w-0 flex-col gap-4 px-3.5 py-6">
          <Words pack={pack} />
          <Account pack={pack} />
        </div>
      </div>
    )
  }

  const poster = packageShots(pack)[0]?.src
  const groups: (string | null)[] = []
  for (const s of stops) if (!groups.includes(s.group)) groups.push(s.group)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row md:overflow-hidden">
      <section aria-label="In front" className={cx(stop.kind === 'shot' || stop.kind === 'video' ? 'h-[58dvh]' : '', 'flex shrink-0 flex-col border-b border-border-subtle md:h-auto md:min-w-0 md:flex-1 md:shrink md:border-r md:border-b-0')}>
        <StageBody key={stop.id} stop={stop} walkthrough={walkthrough} />
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-t border-border-subtle py-1 pr-2 pl-5">
          <p className="m-0 min-w-0 flex-1 text-sm text-text-secondary">{stop.title}</p>
          <span className="shrink-0 text-xs text-text-tertiary tabular-nums">
            {at + 1} of {stops.length}
          </span>
          <IconButton label="Previous" size="sm" disabled={at === 0} icon={<IconChevronRight className="rotate-180" />} onClick={() => step(-1)} />
          <IconButton label="Next" size="sm" disabled={at === stops.length - 1} icon={<IconChevronRight />} onClick={() => step(1)} />
        </div>
      </section>
      <aside aria-label="In this package" className="flex min-w-0 shrink-0 flex-col gap-4 p-3 md:w-[320px] md:overflow-auto">
        <Words pack={pack} />
        {groups.map((group) => (
          <div key={group ?? 'first'} className="flex min-w-0 flex-col gap-0.5">
            {group && <h3 className="m-0 px-1.5 pb-1 text-xs font-medium text-text-tertiary">{group}</h3>}
            {stops
              .filter((s) => s.group === group)
              .map((s) => (
                <StopRow key={s.id} stop={s} poster={poster} active={s.id === stop.id} onPick={() => setId(s.id)} />
              ))}
          </div>
        ))}
        {pack.groups
          .filter((group) => group.failure)
          .map((group) => (
            <p key={group.id} className="m-0 flex items-start gap-1.5 px-1.5 text-xs text-danger-text">
              <IconAlert size={12} className="mt-0.5 shrink-0 text-danger" />
              <span className="min-w-0">
                {group.name} did not land: {group.failure}
              </span>
            </p>
          ))}
        <Account pack={pack} />
      </aside>
    </div>
  )
}

/**
 * A review package opened: the full window, so it works from any chat and on a
 * phone. `walkthrough` is what plays when the walkthrough is in front.
 */
export function ReviewPackagePage({ pack, walkthrough, onClose }: { pack: ReviewPackage; walkthrough?: ReactNode; onClose: () => void }) {
  const build = packageBuild(pack)
  const where = [pack.round !== null ? `Round ${pack.round}` : `Ticket #${pack.seq}`, build?.toLowerCase()].filter(Boolean).join(', ')
  return (
    <Dialog open onClose={onClose} labelledBy="package-title" size="full" className="flex h-[88dvh] flex-col overflow-hidden">
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
        <IconEye size={16} className="shrink-0 text-accent" />
        <h2 id="package-title" className="m-0 min-w-0 truncate text-sm font-medium text-text">
          {pack.passKind === 'verification' ? 'Verification package' : 'Review package'}
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">{where}</span>
        <IconButton label="Close" size="sm" icon={<IconX />} onClick={onClose} />
      </div>
      <PackageBody pack={pack} walkthrough={walkthrough} />
    </Dialog>
  )
}
