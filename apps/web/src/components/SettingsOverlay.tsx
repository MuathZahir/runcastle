import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { globalRows, projectRows, type SettingRow } from '../lib/settings'
import type { SettingsView } from '../lib/api'
import { DimLine } from '../ui'
import { EnableAfkCard } from './EnableAfkCard'

/**
 * The in-app settings overlay (issue #47). A command-palette / doc-peek style
 * overlay over the shell — no router, no tabs. Two sections: Global (machine
 * defaults) and This project (per-project overrides), each rendering fields from
 * the `settings.get` value/source/editable contract. Env-locked fields read-only
 * with the variable named; serverPort flags restart-required; git-detected
 * mainBranch read-only. Edits persist via `settings.update` and the query
 * invalidates so the new value shows immediately.
 */
export function SettingsOverlay({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const globals = trpc.settings.get.useQuery()
  const scoped = trpc.settings.get.useQuery({ projectId })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="peek-backdrop" onClick={onClose}>
      <div
        className="peek settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="peek-head">
          <span className="settings-title">Settings</span>
          <button className="peek-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="peek-body settings-body">
          <Section
            title="Global"
            hint="Machine-wide defaults for every project."
            query={globals}
            rowsOf={globalRows}
          />
          <Section
            title="This project"
            hint="Overrides that apply only to the current project."
            query={scoped}
            rowsOf={projectRows}
            projectId={projectId}
          />
          <section className="settings-section">
            <div className="settings-section-head">
              <h3 className="settings-section-title">AFK burns</h3>
              <span className="settings-section-hint">
                Prerequisites for unattended sandbox runs.
              </span>
            </div>
            <EnableAfkCard />
          </section>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  query,
  rowsOf,
  projectId,
}: {
  title: string
  hint: string
  query: ReturnType<typeof trpc.settings.get.useQuery>
  rowsOf: (view: SettingsView) => SettingRow[]
  /** Present → writes target this project's overrides; absent → the global store. */
  projectId?: string
}) {
  const rows = query.data ? rowsOf(query.data) : []
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h3 className="settings-section-title">{title}</h3>
        <span className="settings-section-hint">{hint}</span>
      </div>
      {query.isLoading && <DimLine>loading…</DimLine>}
      {query.error && <DimLine>could not load settings: {query.error.message}</DimLine>}
      {query.data && rows.length === 0 && <DimLine>no settings in this scope</DimLine>}
      {rows.map((row) => (
        <Field key={row.key} row={row} projectId={projectId} />
      ))}
    </section>
  )
}

function Field({ row, projectId }: { row: SettingRow; projectId?: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [draft, setDraft] = useState(row.value)

  // Keep the draft in sync when a refetch changes the resolved value.
  useEffect(() => setDraft(row.value), [row.value])

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate()
    },
    onError: (e) => {
      setDraft(row.value)
      toast.push(e.message)
    },
  })

  const save = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === row.value.trim()) return
    const value = row.control === 'number' ? Number(trimmed) : trimmed
    update.mutate({ ...(projectId ? { projectId } : {}), key: row.key, value })
  }

  const clear = () =>
    projectId && update.mutate({ projectId, key: row.key, value: null })

  const controlId = `set-${row.key}`
  return (
    <div className={`settings-field${row.readOnly ? ' is-locked' : ''}`}>
      <label className="settings-field-head" htmlFor={controlId}>
        <span className="settings-field-label">{row.label}</span>
        {row.restartRequired && (
          <span className="settings-badge is-warn" title="Takes effect after a server restart">
            restart required
          </span>
        )}
        {row.overridden && <span className="settings-badge is-override">overridden</span>}
        {update.isPending && <span className="settings-saving">saving…</span>}
      </label>
      {row.help && <div className="settings-field-help">{row.help}</div>}

      {row.readOnly ? (
        <div className="settings-readonly mono" id={controlId}>
          {row.value || '—'}
        </div>
      ) : row.control === 'select' ? (
        <select
          id={controlId}
          className="settings-input"
          value={draft}
          disabled={update.isPending}
          onChange={(e) => {
            setDraft(e.target.value)
            save(e.target.value)
          }}
        >
          {row.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={controlId}
          className="settings-input mono"
          type={row.control === 'number' ? 'number' : 'text'}
          value={draft}
          disabled={update.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(row.value)
              e.currentTarget.blur()
            }
          }}
        />
      )}

      {row.note && <div className="settings-field-note">{row.note}</div>}
      {row.overridden && projectId && (
        <button className="settings-clear" onClick={clear} disabled={update.isPending}>
          Clear override
        </button>
      )}
    </div>
  )
}
