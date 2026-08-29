import type { QueryResult, SettingsView } from '../../lib/api'
import type { SettingsFilter } from '../../lib/settings'

/**
 * What every settings page is handed, so the four of them stay interchangeable
 * to the shell and a page is only ever a view over `settings.get`.
 */
export interface SettingsPageProps {
  /** The machine-wide view — General, Models and Burns read this one. */
  globals: QueryResult<SettingsView>
  /** The project-scoped view — "This project" reads this one. */
  scoped: QueryResult<SettingsView>
  projectId: string
  filter: FilterState
  /** The setting a deep link named: scroll to it and flash it once. */
  highlightField?: string
}

/** The filter box's state: what was typed, and what it left standing. */
export interface FilterState extends SettingsFilter {
  query: string
}

/**
 * Whether a page still shows a given item. An empty query shows everything —
 * including items no page contributed to the filter, so a page that grows a new
 * kind of row cannot accidentally hide it by not being searchable yet.
 */
export function showsSetting(filter: FilterState, id: string): boolean {
  return filter.query.trim() === '' || filter.matches.has(id)
}
