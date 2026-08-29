import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { trpc } from '../../trpc'
import {
  FIELD_ENV_VAR,
  fieldCommit,
  type ProvenanceChip as ProvenanceChipData,
  type SettingRow as Row,
  type SourceChip as SourceChipKind,
} from '../../lib/settings'
import { Field } from '../../ui'
import { IconLock } from '../../icons'
import { showsSetting, type FilterState } from './types'

/**
 * One settings field, and the group it sits in — the shape every page of the
 * dialog is made of (flow-redesign-settings, decisions 5 / 7 / 8).
 *
 * The text policy lives here: a row shows its label, a placeholder with an
 * example value, and at most one short help line. The full explanation is
 * behind the ⓘ, provenance is a chip, and the evidence behind that chip is a
 * popover the project page opens — never a paragraph under the control.
 */

/** How long "Saved ✓" stays up after a commit lands. */
const SAVED_MS = 1400

/** How long a deep-linked row keeps its accent outline. */
const HIGHLIGHT_MS = 1500

/** Join the parts that are present. Falsy branches drop out. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const CHIP =
  'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-pill border px-2 text-xs'

const CONTROL =
  'h-(--control-h) w-full min-w-0 rounded-sm border border-hairline bg-panel-inset px-2.5 ' +
  'text-text placeholder:text-text-4 hover:border-hairline-strong ' +
  'disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-text-3'

/**
 * The 11px uppercase heading over a group of rows, with the hairline that runs
 * out to the edge of the page. Not {@link SectionTitle}: that primitive still
 * carries the `section-title` legacy hook, and an unlayered `styles.css` rule
 * would beat every utility beside it.
 *
 * A group whose rows are all filtered out renders nothing at all — a heading
 * over an empty space reads as a section with nothing in it.
 */
export function SettingGroup({
  title,
  rows,
  projectId,
  filter,
  highlightField,
}: {
  title: string
  rows: Row[]
  projectId?: string
  filter: FilterState
  highlightField?: string
}) {
  const visible = rows.filter((row) => showsSetting(filter, row.key))
  if (visible.length === 0) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-text-3 uppercase">
        {title}
        <span className="h-px flex-1 bg-hairline-soft" />
      </h3>
      <div>
        {visible.map((row) => (
          <SettingRow
            key={row.key}
            row={row}
            projectId={projectId}
            highlight={highlightField === row.key}
          />
        ))}
      </div>
    </section>
  )
}

export function SettingRow({
  row,
  projectId,
  highlight,
  onOpenEvidence,
}: {
  row: Row
  /** Present → writes target this project's overrides; absent → the global store. */
  projectId?: string
  /** A deep link named this field: scroll to it and flash it once. */
  highlight?: boolean
  /** Opens the preparation evidence behind the provenance chip. */
  onOpenEvidence?: () => void
}) {
  const utils = trpc.useUtils()
  // An unset project field shows the inherited global value as a GHOST rather
  // than as its own value, so the control is empty and what will actually run
  // is still on screen (decision 7).
  const committed = row.ghostValue ? '' : row.value
  const [draft, setDraft] = useState(committed)
  /** Why this field's last commit was refused; cleared by the next edit. */
  const [invalid, setInvalid] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  /** Set once this field has been changed — serverPort's amber restart line. */
  const [restart, setRestart] = useState(false)
  const [flash, setFlash] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep the draft in sync when a refetch changes the resolved value.
  useEffect(() => setDraft(committed), [committed])
  useEffect(() => () => clearTimeout(savedTimer.current), [])

  useEffect(() => {
    if (!highlight) return
    rowRef.current?.scrollIntoView?.({ block: 'center' })
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight])

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      setInvalid(null)
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), SAVED_MS)
      // Only once it has actually been changed: an always-on badge is the one
      // the audit found nobody reads (findings F17.7 / F25.4).
      if (row.restartRequired) setRestart(true)
      void utils.settings.get.invalidate()
      // The write re-sourced any preparation finding on this key to `human`, so
      // the provenance chip has to be refetched with the value.
      void utils.project.prep.invalidate()
    },
    onError: (e) => {
      setDraft(committed)
      // Beside the field, not in a toast: a rejected value is a question about
      // THIS field, and the draft has just snapped back, so a message that
      // floats away leaves no trace of why.
      setInvalid(e.message)
    },
  })

  const save = (raw: string) => {
    if (raw.trim() === committed.trim()) return
    const commit = fieldCommit(row.control, raw)
    if ('error' in commit) {
      setInvalid(commit.error)
      return
    }
    setInvalid(null)
    update.mutate({ ...(projectId ? { projectId } : {}), key: row.key, value: commit.value })
  }

  // Scoped, because most keys appear in both the global and the project view.
  // Two controls sharing one id made every `htmlFor` resolve to the global one,
  // so the per-project fields had no accessible name at all (findings F17.7).
  const controlId = `set-${projectId ? 'project' : 'global'}-${row.key}`

  return (
    <div
      ref={rowRef}
      className={cx(
        'border-b border-hairline-soft py-2 last:border-b-0',
        flash && 'rounded-sm outline-2 outline-offset-2 outline-accent',
      )}
    >
      <Field
        htmlFor={controlId}
        // The label takes column one; the control, its help and its error stack
        // down column two.
        layout="grid grid-cols-[210px_1fr] items-start gap-x-4 gap-y-1.5 [&>*+*]:col-start-2"
        label={row.label}
        labelAside={
          <>
            {row.tooltip && <InfoTip about={row.label} text={row.tooltip} />}
            {saved && <span className="text-xs text-ok">Saved ✓</span>}
          </>
        }
        help={row.shortHelp}
        error={invalid}
      >
        <RowControl
          row={row}
          draft={draft}
          disabled={update.isPending}
          restart={restart}
          onDraft={setDraft}
          onCommit={save}
          onRevert={() => setDraft(committed)}
          onOpenEvidence={onOpenEvidence}
        />
      </Field>
    </div>
  )
}

