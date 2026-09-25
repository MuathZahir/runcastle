import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { trpc } from '../../trpc'
import { BURN_PREREQUISITES } from '../../lib/afk-rows'
import {
  filterSettings,
  pageSearchItems,
  type SearchableSetting,
  type SettingsLocation,
  type SettingsPage,
} from '../../lib/settings'
import type { SettingsView } from '../../lib/api'
import { Dialog, EmptyState, IconButton } from '../../ui'
import { IconSearch, IconX } from '../../icons'
import { SETTINGS_PAGES, SettingsRail } from './SettingsRail'
import { GeneralPage, THEME_FIELD } from './GeneralPage'
import { ModelsPage } from './ModelsPage'
import { BurnsPage } from './BurnsPage'
import { ProjectPage } from './ProjectPage'
import type { FilterState, SettingsPageProps } from './types'

/**
 * Settings (flow-redesign-settings). One `xl` dialog: a rail of four task pages
 * with a filter above it, and one scrolling page beside it.
 *
 * It stays a dialog rather than becoming a route (decision 10) because settings
 * is opened from the middle of work — Esc and the backdrop hand back whatever
 * was underneath. `location` is where the opener wants to land, so an error
 * message that says "Settings → Burns (Rebuild image)" can be a link onto that
 * row instead of an instruction to go looking.
 */

/** What the header says over each page, under the page's own name. */
const PAGE_SUBTITLE: Record<SettingsPage, string> = {
  general: 'How runcastle looks, where its server listens, and how sessions are sandboxed.',
  models: 'The default model, the roster this machine offers, and which model runs each step.',
  burns: 'What an unattended run needs before it starts, and how hard it tries once it does.',
  project: 'Values this project sets for itself. Unset fields inherit the global value, shown as ghost text.',
}

const PAGE_BODY: Record<SettingsPage, (props: SettingsPageProps) => ReactNode> = {
  general: GeneralPage,
  models: ModelsPage,
  burns: BurnsPage,
  project: ProjectPage,
}

export function SettingsDialog({
  projectId,
  projectName,
  location,
  onClose,
}: {
  projectId: string
  projectName: string
  /** Where the opener wants to land: a page, and optionally a field on it. */
  location: SettingsLocation
  onClose: () => void
}) {
  const globals = trpc.settings.get.useQuery()
  const scoped = trpc.settings.get.useQuery({ projectId })
  const [page, setPage] = useState<SettingsPage>(location.page)
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)

  const found = useMemo(
    () => filterSettings(query, searchableSettings(globals.data, scoped.data)),
    [query, globals.data, scoped.data],
  )
  const filter: FilterState = { query, ...found }
  const filtering = query.trim() !== ''

  // A filter that empties the page you are standing on moves you to one with
  // hits — otherwise typing a word that matches makes the dialog look empty.
  useEffect(() => {
    if (!filtering || found.counts[page] > 0) return
    const first = SETTINGS_PAGES.find((p) => found.counts[p.page] > 0)
    if (first) setPage(first.page)
  }, [filtering, found, page])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return
    e.preventDefault()
    filterRef.current?.focus()
    filterRef.current?.select()
  }

  const Page = PAGE_BODY[page]
  const title = SETTINGS_PAGES.find((p) => p.page === page)?.label ?? ''
  const nothingMatches = filtering && found.matches.size === 0

  return (
    <Dialog open onClose={onClose} size="xl" label="Settings" className="overflow-hidden">
      <div
        className="relative grid h-[min(720px,84vh)] grid-cols-[208px_minmax(0,1fr)]"
        onKeyDown={onKeyDown}
      >
        <SettingsRail
          page={page}
          filter={filter}
          filterRef={filterRef}
          projectName={projectName}
          onFilter={setQuery}
          onSelect={setPage}
        />
        {/* Both halves of one chain, and neither works without the other: the
            body is the one scroller, and `min-h-0` here because a grid item's
            automatic minimum size is its content — without it this section's
            minimum is the whole page's height, the body is handed exactly the
            height it asked for and so never scrolls, and the panel's
            `overflow-hidden` cuts off the rest. */}
        <section className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] bg-surface">
          <div className="min-h-0 overflow-x-hidden overflow-y-auto px-8 pt-9 pb-12">
            {/* Keyed on the page, so switching pages cross-fades and rises once
                — never on a refetch or a keystroke in the filter. */}
            <div key={page} className="animate-rise-in">
              <header className="mb-8">
                <h2 className="m-0 text-lg font-semibold text-text">{title}</h2>
                <p className="mt-1 mb-0 text-sm text-text-tertiary">{PAGE_SUBTITLE[page]}</p>
              </header>
              <div>
                <Page
                globals={globals}
                scoped={scoped}
                projectId={projectId}
                filter={filter}
                // Only on the page the link named: nothing else asked to be found.
                {...(page === location.page && location.field
                  ? { highlightField: location.field }
                  : {})}
                />
              </div>
              {nothingMatches && (
                <EmptyState
                  compact
                  icon={<IconSearch />}
                  title="Nothing matches"
                  hint="Try “model”, “verify” or “image”."
                />
              )}
            </div>
          </div>
        </section>
        <IconButton
          label="Close"
          kbd="Esc"
          size="sm"
          icon={<IconX />}
          onClick={onClose}
          className="absolute top-3 right-3"
        />
      </div>
    </Dialog>
  )
}

/**
 * Everything the filter box searches, from every page at once — so the rail can
 * count hits on pages that are not on screen. What a page contributes out of
 * its settings view is the page's own business (`pageSearchItems`): its rows,
 * plus anything else it renders that a reader searches for by name — the
 * roster and the per-step table on Models. The Burns checklist is added here
 * instead: its rows have no setting key behind them and come from the doctor's
 * shape, not from the view.
 */
/** The theme row lives in the browser, not in `settings.get`, so it names itself. */
const THEME_SEARCH: SearchableSetting = {
  id: THEME_FIELD,
  page: 'general',
  terms: ['Theme', 'Appearance', 'Dark', 'Light', 'System'],
}

function searchableSettings(
  globals: SettingsView | undefined,
  scoped: SettingsView | undefined,
): SearchableSetting[] {
  const rows = SETTINGS_PAGES.flatMap(({ page }) => {
    const view = page === 'project' ? scoped : globals
    return view ? pageSearchItems(view, page) : []
  })
  const prerequisites = BURN_PREREQUISITES.map((p) => ({
    id: p.field,
    page: 'burns' as const,
    terms: [p.label, ...p.terms],
  }))
  return [THEME_SEARCH, ...rows, ...prerequisites]
}
