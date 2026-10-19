import type { MapGroup, MapModel } from '@runcastle/core'
import { mapGap, mapTally } from '../../lib/map'
import { IconCube, IconPlus, IconShield } from '../../icons'
import { Button, EmptyState, LINK, List, ListRow, PageHeader } from '../../ui'
import { CatalogueStatus, type CatalogueBuild } from './CatalogueStatus'

/** The doors an empty map offers (decision 7): preparation's stories step, and the scenario chat. */
export interface MapDoors {
  onSetUpStories?: () => void
  onNewScenario?: () => void
}

/**
 * The map with no group selected (decision 3): every group with its one-line
 * tally, children indented under their parent, and main's catalogue status.
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
  const gap = mapGap(model)
  if (gap === 'neither') {
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
          <GroupRows groups={model.groups} onOpenGroup={onOpenGroup} />
        </div>
      )}
      {gap === 'no-stories' && (
        <GapLine text="UI states aren’t set up" door="Set up stories" onClick={doors.onSetUpStories} />
      )}
      {gap === 'no-scenarios' && (
        <GapLine text="No ways in yet" door="New scenario" onClick={doors.onNewScenario} />
      )}
    </>
  )
}

/** One row per group with its tally; a child sits indented under its parent. */
export function GroupRows({ groups, onOpenGroup }: { groups: MapGroup[]; onOpenGroup: (group: string) => void }) {
  return (
    <List label="Groups">
      {groups.map((g) => (
        <ListRow
          key={g.id}
          title={g.name}
          meta={mapTally(g)}
          className={g.parentId ? 'ml-6' : undefined}
          onClick={() => onOpenGroup(g.id)}
        />
      ))}
    </List>
  )
}

/** What fills a missing part of the map, said once with its door. */
function GapLine({ text, door, onClick }: { text: string; door: string; onClick: (() => void) | undefined }) {
  return (
    <p className="m-0 mt-4 px-3 text-sm text-text-tertiary">
      {text}
      {onClick && (
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