/**
 * The control cell: the control itself, the chips that say where its value came
 * from, and the restart line. Cloned by {@link Field} with the `id` and
 * `aria-describedby` it forwards to the control — which is why this is a
 * component and not a bare `<div>` at the call site.
 */
function RowControl({
  id,
  'aria-describedby': describedBy,
  row,
  draft,
  disabled,
  restart,
  onDraft,
  onCommit,
  onRevert,
  onOpenEvidence,
}: {
  id?: string
  'aria-describedby'?: string
  row: Row
  draft: string
  disabled: boolean
  restart: boolean
  onDraft: (value: string) => void
  onCommit: (value: string) => void
  onRevert: () => void
  onOpenEvidence?: () => void
}) {
  // Every editable value on this surface is an identifier, a command or a
  // number, so the control is mono unless it is a list of choices.
  const wiring = { id, 'aria-describedby': describedBy, disabled }
  const mono = row.control === 'select' ? '' : 'font-mono text-sm'
  const revertKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return
    onRevert()
    e.currentTarget.blur()
  }
  const commitKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    revertKey(e)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {row.readOnly ? (
          // Locked, not read-only text: the old surface rendered the value as
          // mono prose with a sentence under it, which read as a value rather
          // than as something this app cannot change (decision 11).
          <input
            {...wiring}
            disabled
            readOnly
            className={cx(CONTROL, mono, row.control === 'number' && 'w-24 tabular-nums')}
            value={row.optionLabels[row.value] ?? row.value}
          />
        ) : row.control === 'select' ? (
          <select
            {...wiring}
            className={cx(CONTROL, 'max-w-90 cursor-pointer')}
            value={draft}
            onChange={(e) => {
              onDraft(e.target.value)
              onCommit(e.target.value)
            }}
          >
            {/* An unset project field leads with what it inherits, so the first
                choice states the effective value rather than looking empty. */}
            {row.ghostValue && <option value="">Use global ({row.ghostValue})</option>}
            {row.modelGroups.length > 0
              ? row.modelGroups.map((group) => (
                  <optgroup key={group.runtime} label={group.label}>
                    {group.entries.map((entry) => (
                      <option key={entry.id} value={entry.id} title={entry.note}>
                        {entry.note ? `${entry.id} — ${entry.note}` : entry.id}
                      </option>
                    ))}
                  </optgroup>
                ))
              : row.options.map((opt) => (
                  // The stored value is a config identifier ("noSandbox",
                  // "inherit"); the dropdown reads out what it means.
                  <option key={opt} value={opt}>
                    {row.optionLabels[opt] ?? opt}
                  </option>
                ))}
          </select>
        ) : row.control === 'textarea' ? (
          // Multi-line values (verify commands, known failures) — an <input>
          // silently drops the newlines that give them their meaning.
          <textarea
            {...wiring}
            rows={2}
            className={cx(CONTROL, mono, 'h-auto min-h-16 resize-y py-2 leading-normal')}
            placeholder={row.ghostValue ?? row.placeholder}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
            // No Enter-to-commit: here it is a newline, which is the point.
            onKeyDown={revertKey}
          />
        ) : (
          <input
            {...wiring}
            type={row.control === 'number' ? 'number' : 'text'}
            className={cx(CONTROL, mono, row.control === 'number' && 'w-24 tabular-nums')}
            placeholder={row.ghostValue ?? row.placeholder}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
            onKeyDown={commitKeys}
          />
        )}
        {row.unit && <span className="text-sm whitespace-nowrap text-text-3">{row.unit}</span>}
        {row.sourceChip && <SourceChip kind={row.sourceChip} envVar={FIELD_ENV_VAR[row.key]} />}
      </div>
      {row.provenanceChip && (
        <div className="flex">
          <ProvenanceChip chip={row.provenanceChip} onOpenEvidence={onOpenEvidence} />
        </div>
      )}
      {restart && <div className="text-sm text-warn">Restart the server to apply</div>}
    </div>
  )
}

