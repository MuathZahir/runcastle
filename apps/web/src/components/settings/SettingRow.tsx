import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { trpc } from '../../trpc'
import { HIGHLIGHT_RING, useHighlight } from './highlight'
import {
  FIELD_ENV_VAR,
  fieldCommit,
  type ProvenanceChip as ProvenanceChipData,
  type SettingRow as Row,
  type SourceChip as SourceChipKind,
} from '../../lib/settings'
import { Button, cx, StatusDot, TextArea, TextField } from '../../ui'
import type { StatusTone } from '../../ui'
import {
  SELECT_FIELD,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../ui/select'
import { IconCheck, IconLock } from '../../icons'
import { showsSetting, type FilterState } from './types'

/**
 * One settings field, and the group it sits in — the shape every page of the
 * dialog is made of (flow-redesign-settings, decisions 5 / 7 / 8).
 *
 * A row is two columns, Linear-style: the label (13px medium) with its
 * explanation beneath it in `text-xs text-tertiary` on the left, the control on
 * the right. Rows are divided by `border-subtle` and nothing else — no boxes.
 * A multi-line control (commands, drive instructions) needs the width, so its
 * row stacks: the label and description over a full-width control.
 *
 * Provenance is a quiet status label under the control, and the evidence behind
 * it is a popover the project page opens — never a paragraph under the control.
 */

/**
 * Truncates the selected value inside a `SelectTrigger`. `SelectValue`'s own
 * `truncate` does not reach the span Radix renders, so a long option ("Inherit
 * mine — my servers alongside runcastle's") wrapped the trigger onto two lines.
 */
export const SELECT_TRUNCATE = '[&>span:first-child]:min-w-0 [&>span:first-child]:truncate'

/** How long "Saved" stays up after a commit lands. */
const SAVED_MS = 1400

/**
 * A group of rows under its heading. A group whose rows are all filtered out
 * renders nothing at all — a heading over an empty space reads as a section
 * with nothing in it.
 */
export function SettingGroup({
  title,
  rows,
  projectId,
  filter,
  highlightField,
  onOpenEvidence,
  evidence,
}: {
  title: string
  rows: Row[]
  projectId?: string
  filter: FilterState
  highlightField?: string
  /** Toggles a row's preparation evidence — the project page's chips. */
  onOpenEvidence?: (key: string) => void
  /** The open evidence popover, rendered beside that row's provenance chip. */
  evidence?: (row: Row) => ReactNode
}) {
  const visible = rows.filter((row) => showsSetting(filter, row.key))
  if (visible.length === 0) return null
  return (
    <SettingSection title={title}>
      {visible.map((row) => (
        <SettingRow
          key={row.key}
          row={row}
          projectId={projectId}
          highlight={highlightField === row.key}
          // A finding with nothing behind it leaves the chip a plain label —
          // a button that opens an empty card is worse than no button.
          {...(onOpenEvidence && row.provenanceChip?.evidence
            ? { onOpenEvidence: () => onOpenEvidence(row.key) }
            : {})}
          {...(evidence ? { evidence: evidence(row) } : {})}
        />
      ))}
    </SettingSection>
  )
}

/**
 * A titled group on a page: a 12px medium sentence-case heading, then its rows.
 * Exported because not every group is a list of setting rows — the Burns page
 * opens with the prerequisites checklist, and Models with its tables.
 */
export function SettingSection({
  title,
  action,
  description,
  children,
}: {
  title: string
  /** One trailing control on the heading's line (a Refresh). */
  action?: ReactNode
  /** One line under the heading, for a group whose rows need a preamble. */
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="flex min-h-7 items-center gap-3 border-b border-border-subtle pb-2">
        <h3 className="m-0 min-w-0 flex-1 text-sm font-medium text-text">{title}</h3>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      {description && (
        <div className="mt-2.5 text-xs text-pretty text-text-tertiary">{description}</div>
      )}
      <div>{children}</div>
    </section>
  )
}

/**
 * The frame of one row: label and description on the left, the control on the
 * right (or beneath, `stacked`). Shared by the field rows, the Models page's
 * default model and General's theme, so every row on every page lines up.
 *
 * The root keeps `border-b`: it is the divider between rows, and a deep link's
 * flash (`outline-accent`) lands on it.
 */
export function SettingLine({
  label,
  htmlFor,
  description,
  descriptionId,
  aside,
  control,
  below,
  stacked = false,
  flash = false,
  rowRef,
}: {
  label: ReactNode
  /** The control's id, so the label names it. */
  htmlFor?: string
  description?: ReactNode
  descriptionId?: string
  /** Beside the label: the quiet "Saved" mark. */
  aside?: ReactNode
  control: ReactNode
  /** Under the control: help, provenance, errors. */
  below?: ReactNode
  stacked?: boolean
  flash?: boolean
  rowRef?: Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={rowRef}
      className={cx(
        'border-b border-border-subtle py-4 last:border-b-0',
        'transition-[outline-color] duration-(--dur-3) ease-app',
        stacked
          ? 'flex flex-col gap-2.5'
          : 'grid grid-cols-[minmax(0,1fr)_minmax(0,300px)] items-start gap-x-8 gap-y-1.5',
        flash && HIGHLIGHT_RING,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5 pt-1">
        <div className="flex min-h-5 items-center gap-2">
          <label htmlFor={htmlFor} className="text-sm font-medium text-text">
            {label}
          </label>
          {aside}
        </div>
        {description && (
          <p id={descriptionId} className="m-0 text-xs text-pretty text-text-tertiary">
            {description}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {control}
        {below}
      </div>
    </div>
  )
}

export function SettingRow({
  row,
  projectId,
  highlight,
  onOpenEvidence,
  evidence,
}: {
  row: Row
  /** Present → writes target this project's overrides; absent → the global store. */
  projectId?: string
  /** A deep link named this field: scroll to it and flash it once. */
  highlight?: boolean
  /** Opens the preparation evidence behind the provenance chip. */
  onOpenEvidence?: () => void
  /** The open evidence popover, positioned against the provenance chip. */
  evidence?: ReactNode
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
  /** Set once this field has been changed — serverPort's restart line. */
  const [restart, setRestart] = useState(false)
  const { ref: rowRef, flash } = useHighlight<HTMLDivElement>(highlight)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep the draft in sync when a refetch changes the resolved value.
  useEffect(() => setDraft(committed), [committed])
  useEffect(() => () => clearTimeout(savedTimer.current), [])

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

  /** Typing is the answer to a refusal, so it takes the message down. */
  const edit = (raw: string) => {
    setDraft(raw)
    if (invalid) setInvalid(null)
  }

  /** Write this field in whichever scope the row was rendered for. */
  const write = (value: string | number | null) => {
    setInvalid(null)
    update.mutate({ ...(projectId ? { projectId } : {}), key: row.key, value })
  }

  const save = (raw: string) => {
    if (raw.trim() === committed.trim()) return
    const commit = fieldCommit(row.control, raw)
    if ('error' in commit) {
      setInvalid(commit.error)
      return
    }
    write(commit.value)
  }

  // One null write, two labels, because clearing is the same act in both scopes:
  // at project scope it drops the override and the row goes back to showing the
  // global as a ghost ("Use global", decision 7 — no OVERRIDDEN badge); at
  // global scope it removes the machine-wide value and the field falls back to
  // its default ("Clear").
  const clear = () => write(null)

  // Scoped, because most keys appear in both the global and the project view.
  // Two controls sharing one id made every `htmlFor` resolve to the global one,
  // so the per-project fields had no accessible name at all (findings F17.7).
  const controlId = `set-${projectId ? 'project' : 'global'}-${row.key}`
  const helpId = `${controlId}-help`
  const errorId = `${controlId}-error`
  const descriptionId = `${controlId}-about`
  const describedBy =
    cx(descriptionId, row.shortHelp ? helpId : null, invalid ? errorId : null) || undefined

  const hasMeta = row.sourceChip || row.clearable || row.provenanceChip
  return (
    <SettingLine
      rowRef={rowRef}
      flash={flash}
      stacked={row.control === 'textarea'}
      label={row.label}
      htmlFor={controlId}
      description={row.tooltip || undefined}
      descriptionId={descriptionId}
      aside={saved && <SaveMark />}
      control={
        <RowControl
          id={controlId}
          describedBy={describedBy}
          row={row}
          draft={draft}
          disabled={update.isPending}
          onDraft={edit}
          onCommit={save}
          onRevert={() => setDraft(committed)}
        />
      }
      below={
        <>
          {row.shortHelp && (
            <div id={helpId} className="text-xs text-text-tertiary">
              {row.shortHelp}
            </div>
          )}
          {hasMeta && (
            <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1">
              {row.sourceChip && (
                <SourceChip kind={row.sourceChip} envVar={FIELD_ENV_VAR[row.key]} />
              )}
              {row.sourceChip === 'project' && (
                <Button variant="ghost" size="sm" onClick={clear} className="-ml-1.5">
                  Use global
                </Button>
              )}
              {/* The machine-wide twin of "Use global": a set global value has
                  no chip to hang a link off, and blanking the control commits ''
                  rather than removing anything — so without this the way back to
                  the default was unreachable from the UI that recommends it. */}
              {row.clearable && (
                <Button variant="ghost" size="sm" onClick={clear} className="-ml-1.5">
                  Clear
                </Button>
              )}
              {row.provenanceChip && (
                <div className="relative flex min-w-0">
                  <ProvenanceChip chip={row.provenanceChip} onOpenEvidence={onOpenEvidence} />
                  {evidence}
                </div>
              )}
              {row.stale && (
                // Says where the refresh lives, because for a long time it said
                // "re-prepare to refresh it" while offering no way to and
                // nothing on screen mentioning one.
                <span
                  className="inline-flex items-center gap-1.5 text-xs text-warning"
                  title="Measured a long time ago — “Re-prepare the project”, at the foot of the features rail, refreshes it"
                >
                  <StatusDot tone="warning" />
                  Stale
                </span>
              )}
            </div>
          )}
          {restart && <div className="text-xs text-warning">Restart the server to apply</div>}
          {invalid && (
            <div id={errorId} role="alert" className="text-xs text-danger">
              {invalid}
            </div>
          )}
        </>
      }
    />
  )
}

/** The brief "it landed" beside a label or a cell: a check and a word, fading in. */
export function SaveMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-tertiary animate-fade-in">
      <IconCheck size={12} className="text-success" />
      Saved
    </span>
  )
}

/**
 * The control itself. Every editable value on this surface is an identifier, a
 * command or a number, so the control is mono unless it is a list of choices.
 */
function RowControl({
  id,
  describedBy,
  row,
  draft,
  disabled,
  onDraft,
  onCommit,
  onRevert,
}: {
  id: string
  describedBy?: string
  row: Row
  draft: string
  disabled: boolean
  onDraft: (value: string) => void
  onCommit: (value: string) => void
  onRevert: () => void
}) {
  const wiring = { id, 'aria-describedby': describedBy, disabled }
  const revertKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return
    onRevert()
    e.currentTarget.blur()
  }
  const commitKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    revertKey(e)
  }
  const unit = row.unit ? (
    <span className="min-w-0 text-xs text-pretty text-text-tertiary">{row.unit}</span>
  ) : undefined

  if (row.readOnly) {
    // Locked, not read-only text: the old surface rendered the value as mono
    // prose with a sentence under it, which read as a value rather than as
    // something this app cannot change (decision 11).
    return (
      <TextField
        {...wiring}
        disabled
        readOnly
        mono={row.control !== 'select'}
        icon={<IconLock />}
        className="w-full"
        inputClassName={row.control === 'number' ? 'tabular-nums' : undefined}
        value={row.optionLabels[row.value] ?? row.value}
      />
    )
  }

  if (row.control === 'select') {
    return (
      <Select
        value={draft}
        onValueChange={(next) => {
          onDraft(next)
          onCommit(next)
        }}
      >
        <SelectTrigger {...wiring} className={cx(SELECT_FIELD, SELECT_TRUNCATE, 'w-full')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* An unset project field leads with what it inherits, so the first
              choice states the effective value rather than looking empty. */}
          {row.ghostValue && (
            <SelectItem value="">
              Use global ({row.optionLabels[row.ghostValue] ?? row.ghostValue})
            </SelectItem>
          )}
          {row.modelGroups.length > 0
            ? row.modelGroups.map((group) => (
                <SelectGroup key={group.runtime}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.entries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id} title={entry.note}>
                      {entry.note ? `${entry.id} — ${entry.note}` : entry.id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))
            : row.options.map((opt) => (
                // The stored value is a config identifier ("noSandbox",
                // "inherit"); the dropdown reads out what it means.
                <SelectItem key={opt} value={opt}>
                  {row.optionLabels[opt] ?? opt}
                </SelectItem>
              ))}
        </SelectContent>
      </Select>
    )
  }

  if (row.control === 'textarea') {
    // Multi-line values (verify commands, known failures) — an <input>
    // silently drops the newlines that give them their meaning.
    return (
      <TextArea
        {...wiring}
        mono
        rows={3}
        placeholder={row.ghostValue ?? row.placeholder}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        // No Enter-to-commit: here it is a newline, which is the point.
        onKeyDown={revertKey}
      />
    )
  }

  const field = (
    <TextField
      {...wiring}
      type={row.control === 'number' ? 'number' : 'text'}
      mono
      className={row.control === 'number' ? 'w-24 shrink-0' : 'w-full'}
      inputClassName={row.control === 'number' ? 'tabular-nums' : undefined}
      placeholder={row.ghostValue ?? row.placeholder}
      value={draft}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={commitKeys}
    />
  )
  // A number's unit ("tickets at once · default on this machine: 3") is a
  // sentence, not a suffix — beside the field rather than squeezed into it.
  if (!unit) return field
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {field}
      {unit}
    </div>
  )
}

/** Where the value on screen came from — the whole of the override signal. */
const SOURCE_MARK: Record<SourceChipKind, { text: string; tone: StatusTone; word: string }> = {
  global: { text: 'Global', tone: 'neutral', word: 'text-text-tertiary' },
  project: { text: 'This project', tone: 'accent', word: 'text-text-secondary' },
  env: { text: 'Env', tone: 'neutral', word: 'text-text-tertiary' },
}

function SourceChip({ kind, envVar }: { kind: SourceChipKind; envVar?: string }) {
  const mark = SOURCE_MARK[kind]
  return (
    <span
      className={cx('inline-flex shrink-0 items-center gap-1.5 text-xs', mark.word)}
      {...(kind === 'env' && envVar ? { title: `Set by ${envVar}` } : {})}
    >
      {kind === 'env' ? <IconLock size={12} className="text-icon" /> : <StatusDot tone={mark.tone} />}
      <span>{mark.text}</span>
    </span>
  )
}

const PROVENANCE_TONE: Record<ProvenanceChipData['tone'], StatusTone> = {
  ok: 'success',
  muted: 'neutral',
  warn: 'warning',
}

/**
 * Who established a prepared value, in one line. The evidence behind it runs to
 * thousands of words and is never inline (decision 5) — `onOpenEvidence` is
 * what turns the label into the button that reveals it.
 */
function ProvenanceChip({
  chip,
  onOpenEvidence,
}: {
  chip: ProvenanceChipData
  onOpenEvidence?: (() => void) | undefined
}) {
  const body = (
    <>
      <StatusDot tone={PROVENANCE_TONE[chip.tone]} />
      <span className="truncate">{chip.text}</span>
    </>
  )
  const word = chip.tone === 'warn' ? 'text-warning' : 'text-text-secondary'
  if (!onOpenEvidence)
    return <span className={cx('inline-flex min-w-0 items-center gap-1.5 text-xs', word)}>{body}</span>
  return (
    <button
      type="button"
      onClick={onOpenEvidence}
      className={cx(
        '-mx-1.5 inline-flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-xs',
        'underline decoration-border-strong decoration-dotted underline-offset-4',
        'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text',
        word,
      )}
    >
      {body}
    </button>
  )
}
