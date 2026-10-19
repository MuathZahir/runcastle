import { useState } from 'react'
import type { MapGroup, MapModel, MapPage } from '@runcastle/core'
import { IconPlay, IconSend } from '../../icons'
import { Button, List, ListRow, PageHeader, PageSection } from '../../ui'
import { StoryFrame, StoryLargerDialog, type LargerStory } from '../review/StoryFrame'
import { CatalogueStatus, type CatalogueBuild } from './CatalogueStatus'
import { HistoryEarlier, HistoryLatest, type OpenFeature } from './HistoryLine'
import { GroupRows } from './MapOverview'
import type { MapDriveIntent } from './MapView'

/**
 * One group's page (decisions 3, 10): UI states, Ways in and Calls in that
 * order, each left out when the group has none of it. Every component shows
 * every state in the review page's frame, loading as it scrolls into view;
 * every entry carries its history line. A group with nothing of its own lists
 * its children instead.
 */
export function MapGroupPage({
  model,
  group,
  build,
  onOpenGroup,
  onOpenDrive,
  onOpenFeature,
}: {
  model: MapModel
  group: MapGroup
  build: CatalogueBuild
  onOpenGroup: (group: string) => void
  onOpenDrive: (intent: MapDriveIntent) => void
  onOpenFeature?: OpenFeature
}) {
  const [larger, setLarger] = useState<LargerStory | null>(null)
  const calls = group.scenarios.filter((s) => s.call)
  // Stories set up but main's catalogue not (yet) good: the section says so,
  // compactly. Not set up at all is the overview's to say, never a group page's.
  const uiStatesPending = model.storiesSetUp && model.catalogue.state !== 'built'
  const showUiStates = group.pages.length > 0 || uiStatesPending
  const children = model.groups.filter((g) => g.parentId === group.id)
  const empty = !showUiStates && group.scenarios.length === 0

  return (
    <>
      <PageHeader title={group.name} />
      <div className="mt-8">
        {showUiStates && (
          <PageSection title="UI states">
            <CatalogueStatus catalogue={model.catalogue} build={build} withCommit />
            <div className="mt-4 flex flex-col gap-8 @container">
              {group.pages.map((p) => (
                <PageBlock
                  key={p.importPath}
                  page={p}
                  onOpen={setLarger}
                  onOpenFeature={onOpenFeature}
                />
              ))}
            </div>
          </PageSection>
        )}
        {group.scenarios.length > 0 && (
          <PageSection title="Ways in">
            <List label="Ways in">
              {group.scenarios.map((s) => (
                <div key={s.file}>
                  <ListRow
                    title={s.name}
                    tooltip={s.file}
                    description={<HistoryLatest history={s.history} onOpenFeature={onOpenFeature} />}
                    control={
                      <Button
                        size="sm"
                        icon={<IconPlay />}
                        onClick={() => onOpenDrive({ scenario: s.file, side: 'app' })}
                      >
                        Open in drive
                      </Button>
                    }
                  />
                  <HistoryEarlier history={s.history} onOpenFeature={onOpenFeature} className="px-3" />
                </div>
              ))}
            </List>
          </PageSection>
        )}
        {calls.length > 0 && (
          <PageSection title="Calls">
            <List label="Calls">
              {calls.map((s) => {
                const call = s.call
                if (!call) return null
                return (
                  <ListRow
                    key={call.file}
                    title={<span className="font-mono">{call.requestLine ?? fileName(call.file)}</span>}
                    tooltip={call.file}
                    description={`beside “${s.name}”`}
                    control={
                      <Button
                        size="sm"
                        icon={<IconSend />}
                        onClick={() => onOpenDrive({ scenario: s.file, side: 'api', call: call.file })}
                      >
                        Try it
                      </Button>
                    }
                  />
                )
              })}
            </List>
          </PageSection>
        )}
        {empty && children.length > 0 && (
          <PageSection title="Groups">
            <GroupRows groups={children} onOpenGroup={onOpenGroup} />
          </PageSection>
        )}
      </div>
      <StoryLargerDialog story={larger} onClose={() => setLarger(null)} />
    </>
  )
}

/** A page (one story file): its name and history line, then every state as a frame. */
function PageBlock({
  page,
  onOpen,
  onOpenFeature,
}: {
  page: MapPage
  onOpen: (story: LargerStory) => void
  onOpenFeature?: OpenFeature
}) {
  return (
    <article className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h3 className="m-0 min-w-0 truncate text-sm font-medium text-text" title={page.importPath}>
          {pageName(page)}
        </h3>
        <HistoryLatest history={page.history} onOpenFeature={onOpenFeature} />
      </div>
      <HistoryEarlier history={page.history} onOpenFeature={onOpenFeature} />
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {page.states.map((state) => {
          const title = `${pageName(page)} · ${state.name}`
          return (
            <StoryFrame
              key={state.id}
              label={state.name}
              frameTitle={title}
              url={state.frameUrl}
              deferred
              onOpen={() => onOpen({ title, url: state.frameUrl })}
            />
          )
        })}
      </div>
    </article>
  )
}

/** A page's story file name without its extensions (`Review.stories.tsx` → `Review`). */
function pageName(page: MapPage): string {
  return fileName(page.importPath).split('.')[0] ?? page.importPath
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
