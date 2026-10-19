import { useState } from 'react'
import type { MapGroup, MapModel, MapPage } from '@runcastle/core'
import { mapSteps, mapTally } from '../../lib/map'
import { IconPlay, IconSend } from '../../icons'
import { Button, List, ListRow, PageHeader, PageSection } from '../../ui'
import { StoryFrame, StoryLargerDialog, type LargerStory } from '../review/StoryFrame'
import { CatalogueStatus, type CatalogueBuild } from './CatalogueStatus'
import { HistoryEarlier, HistoryLatest, type OpenFeature } from './HistoryLine'
import type { MapDriveIntent } from './MapView'

/**
 * One place's page (the map shows every page and its states, decision 6): its
 * UI states, then each child place as a section in map order, then Ways in and
 * Calls — each left out when the place has none of it. Every state is a
 * picture of the whole page, one per row in flow order, loading as it scrolls
 * into view; a click opens it larger. Every entry carries its history line.
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

  return (
    <>
      <PageHeader title={group.name} />
      <div className="mt-8">
        {showUiStates && (
          <PageSection title="UI states">
            <CatalogueStatus catalogue={model.catalogue} build={build} withCommit />
            <PageBlocks group={group} onOpen={setLarger} onOpenFeature={onOpenFeature} />
          </PageSection>
        )}
        {children.map((child) => (
          <PageSection
            key={child.id}
            title={child.name}
            action={
              <Button size="sm" variant="ghost" onClick={() => onOpenGroup(child.id)}>
                Open
              </Button>
            }
          >
            {child.pages.length > 0 ? (
              <PageBlocks group={child} onOpen={setLarger} onOpenFeature={onOpenFeature} />
            ) : (
              <p className="m-0 text-sm text-text-tertiary">{mapTally(child)}</p>
            )}
          </PageSection>
        ))}
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
      </div>
      <StoryLargerDialog story={larger} onClose={() => setLarger(null)} />
    </>
  )
}

/** A place's pages, one after another. */
function PageBlocks({
  group,
  onOpen,
  onOpenFeature,
}: {
  group: MapGroup
  onOpen: (story: LargerStory) => void
  onOpenFeature?: OpenFeature
}) {
  return (
    <div className="mt-4 flex flex-col gap-10">
      {group.pages.map((p) => (
        <PageBlock key={p.importPath} place={group.name} page={p} onOpen={onOpen} onOpenFeature={onOpenFeature} />
      ))}
    </div>
  )
}

/**
 * A page (one story file): its stories' history line, a strip of step chips
 * that jump to each step, then every state as a picture of the whole page,
 * one per row, a step's variants right after it.
 */
function PageBlock({
  place,
  page,
  onOpen,
  onOpenFeature,
}: {
  place: string
  page: MapPage
  onOpen: (story: LargerStory) => void
  onOpenFeature?: OpenFeature
}) {
  const steps = mapSteps(page.states)
  const numbered = steps.filter((s) => s.step !== null)
  return (
    <article className="flex flex-col gap-4">
      {page.history.length > 0 && (
        <div className="flex flex-col gap-1">
          <HistoryLatest history={page.history} kind="stories" onOpenFeature={onOpenFeature} />
          <HistoryEarlier history={page.history} kind="stories" onOpenFeature={onOpenFeature} />
        </div>
      )}
      {numbered.length > 1 && (
        <nav aria-label="Steps" className="flex flex-wrap gap-1.5">
          {numbered.map(({ states: [first] }) =>
            first ? (
              <Button key={first.id} size="sm" onClick={() => scrollToStep(first.id)}>
                {first.name}
              </Button>
            ) : null,
          )}
        </nav>
      )}
      {steps.map(({ states }) => (
        <div key={states[0]?.id} id={stepAnchor(states[0]?.id ?? '')} className="flex scroll-mt-4 flex-col gap-6">
          {states.map((state) => {
            const title = `${place} · ${state.name}`
            return (
              <figure key={state.id} className="m-0 flex flex-col gap-2">
                <figcaption className="text-sm font-medium text-text">{state.name}</figcaption>
                <StoryFrame
                  page
                  frameTitle={title}
                  url={state.frameUrl}
                  onOpen={() => onOpen({ title, url: state.frameUrl, page: true })}
                />
              </figure>
            )
          })}
        </div>
      ))}
    </article>
  )
}

const stepAnchor = (stateId: string): string => `map-step-${stateId}`

function scrollToStep(stateId: string): void {
  document.getElementById(stepAnchor(stateId))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
