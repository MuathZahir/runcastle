import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { trpc } from '../../trpc'
import {
  filterSettings,
  pageRows,
  rowSearchTerms,
  type SearchableSetting,
  type SettingsLocation,
  type SettingsPage,
} from '../../lib/settings'
import type { SettingsView } from '../../lib/api'
import { Dialog } from '../../ui'
import { IconX } from '../../icons'
import { SETTINGS_PAGES, SettingsRail } from './SettingsRail'
import { GeneralPage } from './GeneralPage'
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
  general: 'Machine-wide.',
  models: 'Machine-wide — the roster, the default, and which model runs each step.',
  burns: 'Machine-wide — unattended runs.',
  project: 'Global values show as ghost text.',
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
        className="grid h-[min(700px,80vh)] grid-cols-[184px_1fr]"
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
        {/* `minmax(0,1fr)` on the body row, so the body scrolls rather than
            stretching the dialog past its own height. */}
        <section className="grid min-w-0 grid-rows-[48px_minmax(0,1fr)]">
          <header className="flex min-w-0 items-center gap-2.5 border-b border-hairline pr-3 pl-5.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className="truncate text-sm text-text-3">{PAGE_SUBTITLE[page]}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close (Esc)"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-panel-3 hover:text-text"
            >
              <IconX size={14} />
            </button>
          </header>
          <div className="min-h-0 overflow-x-hidden overflow-y-auto px-5.5 pt-4.5 pb-7">
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
            {nothingMatches && (
              <p className="py-10 text-center text-sm text-text-3">
                Nothing matches. Try “model”, “verify” or “image”.
              </p>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  )
}

/**
 * Everything the filter box searches, from every page at once — so the rail can
 * count hits on pages that are not on screen. Rows are all a page contributes
 * today; the roster and the per-step table add their own as those pages land.
 */
function searchableSettings(
  globals: SettingsView | undefined,
  scoped: SettingsView | undefined,
): SearchableSetting[] {
  return SETTINGS_PAGES.flatMap(({ page }) => {
    const view = page === 'project' ? scoped : globals
    if (!view) return []
    return pageRows(view, page).map((row) => ({
      id: row.key,
      page,
      terms: rowSearchTerms(row),
    }))
  })
}
