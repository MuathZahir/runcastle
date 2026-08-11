import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import {
  fieldCommit,
  globalRows,
  projectRows,
  stepModelRows,
  unsetStepKeys,
  type SettingRow,
} from '../lib/settings'
import type { QueryResult, SettingsView } from '../lib/api'
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
  // Provenance for the prepared project fields, so each row can say who
  // established its value rather than just "overridden for this project".
  const prep = trpc.project.prep.useQuery({ projectId })
  const findings = prep.data?.findings ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="peek-backdrop"
      // mousedown, not click: a click that STARTS inside the panel and ends on
      // the backdrop (selecting a field value and releasing outside) is not a
      // dismissal — the same guard FormOverlay makes.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="peek settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="peek-head">
          <span className="settings-title">Settings</span>
          <button className="peek-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="peek-body settings-body">
          {/* There is no Save button and there never was — values persist the
              moment a field is left. Nothing said so, which made the whole
              persistence model unknowable (findings F17.7 / F25.4). */}
          <div className="settings-autosave">
            Changes save automatically — there is no Save button. A field commits when you leave it
            (Enter to commit, Escape to revert), and a dropdown the moment you pick.
          </div>
          <Section
            title="Global"
            hint="Machine-wide defaults for every project."
            query={globals}
            rowsOf={globalRows}
          />
          <AdvancedModels query={globals} />
          <Section
            title="This project"
            hint="Overrides that apply only to the current project."
            query={scoped}
            rowsOf={(view) => projectRows(view, findings)}
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
  query: QueryResult<SettingsView>
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
  const [draft, setDraft] = useState(row.value)
  /** Why this field's last commit was refused; cleared by the next one. */
  const [invalid, setInvalid] = useState<string | null>(null)

  // Keep the draft in sync when a refetch changes the resolved value.
  useEffect(() => setDraft(row.value), [row.value])

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      setInvalid(null)
      void utils.settings.get.invalidate()
      // The write re-sourced the finding to `human` and cleared any dry-run
      // stamp on it (decision 6) — the note under this very field says both, so
      // it has to be refetched with the value.
      void utils.project.prep.invalidate()
    },
    onError: (e) => {
      setDraft(row.value)
      // Beside the field, not in a toast: a rejected value is a question about
      // THIS field ("burnCpus cannot be cleared"), and the draft has just
      // snapped back, so a message that floats away leaves no trace of why.
      setInvalid(e.message)
    },
  })

  const save = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === row.value.trim()) return
    const commit = fieldCommit(row.control, raw)
    if ('error' in commit) {
      setInvalid(commit.error)
      return
    }
    setInvalid(null)
    update.mutate({ ...(projectId ? { projectId } : {}), key: row.key, value: commit.value })
  }

  const clear = () =>
    projectId && update.mutate({ projectId, key: row.key, value: null })

  // Scoped, because most keys appear in BOTH sections. Two controls sharing one
  // id made every `htmlFor` resolve to the global one, so the per-project fields
  // had no accessible name at all — an empty a11y tree (findings F17.7).
  const controlId = `set-${projectId ? 'project' : 'global'}-${row.key}`
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
        {row.stale && (
          // Says where, because for a long time it said "re-prepare to refresh
          // it" while offering no way to and nothing on screen mentioning one.
          <span
            className="settings-badge is-warn"
            title="Measured a long time ago — “Re-prepare the project”, at the foot of the features rail, refreshes it"
          >
            stale
          </span>
        )}
        {update.isPending && <span className="settings-saving">saving…</span>}
      </label>
      {row.help && <div className="settings-field-help">{row.help}</div>}

      {row.readOnly ? (
        <div className="settings-readonly mono" id={controlId}>
          {row.value || '—'}
        </div>
      ) : row.control === 'select' && row.allowCustom ? (
        <ModelCombobox
          id={controlId}
          value={row.value}
          options={row.options}
          disabled={update.isPending}
          onCommit={save}
        />
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
          {/* The stored value is a config identifier ("noSandbox", "inherit");
              the dropdown reads out what it means (findings F17.7). */}
          {row.options.map((opt) => (
            <option key={opt} value={opt}>
              {row.optionLabels[opt] ?? opt}
            </option>
          ))}
        </select>
      ) : row.control === 'textarea' ? (
        // Multi-line fields (verify commands, known failures) — an <input>
        // silently drops the newlines that give these values their meaning.
        // Enter inserts a line; blur saves, Escape reverts.
        <textarea
          id={controlId}
          className="settings-input mono settings-textarea"
          rows={4}
          value={draft}
          disabled={update.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(row.value)
              e.currentTarget.blur()
            }
          }}
        />
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

      {invalid && (
        <div className="settings-field-error" role="alert">
          {invalid}
        </div>
      )}
      {row.note && <div className="settings-field-note">{row.note}</div>}
      {/* What preparation actually observed. Shown inline rather than behind a
          tooltip: it is the only thing that distinguishes a measured value from
          a plausible-looking guess, which is the whole question a reader has. */}
      {row.evidence && <div className="settings-field-evidence mono">{row.evidence}</div>}
      {row.overridden && projectId && (
        <button className="settings-clear" onClick={clear} disabled={update.isPending}>
          Clear override
        </button>
      )}
    </div>
  )
}

