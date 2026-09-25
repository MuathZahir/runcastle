import type { RefObject } from 'react'
import type { SettingsPage } from '../../lib/settings'
import { IconCube, IconFlame, IconFolder, IconSettings } from '../../icons'
import { NavItem, SearchField } from '../../ui'
import type { FilterState } from './types'

/**
 * The dialog's left rail: the filter box, the four task pages, and the project
 * the bottom page belongs to.
 *
 * The pages are cut by what someone came to do, not by the config file's
 * global/project split (decision 3) — that split is expressed inside "This
 * project" by a source label, never by a page.
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
    <nav
      aria-label="Settings pages"
      className="flex min-h-0 flex-col gap-0.5 border-r border-border-subtle bg-canvas px-2 pt-4 pb-3"
    >
      {/* A quiet label, not a heading: the dialog is already named "Settings",
          and the page beside this rail owns the one heading on screen. */}
      <div className="mb-2 px-2.5 text-sm font-medium text-text">Settings</div>
      <SearchField
        ref={filterRef}
        size="md"
        aria-label="Filter settings"
        placeholder="Filter"
        kbd="Ctrl F"
        autoComplete="off"
        value={filter.query}
        onChange={(e) => onFilter(e.target.value)}
        className="mb-3"
      />
      {SETTINGS_PAGES.map(({ page: id, label, Icon }) => (
        <NavItem
          key={id}
          label={label}
          icon={<Icon />}
          active={id === page}
          onClick={() => onSelect(id)}
          // Only while someone is actually searching — a row of zeroes on a
          // rail nobody is filtering is noise.
          meta={filtering ? filter.counts[id] || '' : undefined}
        />
      ))}
      <div className="flex-1" />
      <div className="flex min-w-0 flex-col gap-0.5 px-2.5 pt-3">
        <span className="text-xs text-text-tertiary">This project is</span>
        <span className="truncate font-mono text-xs text-text-secondary" title={projectName}>
          {projectName}
        </span>
      </div>
    </nav>
  )
}
