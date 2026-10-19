import { trpc } from '../../trpc'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { IconCube } from '../../icons'
import { Button, EmptyState, Page, PageTopbar, Skeleton, SkeletonBar, type Crumb } from '../../ui'
import type { CatalogueBuild } from './CatalogueStatus'
import type { OpenFeature } from './HistoryLine'
import { MapGroupPage } from './MapGroupPage'
import { MapOverview } from './MapOverview'

/**
 * Where a map entry's Open in drive / Try it lands in the project drive
 * (decision 8): which scenario, which side of the drive view, and — for Try
 * it — which call to select.
 */
export interface MapDriveIntent {
  scenario: string
  side: 'app' | 'api'
  call?: string
}

export interface MapViewProps {
  projectId: string
  /** The open group's id, or null for the overview. */
  group: string | null
  onOpenGroup: (group: string | null) => void
  onOpenDrive: (intent: MapDriveIntent) => void
  /** A history credit's feature title: open that feature's page. */
  onOpenFeature?: OpenFeature
  /** Set up stories: the preparation workspace, where the stories set-up runs. */
  onOpenPreparation?: () => void
  /** New scenario: the scenario chat on the project drive. */
  onNewScenario?: () => void
}

/**
 * The map in the content panel (decision 3): the overview, or one group's page.
 * Reading it never starts a build; only Build the catalogue and Rebuild do.
 */
export function MapView({
  projectId,
  group,
  onOpenGroup,
  onOpenDrive,
  onOpenFeature,
  onOpenPreparation,
  onNewScenario,
}: MapViewProps) {
  const mapQ = trpc.project.map.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const build = useBuildMapCatalogue(projectId)
  const model = mapQ.data
  const open = model && group !== null ? model.groups.find((g) => g.id === group) : undefined
  const parent = open?.parentId ? model?.groups.find((g) => g.id === open.parentId) : undefined

  const crumbs: Crumb[] = [
    { label: 'Map', icon: <IconCube />, ...(group !== null ? { onClick: () => onOpenGroup(null) } : {}) },
    ...(parent ? [{ label: parent.name, onClick: () => onOpenGroup(parent.id) }] : []),
    ...(open ? [{ label: open.name }] : []),
  ]

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PageTopbar crumbs={crumbs} />
      <Page width="wide" routeKey={`map-${projectId}-${group ?? ''}`}>
        {!model ? (
          <MapSkeleton />
        ) : group === null ? (
          <MapOverview
            model={model}
            build={build}
            doors={{
              ...(onOpenPreparation ? { onSetUpStories: onOpenPreparation } : {}),
              ...(onNewScenario ? { onNewScenario } : {}),
            }}
            onOpenGroup={onOpenGroup}
          />
        ) : open ? (
          <MapGroupPage
            model={model}
            group={open}
            build={build}
            onOpenGroup={onOpenGroup}
            onOpenDrive={onOpenDrive}
            onOpenFeature={onOpenFeature}
          />
        ) : (
          <EmptyState
            icon={<IconCube />}
            title="This group isn’t on the map"
            hint="Its stories or scenarios may have been renamed or removed on main."
            action={<Button onClick={() => onOpenGroup(null)}>Back to the overview</Button>}
          />
        )}
      </Page>
    </section>
  )
}

/**
 * Build the catalogue / Rebuild: a build of main's catalogue. The server
 * answers a request while one is running with that one, and emits as it goes,
 * so the map refetches through the live stream.
 */
function useBuildMapCatalogue(projectId: string): CatalogueBuild {
  const utils = trpc.useUtils()
  const toast = useToast()
  const mutation = buildMapCatalogue().useMutation({
    onSuccess: () => void utils.project.map.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  return { onBuild: () => mutation.mutate({ projectId }), pending: mutation.isPending }
}

/**
 * `project.buildMapCatalogue` lands with the main-catalogue ticket, built in
 * parallel with this one; until both are on the integration branch it is
 * reached through this one typed seam. Drop the cast once the router has it.
 */
interface BuildMapCatalogueProcedure {
  useMutation: (opts: { onSuccess: () => void; onError: (e: { message: string }) => void }) => {
    mutate: (input: { projectId: string }) => void
    isPending: boolean
  }
}
function buildMapCatalogue(): BuildMapCatalogueProcedure {
  return (trpc.project as unknown as { buildMapCatalogue: BuildMapCatalogueProcedure }).buildMapCatalogue
}

function MapSkeleton() {
  return (
    <Skeleton label="Loading the map" className="flex flex-col gap-3">
      <SkeletonBar className="h-7 w-40" />
      <SkeletonBar className="h-4 w-56" />
      <SkeletonBar className="mt-4 h-10 w-full" />
      <SkeletonBar className="h-10 w-full" />
    </Skeleton>
  )
}
