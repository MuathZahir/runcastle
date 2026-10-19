import type { MapGroup, MapModel } from '@runcastle/core'
import { mapGaps, mapTally } from '../../lib/map'
import { IconCube, IconPlus, IconShield } from '../../icons'
import { Button, EmptyState, LINK, List, ListRow, PageHeader, cx } from '../../ui'
import { StoryFrame } from '../review/StoryFrame'
import { CatalogueStatus, type CatalogueBuild } from './CatalogueStatus'

/** The doors an empty map offers (decision 7): preparation's stories step, and the scenario chat. */
export interface MapDoors {
  onSetUpStories?: () => void
  onNewScenario?: () => void
}

/**
 * The map with no group selected (decision 3): the tree of places, each with
 * a picture and its tally, and main's catalogue status.
 * What is missing is said once, quietly, with the door that fills it — and a
 * map with neither stories nor scenarios is one empty state with both doors.
 */
export function MapOverview({
  model,
  build,
  doors,
  onOpenGroup,
}: {
  model: MapModel
  build: CatalogueBuild
  doors: MapDoors
  onOpenGroup: (group: string) => void
}) {
  const gaps = mapGaps(model)
  if (gaps.includes('neither')) {
    return (
      <EmptyState
        icon={<IconCube />}
        title="The map is built from your stories and scenarios"
        hint="Stories show each part of your UI; scenarios are the ways in to drive it."
        action={
          <div className="flex items-center gap-2">
            {doors.onSetUpStories && (
              <Button icon={<IconShield />} onClick={doors.onSetUpStories}>
                Set up stories
              </Button>
            )}
            {doors.onNewScenario && (
              <Button icon={<IconPlus />} onClick={doors.onNewScenario}>
                New scenario
              </Button>
            )}
          </div>
        }
      />
    )
  }

  return (
    <>
      <PageHeader title="Overview" meta={<CatalogueStatus catalogue={model.catalogue} build={build} />} />
      {model.groups.length > 0 && (
        <div className="mt-6">
          <PlaceTree groups={model.groups} onOpenGroup={onOpenGroup} />
        </div>
      )}
      {gaps.includes('no-stories') && (
        <GapLine text="UI states aren’t set up" door="Set up stories" onClick={doors.onSetUpStories} />
      )}
      {gaps.includes('no-pages') && <GapLine text="No pages on the map yet" />}
      {gaps.includes('no-scenarios') && (
        <GapLine text="No ways in yet" door="New scenario" onClick={doors.onNewScenario} />
      )}
    </>
  )
}

/**
 * The app's structure (the map shows every page and its states, decision 7):
 * every place in model order, a child indented under its parent, each with a
 * small picture of its first state and its tally. A place opens from either.
 */
function PlaceTree({ groups, onOpenGroup }: { groups: MapGroup[]; onOpenGroup: (group: string) => void }) {
  return (
    <List label="Places" className="gap-2">
      {groups.map((g) => {
        const first = g.pages[0]?.states[0]
        return (
          <div key={g.id} className={cx('flex items-center gap-3', g.parentId && 'ml-7')}>
            <div className={cx('shrink-0', g.parentId ? 'w-24' : 'w-30')}>
              {first ? (
                <StoryFrame
                  page
                  frameTitle={`${g.name} · ${first.name}`}
                  url={first.frameUrl}
                  openLabel={`Open ${g.name}`}
                  onOpen={() => onOpenGroup(g.id)}
                />
              ) : (
                <div aria-hidden className="aspect-[16/10] w-full rounded-md border border-border-subtle" />
              )}
            </div>
            <ListRow title={g.name} meta={mapTally(g)} className="flex-1" onClick={() => onOpenGroup(g.id)} />
          </div>
        )
      })}
    </List>
  )
}

/** What fills a missing part of the map, said once with its door. */
function GapLine({ text, door, onClick }: { text: string; door?: string; onClick?: () => void }) {
  return (
    <p className="m-0 mt-4 px-3 text-sm text-text-tertiary">
      {text}
      {door && onClick && (
        <>
          {' · '}
          <button type="button" className={LINK} onClick={onClick}>
            {door}
          </button>
        </>
      )}
    </p>
  )
}
