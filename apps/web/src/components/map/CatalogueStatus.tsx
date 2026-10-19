import type { MapModel } from '@runcastle/core'
import { relTimeAgo, shortSha } from '../../lib/format'
import { IconRefresh } from '../../icons'
import { Button, Disclosure, StatusLabel } from '../../ui'

/** Start a build of main's catalogue (Build the catalogue / Rebuild), and whether one is on its way. */
export interface CatalogueBuild {
  onBuild: () => void
  pending: boolean
}

/**
 * Main's catalogue, in one line (decision 5): "Built from main · 2h ago", with
 * "main has moved since" and Rebuild when it is stale, "Building…" while a build
 * runs (beside the previous catalogue, when there is one), and a failure's
 * reason and log behind a disclosure with Rebuild — the last good catalogue
 * kept, or, with none, the failure in the line's place. Never built: one Build
 * the catalogue action. Nothing at all when stories are not set up.
 *
 * Nothing here starts a build on its own; only the buttons do.
 */
export function CatalogueStatus({
  catalogue,
  build,
  withCommit = false,
}: {
  catalogue: MapModel['catalogue']
  build: CatalogueBuild
  /** Name the build's commit too (the group page's UI states heading). */
  withCommit?: boolean
}) {
  if (catalogue.state === 'not_set_up') return null
  const built = catalogue.state === 'built'
  const failure = !catalogue.building ? catalogue.failure : undefined
  const rebuild = (
    <Button size="sm" icon={<IconRefresh />} loading={build.pending} onClick={build.onBuild}>
      Rebuild
    </Button>
  )

  const builtLine = built && (
    <span>
      Built from main
      {catalogue.builtAt !== undefined && ` · ${relTimeAgo(catalogue.builtAt)}`}
      {withCommit && catalogue.commit && (
        <>
          {' · commit '}
          <span className="font-mono">{shortSha(catalogue.commit)}</span>
        </>
      )}
      {catalogue.stale && ' · main has moved since'}
    </span>
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
        {builtLine}
        {catalogue.building && <StatusLabel spinning>Building…</StatusLabel>}
        {!built && !catalogue.building && !failure && (
          <>
            <span>Stories are set up, but main’s catalogue hasn’t been built</span>
            <Button size="sm" variant="primary" loading={build.pending} onClick={build.onBuild}>
              Build the catalogue
            </Button>
          </>
        )}
        {!catalogue.building && (catalogue.stale || failure) && rebuild}
      </div>
      {failure && (
        <Disclosure
          size="sm"
          title={
            <span className="text-danger">
              {built ? 'The latest build of main failed' : 'Main’s catalogue didn’t build'}
            </span>
          }
        >
          {failure.reason && <p className="m-0 mb-1.5">{failure.reason}</p>}
          {failure.log ? (
            <pre className="m-0 max-h-[260px] overflow-auto rounded-md bg-surface-inset px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">
              {failure.log}
            </pre>
          ) : (
            <p className="m-0">No log was recorded.</p>
          )}
        </Disclosure>
      )}
    </div>
  )
}
