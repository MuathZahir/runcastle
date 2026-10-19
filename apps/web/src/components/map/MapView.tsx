import { IconCube } from '../../icons'
import { EmptyState } from '../../ui'

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
}

/**
 * The map in the content panel (decision 3): the overview, or one group's page.
 * A placeholder until the overview and group pages land in their own ticket.
 */
export function MapView(_props: MapViewProps) {
  return <EmptyState icon={<IconCube />} title="Map" />
}