/**
 * The full explanation, on demand. A `<label>` may not contain another
 * labelable element, so this is the label's sibling rather than its child, and
 * the tooltip is a positioned sibling of the button rather than a library.
 */
function InfoTip({ about, text }: { about: string; text: string }) {
  const tipId = useId()
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`About ${about}`}
        aria-describedby={tipId}
        className="peer grid size-4 cursor-default place-items-center rounded-pill border border-hairline-strong text-[10px] text-text-3 hover:border-accent-line hover:text-accent-hi"
      >
        i
      </button>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none invisible absolute top-5.5 left-0 z-10 w-75 rounded-md border border-hairline-strong bg-panel-3 px-2.5 py-2 text-sm leading-normal font-normal text-text-2 shadow-overlay peer-hover:visible peer-focus-visible:visible"
      >
        {text}
      </span>
    </span>
  )
}

const SOURCE_CHIP: Record<SourceChipKind, { text: string; className: string }> = {
  global: { text: 'Global', className: 'border-hairline bg-panel-2 text-text-2' },
  project: { text: 'This project', className: 'border-accent-line bg-accent-soft text-accent-hi' },
  env: { text: 'Env', className: 'border-hairline bg-panel-2 text-text-3' },
}

/** Where the value on screen came from — the whole of the override signal. */
function SourceChip({ kind, envVar }: { kind: SourceChipKind; envVar?: string }) {
  const chip = SOURCE_CHIP[kind]
  return (
    <span
      className={cx(CHIP, chip.className)}
      {...(kind === 'env' && envVar ? { title: `Set by ${envVar}` } : {})}
    >
      {kind === 'env' && <IconLock size={10} />}
      {chip.text}
    </span>
  )
}

const PROVENANCE_DOT: Record<ProvenanceChipData['tone'], string> = {
  ok: 'bg-ok',
  muted: 'bg-text-4',
  warn: 'bg-warn',
}

/**
 * Who established a prepared value, in one line. The evidence behind it runs to
 * thousands of words and is never inline (decision 5) — `onOpenEvidence` is
 * what turns the chip into the button that reveals it.
 */
function ProvenanceChip({
  chip,
  onOpenEvidence,
}: {
  chip: ProvenanceChipData
  onOpenEvidence?: (() => void) | undefined
}) {
  const tone = chip.tone === 'warn' ? 'border-warn/45 text-warn' : 'border-hairline text-text-2'
  const body = (
    <>
      <span className={cx('size-1.5 shrink-0 rounded-pill', PROVENANCE_DOT[chip.tone])} />
      {chip.text}
    </>
  )
  if (!onOpenEvidence) return <span className={cx(CHIP, 'bg-panel-2', tone)}>{body}</span>
  return (
    <button
      type="button"
      onClick={onOpenEvidence}
      className={cx(CHIP, 'bg-panel-2 hover:border-hairline-strong hover:text-text', tone)}
    >
      {body}
    </button>
  )
}
