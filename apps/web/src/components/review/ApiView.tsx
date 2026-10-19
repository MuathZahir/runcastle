import { useState, type ReactNode } from 'react'
import type { DriveCallResult, DriveScenario, ScenarioEntry } from '@runcastle/core'
import {
  Button,
  Disclosure,
  IconButton,
  List,
  ListRow,
  SectionLabel,
  StatusLabel,
  TextArea,
  TextField,
  cx,
} from '../../ui'
import { SELECT_FIELD, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { IconPlay, IconPlus, IconRefresh, IconX } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { callForm, callMethods, callRequest, prettyBody, statusTone, type CallForm } from '../../lib/feature-ui/api-call'
import type { ScenarioMenu } from '../../lib/feature-ui/scenarios'

/**
 * The running drive's API view (drive-scenarios decision 11): the calls listed
 * like the Scenario menu; picking one runs its scenario against the live drive,
 * and once it lands its filled request is shown, editable in place, and Try it
 * sends it from runcastle's server to the drive. Edits live only here — never
 * written back to the `.http` file — and a new landing refills the form.
 *
 * `calls` is the call-only menu; `strip` is the running or failed strip for
 * `scenario`, shown when it is the call picked; `toolbar` is the App | API
 * toggle the hidden app panel would otherwise carry.
 */
export function ApiView({
  projectId,
  calls,
  scenario,
  strip,
  toolbar,
  onRun,
  preselected,
}: {
  /** The scenario whose call starts selected — a map door's Try it, which runs it itself. */
  preselected?: string
  projectId: string
  calls: ScenarioMenu
  scenario: DriveScenario | undefined
  strip: ReactNode
  toolbar: ReactNode
  onRun: (file: string) => void
}) {
  const toast = useToast()
  // A landed call already on the drive is the one shown until another is picked.
  const [picked, setPicked] = useState<string | null>(preselected ?? null)
  const current = picked ?? (scenario?.call ? scenario.file : null)
  const mine = scenario && scenario.file === current ? scenario : undefined
  const landing = mine?.status === 'landed' ? mine.landingId : undefined

  // Edits and the last response belong to one landing: a re-run discards both.
  const [edit, setEdit] = useState<{ landingId: string; form: CallForm } | null>(null)
  const [result, setResult] = useState<{ landingId: string; res: DriveCallResult } | null>(null)
  const form =
    landing && mine?.call ? (edit?.landingId === landing ? edit.form : callForm(mine.call)) : null
  const response = landing && result?.landingId === landing ? result.res : null
  const setForm = (next: CallForm) => landing && setEdit({ landingId: landing, form: next })

  const send = trpc.feature.sendCall.useMutation({ onError: (e) => toast.push(e.message) })
  const trySend = () => {
    if (!form || !landing) return
    send.mutate(
      { projectId, request: callRequest(form) },
      { onSuccess: (res) => setResult({ landingId: landing, res }) },
    )
  }

  const pick = (file: string) => {
    setPicked(file)
    onRun(file)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-surface-inset">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-raised p-1 shadow-popover">{toolbar}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 md:flex-row md:overflow-hidden">
        <nav aria-label="Calls" className="flex shrink-0 flex-col gap-3 md:w-60 md:overflow-auto">
          <CallSection title="This feature" entries={calls.own} current={current} onPick={pick} />
          <CallSection title={calls.othersLabel} entries={calls.others} current={current} onPick={pick} />
        </nav>
        <section aria-label="Request" className="flex min-w-0 flex-1 flex-col gap-3 md:overflow-auto">
          {!current && <p className="m-0 text-sm text-text-tertiary">Pick a call to seed its state and fill its request.</p>}
          {mine && mine.status !== 'landed' && strip}
          {mine?.status === 'landed' && mine.callError && (
            <p className="m-0 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger" role="alert">
              Couldn’t read the call: {mine.callError}
            </p>
          )}
          {form && (
            <>
              <RequestForm form={form} onChange={setForm} />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" icon={<IconPlay />} loading={send.isPending} onClick={trySend}>
                  {response ? 'Send again' : 'Try it'}
                </Button>
                <Button size="sm" variant="ghost" icon={<IconRefresh />} onClick={() => current && onRun(current)}>
                  Re-run scenario
                </Button>
              </div>
              {response && <CallResponse result={response} />}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function CallSection({
  title,
  entries,
  current,
  onPick,
}: {
  title: string
  entries: ScenarioEntry[]
  current: string | null
  onPick: (file: string) => void
}) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>{title}</SectionLabel>
      <List>
        {entries.map((s) => (
          <ListRow
            key={s.file}
            title={s.name}
            meta={s.group}
            tooltip={s.file}
            active={s.file === current}
            onClick={() => onPick(s.file)}
          />
        ))}
      </List>
    </div>
  )
}

/** The filled request, every part editable: method, URL, header rows, body. */
function RequestForm({ form, onChange }: { form: CallForm; onChange: (form: CallForm) => void }) {
  const setHeader = (i: number, patch: Partial<CallForm['headers'][number]>) =>
    onChange({ ...form, headers: form.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Select value={form.method} onValueChange={(method) => onChange({ ...form, method })}>
          <SelectTrigger aria-label="Method" className={cx(SELECT_FIELD, 'w-28 shrink-0 font-mono')}>
            <SelectValue>{form.method}</SelectValue>
          </SelectTrigger>
          <SelectContent className="font-mono">
            {callMethods(form.method).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TextField
          mono
          aria-label="URL"
          className="min-w-0 flex-1"
          value={form.url}
          onChange={(e) => onChange({ ...form, url: e.target.value })}
        />
      </div>
      <SectionLabel
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<IconPlus />}
            onClick={() => onChange({ ...form, headers: [...form.headers, { name: '', value: '' }] })}
          >
            Add header
          </Button>
        }
      >
        Headers
      </SectionLabel>
      {form.headers.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextField
            mono
            aria-label={`Header ${i + 1} name`}
            className="w-2/5 min-w-0"
            value={h.name}
            onChange={(e) => setHeader(i, { name: e.target.value })}
          />
          <TextField
            mono
            aria-label={`Header ${i + 1} value`}
            className="min-w-0 flex-1"
            value={h.value}
            onChange={(e) => setHeader(i, { value: e.target.value })}
          />
          <IconButton
            size="sm"
            label="Remove header"
            icon={<IconX />}
            onClick={() => onChange({ ...form, headers: form.headers.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
      <SectionLabel>Body</SectionLabel>
      <TextArea
        mono
        rows={6}
        aria-label="Body"
        value={form.body}
        onChange={(e) => onChange({ ...form, body: e.target.value })}
      />
    </div>
  )
}

/** What the drive answered: status by class, duration, headers folded, body pretty when JSON. */
function CallResponse({ result }: { result: DriveCallResult }) {
  if (!result.ok) {
    return (
      <p className="m-0 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger" role="alert">
        Couldn’t send: {result.error}
      </p>
    )
  }
  return (
    <div aria-label="Response" role="region" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <StatusLabel size="sm" strong tone={statusTone(result.status)}>
          {`${result.status} ${result.statusText}`.trim()}
        </StatusLabel>
        <span className="text-xs text-text-tertiary tabular-nums">{result.durationMs} ms</span>
      </div>
      <Disclosure size="sm" title={`Headers (${result.headers.length})`}>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
          {result.headers.map(([name, value], i) => (
            <div key={i} className="contents">
              <dt className="text-text-tertiary">{name}</dt>
              <dd className="m-0 break-all text-text-secondary">{value}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
      <pre className="m-0 max-h-96 overflow-auto rounded-md bg-surface px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-text">
        {prettyBody(result.body)}
      </pre>
      {result.truncated && <span className="text-xs text-warning">Truncated at 256 KB</span>}
    </div>
  )
}
