import type { PackageCall, PackageFinding, PackageShot, ReviewPackage } from '@runcastle/core'

/** One thing a package's page can put on its stage, in the order the arrows step through. */
export type PackageStop =
  | { id: 'video'; kind: 'video'; group: null; title: string }
  | { id: 'findings'; kind: 'findings'; group: null; title: string; findings: PackageFinding[] }
  | { id: string; kind: 'shot'; group: string | null; title: string; shot: PackageShot }
  | { id: string; kind: 'call'; group: string | null; title: string; call: PackageCall }

const count = (n: number, word: string): string | null => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : null)

/** Every picture in the package, in order. */
export function packageShots(pack: ReviewPackage): PackageShot[] {
  return pack.groups.flatMap((group) => group.shots)
}

/** The findings in a few words: `1 defect, 1 observation`. */
export function findingsWords(findings: readonly PackageFinding[]): string {
  return [
    count(findings.filter((f) => f.kind === 'defect').length, 'defect'),
    count(findings.filter((f) => f.kind === 'observation').length, 'observation'),
  ]
    .filter(Boolean)
    .join(', ')
}

/** What the package holds, for the card's last line. */
export function packageHolds(pack: ReviewPackage): string {
  return [
    count(packageShots(pack).length, 'screenshot'),
    pack.hasWalkthrough ? 'walkthrough' : null,
    count(pack.groups.flatMap((group) => group.calls).length, 'call'),
    count(pack.findings.filter((f) => f.kind === 'defect').length, 'defect'),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** How the pass relates to the branch now, or null when that cannot be known. */
export function packageBuild(pack: ReviewPackage): string | null {
  if (pack.commitsSince === null) return null
  if (pack.commitsSince === 0) return 'This build'
  return `${count(pack.commitsSince, 'commit')} behind`
}

/** The page's list, in order: the walkthrough, the findings, then each group. */
export function packageStops(pack: ReviewPackage): PackageStop[] {
  const stops: PackageStop[] = []
  if (pack.hasWalkthrough) stops.push({ id: 'video', kind: 'video', group: null, title: 'Walkthrough' })
  if (pack.findings.length > 0) {
    stops.push({ id: 'findings', kind: 'findings', group: null, title: 'Findings', findings: pack.findings })
  }
  for (const group of pack.groups) {
    for (const shot of group.shots) stops.push({ id: shot.id, kind: 'shot', group: group.name, title: shot.caption, shot })
    for (const call of group.calls) stops.push({ id: call.id, kind: 'call', group: group.name, title: `${call.method} ${call.url}`, call })
  }
  return stops
}

/** What the page opens on: the first picture, since pictures are why it was opened. */
export function firstStop(stops: readonly PackageStop[]): PackageStop | undefined {
  return stops.find((stop) => stop.kind === 'shot') ?? stops[0]
}
