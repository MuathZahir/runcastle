import type { ScenarioEntry } from '@runcastle/core'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../../ui/dropdown-menu'
import type { ScenarioMenu } from '../../lib/feature-ui/scenarios'

/**
 * The scenario list as menu rows — one list for the Test drive picker and the
 * running drive's Scenario menu (drive-scenarios decision 7): "This feature",
 * then the others by group, then Blank app. `onPick(null)` is Blank app.
 */
export function ScenarioMenuItems({
  menu,
  onPick,
}: {
  menu: ScenarioMenu
  onPick: (file: string | null) => void
}) {
  return (
    <>
      {menu.own.length > 0 && (
        <>
          <DropdownMenuLabel>This feature</DropdownMenuLabel>
          {menu.own.map((s) => (
            <ScenarioItem key={s.file} scenario={s} onPick={onPick} />
          ))}
        </>
      )}
      {menu.others.length > 0 && (
        <>
          {menu.own.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel>{menu.othersLabel}</DropdownMenuLabel>
          {menu.others.map((s) => (
            <ScenarioItem key={s.file} scenario={s} onPick={onPick} />
          ))}
        </>
      )}
      {(menu.own.length > 0 || menu.others.length > 0) && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={() => onPick(null)}>Blank app</DropdownMenuItem>
    </>
  )
}

function ScenarioItem({ scenario, onPick }: { scenario: ScenarioEntry; onPick: (file: string) => void }) {
  return (
    <DropdownMenuItem title={scenario.file} onSelect={() => onPick(scenario.file)}>
      <span className="min-w-0 flex-1 truncate">{scenario.name}</span>
      {scenario.group && <span className="ml-auto text-xs text-text-tertiary">{scenario.group}</span>}
    </DropdownMenuItem>
  )
}
