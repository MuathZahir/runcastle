import type { ReviewPackage } from '@runcastle/core'
import { IconEye, IconPlay } from '../../icons'
import { cx } from '../../ui'
import { WELL } from '../chat/thread/surfaces'
import { packageBuild, packageHolds, packageShots } from '../../lib/feature-ui/review-package'

/** A picture filling its tile; every thumbnail in a package is this. */
export function PackageFrame({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} className={cx('block aspect-[16/10] w-full bg-surface-inset object-cover object-top', className)} />
}

/** The walkthrough's tile: the pass's first picture when it has one, with the play mark. */
export function PackageVideoFrame({ poster, className }: { poster?: string; className?: string }) {
  return (
    <span className={cx('relative block', className)}>
      {poster ? <PackageFrame src={poster} alt="" /> : <span className="block aspect-[16/10] w-full bg-surface-inset" />}
      <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,black_35%,transparent)]">
        <IconPlay size={18} className="text-white" />
      </span>
    </span>
  )
}

/** How many tiles the card's sheet holds; the last one counts what did not fit. */
const SHEET_TILES = 6

/**
 * What a review left, as one attachment in a chat: its verdict, a contact sheet
 * of what is inside, and a line saying what that is. Anywhere on it opens the
 * package's page.
 */
export function ReviewPackageCard({ pack, onOpen }: { pack: ReviewPackage; onOpen: () => void }) {
  const shots = packageShots(pack)
  const room = pack.hasWalkthrough ? SHEET_TILES - 1 : SHEET_TILES
  const hidden = Math.max(0, shots.length - room)
  const build = packageBuild(pack)
  return (
    <button
      type="button"
      aria-label="Open the review package"
      onClick={onOpen}
      className={cx(
        WELL,
        'flex w-full max-w-[520px] min-w-0 cursor-pointer flex-col gap-2.5 p-3 text-left transition-colors duration-(--dur-1) hover:bg-surface-hover',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <IconEye size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-md font-medium text-text">Review package</span>
        {build && <span className="shrink-0 text-xs text-text-tertiary">{build}</span>}
      </span>
      <span className="text-sm text-text-secondary">{pack.verdict}</span>
      {(shots.length > 0 || pack.hasWalkthrough) && (
        <span className="grid grid-cols-3 gap-1 overflow-hidden rounded-md">
          {pack.hasWalkthrough && <PackageVideoFrame poster={shots[0]?.src} />}
          {shots.slice(0, room).map((shot, i) => (
            <span key={shot.id} className="relative block">
              <PackageFrame src={shot.src} alt={shot.caption} />
              {hidden > 0 && i === room - 1 && (
                <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,black_55%,transparent)] text-sm font-medium text-white">
                  +{hidden}
                </span>
              )}
            </span>
          ))}
        </span>
      )}
      <span className="text-xs text-text-tertiary">{packageHolds(pack) || pack.empty}</span>
    </button>
  )
}
