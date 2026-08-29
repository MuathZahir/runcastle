import type { RefObject } from 'react'
import type { SettingsPage } from '../../lib/settings'
import { IconCube, IconFlame, IconFolder, IconSearch, IconSettings } from '../../icons'
import type { FilterState } from './types'

/**
 * The dialog's left rail: the filter box, the four task pages, and the project
 * the bottom page belongs to.
 *
 * The pages are cut by what someone came to do, not by the config file's
 * global/project split (decision 3) — that split is expressed inside "This
 * project" by a source chip, never by a page.
 */
export const SETTINGS_PAGES: readonly {
  page: SettingsPage
  label: string
  Icon: typeof IconSettings
}[] = [
  { page: 'general', label: 'General', Icon: IconSettings },
  { page: 'models', label: 'Models', Icon: IconCube },
  { page: 'burns', label: 'Burns', Icon: IconFlame },
  { page: 'project', label: 'This project', Icon: IconFolder },
]

export function SettingsRail({
  page,
  filter,
  filterRef,
  projectName,
  onFilter,
  onSelect,
}: {
  page: SettingsPage
  filter: FilterState
  /** Ctrl/Cmd+F inside the dialog puts the caret here. */
  filterRef: RefObject<HTMLInputElement | null>
  projectName: string
  onFilter: (query: string) => void
  onSelect: (page: SettingsPage) => void
}) {
  const filtering = filter.query.trim() !== ''
  return (
    <nav className="flex flex-col gap-1.5 border-r border-hairline bg-panel-2 px-2.5 py-3.5">
      <h2 className="mb-1.5 ml-2 text-xs font-semibold tracking-[0.08em] text-text-3 uppercase">
        Settings
      </h2>
      <div className="relative mb-1.5">
        <IconSearch
          size={12}
          className="pointer-events-none absolute top-2.5 left-2.5 text-text-3"
        />
        <input
          ref={filterRef}
          aria-label="Filter settings"
          placeholder="Filter settings…"
          autoComplete="off"
          value={filter.query}
          onChange={(e) => onFilter(e.target.value)}
          className="h-7.5 w-full rounded-sm border border-hairline bg-panel-inset pr-2 pl-7 text-sm text-text placeholder:text-text-3"
        />
      </div>
      {SETTINGS_PAGES.map(({ page: id, label, Icon }) => {
        const current = id === page
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            {...(current ? { 'aria-current': 'page' as const } : {})}
            className={
              current
                ? 'flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm text-text bg-accent-soft'
                : 'flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm text-text-2 hover:bg-panel-3 hover:text-text'
            }
          >
            <Icon size={14} className={current ? 'shrink-0 text-accent-hi' : 'shrink-0 text-text-3'} />
            {label}
            {/* Only while someone is actually searching — a row of zeroes on a
                rail nobody is filtering is noise. */}
            {filtering && (
              <span className="ml-auto text-xs tabular-nums text-text-3">
                {filter.counts[id] || ''}
              </span>
            )}
          </button>
        )
      })}
      <div className="flex-1" />
      <div className="border-t border-hairline-soft p-2 text-xs text-text-3">
        Open project
        <span className="mt-0.5 block font-mono text-sm text-text-2">{projectName}</span>
      </div>
    </nav>
  )
}