/** Sentinel option that switches the combobox into free-text mode. */
const CUSTOM = '__custom__'

/**
 * The Default-model dropdown (issue #48): a curated `<select>` plus a "Custom…"
 * choice that reveals a free-text field for any model id not in the list. Any
 * value already outside the curated list opens straight into custom mode.
 */
function ModelCombobox({
  id,
  value,
  options,
  disabled,
  onCommit,
}: {
  id: string
  value: string
  options: string[]
  disabled: boolean
  onCommit: (raw: string) => void
}) {
  const known = options.includes(value)
  const [custom, setCustom] = useState(!known && value !== '')
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
    setCustom(!options.includes(value) && value !== '')
  }, [value, options])

  return (
    <div className="settings-combo">
      <select
        id={id}
        className="settings-input"
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            return
          }
          setCustom(false)
          onCommit(e.target.value)
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {custom && (
        <input
          className="settings-input mono"
          type="text"
          placeholder="model id (e.g. claude-opus-5, claude-opus-5[1m])"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      )}
    </div>
  )
}

/**
 * The collapsed "Advanced — per-step models" section (issue #48). Sparse: only
 * steps that are actually set are listed (each editable + resettable); an
 * "Add override" picker adds one for a not-yet-set step. `review` is never
 * offered. Global-only, so writes carry no projectId — and being machine-wide,
 * these lose to a project's own model, which the body states outright.
 */
function AdvancedModels({ query }: { query: QueryResult<SettingsView> }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  const view = query.data
  const set = view ? stepModelRows(view) : []
  const unset = view ? unsetStepKeys(view) : []
  const defaultModel = view?.fields.find((f) => f.key === 'model')

  const commit = (key: string, value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') return
    update.mutate({ key, value: trimmed })
  }

  return (
    <section className="settings-section">
      <button
        type="button"
        className="settings-advanced-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="settings-section-title">Advanced — per-step models</span>
        <span className="settings-section-hint">
          {set.length > 0 ? `${set.length} override${set.length === 1 ? '' : 's'}` : 'none set'}
          {open ? ' ▾' : ' ▸'}
        </span>
      </button>

      {open && (
        <div className="settings-advanced-body">
          {set.length === 0 && <DimLine>every step uses the default model.</DimLine>}
          {set.length > 0 && (
            <DimLine>Machine-wide — a project that sets its own model ignores these.</DimLine>
          )}
          {set.map((row) => (
            <div key={row.key} className="settings-field">
              <div className="settings-field-head">
                <span className="settings-field-label">{row.label}</span>
                {update.isPending && <span className="settings-saving">saving…</span>}
              </div>
              <ModelCombobox
                id={`step-${row.key}`}
                value={row.value}
                options={row.options}
                disabled={update.isPending}
                onCommit={(raw) => commit(row.key, raw)}
              />
              <button
                className="settings-clear"
                disabled={update.isPending}
                onClick={() => update.mutate({ key: row.key, value: null })}
              >
                Reset to default
              </button>
            </div>
          ))}

          {unset.length > 0 && (
            <div className="settings-field">
              <label className="settings-field-label" htmlFor="step-add">
                Add an override
              </label>
              <select
                id="step-add"
                className="settings-input"
                value=""
                disabled={update.isPending}
                onChange={(e) => {
                  const key = e.target.value
                  if (!key) return
                  // Seed the new override from the current default so the row
                  // appears immediately; the operator then edits its model.
                  commit(key, typeof defaultModel?.value === 'string' ? defaultModel.value : '')
                }}
              >
                <option value="">Choose a step…</option>
                {unset.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
