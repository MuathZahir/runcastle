import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { FormField, FormValues, Question, ToolCall } from '../../../lib/chat-thread'
import { IconArrowLeft, IconArrowRight, IconCheck, IconCube, IconExternalLink, IconShield, IconSparkle } from '../../../icons'
import { BARE_BUTTON, Button, Checkbox, Field, Kbd, LINK, TextField, cx } from '../../../ui'
import { DiffView } from './Work'

/**
 * What the agent waits on the human for, docked where the composer is
 * (decision 4, revisited): the eye is already there, and the thread above
 * stays readable while answering. The agent's own docks are lists of numbered
 * choices, as in Claude Code: a digit picks, Enter goes on, and the last
 * choice always takes your own words. An MCP server's form or link docks the
 * same way, with Decline beside its answer and Esc to decline.
 */

export const DOCK =
  'relative flex flex-col rounded-lg bg-surface-raised ' +
  'shadow-[var(--elevation-popover),inset_0_1px_0_color-mix(in_oklab,var(--color-text)_6%,transparent)] animate-rise-in'

/** One numbered choice. */
function Choice({
  n,
  on,
  label,
  description,
  multi,
  onPick,
}: {
  n: number
  on: boolean
  label: ReactNode
  description?: string
  multi?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={on}
      onClick={onPick}
      className={cx(
        BARE_BUTTON,
        'group/choice flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-2.5 py-1.5 text-left',
        'transition-colors duration-(--dur-1) ease-app',
        on ? 'bg-surface-selected' : 'hover:bg-surface-hover',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mt-px grid size-5 shrink-0 place-items-center rounded-sm font-mono text-xs tabular-nums transition-colors duration-(--dur-1) ease-app',
          on ? 'bg-accent text-on-primary' : 'bg-surface-inset text-text-tertiary ring-1 ring-inset ring-border-subtle group-hover/choice:text-text-secondary',
        )}
      >
        {on && multi ? <IconCheck size={11} /> : n}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-text">{label}</span>
        {description && <span className="text-sm text-text-secondary">{description}</span>}
      </span>
    </button>
  )
}

/** The last choice: your own words, typed in place. */
function OtherChoice({
  n,
  value,
  onChange,
  placeholder,
  focused,
  onEnter,
}: {
  n: number
  value: string
  onChange: (v: string) => void
  placeholder: string
  focused?: boolean
  onEnter?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focused) ref.current?.focus()
  }, [focused])
  const on = value.trim() !== ''
  return (
    <label
      className={cx(
        'flex min-w-0 cursor-text items-center gap-3 rounded-md px-2.5 py-1.5 transition-colors duration-(--dur-1) ease-app',
        on ? 'bg-surface-selected' : 'hover:bg-surface-hover',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'grid size-5 shrink-0 place-items-center rounded-sm font-mono text-xs tabular-nums',
          on ? 'bg-accent text-on-primary' : 'bg-surface-inset text-text-tertiary ring-1 ring-inset ring-border-subtle',
        )}
      >
        {n}
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && on) onEnter?.()
        }}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-sm text-text outline-none placeholder:text-text-tertiary"
      />
    </label>
  )
}

function DockFooter({ left, children }: { left: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">{left}</span>
      {children}
    </div>
  )
}

/**
 * The agent's questions, one at a time (Claude's AskUserQuestion). A single
 * choice moves on by itself; several choices wait for Next. With more than
 * one question, a last page sums up the answers before they go; with one,
 * picking it sends it.
 */
export function QuestionDock({
  questions,
  onAnswer,
}: {
  questions: Question[]
  onAnswer: (answers: Record<string, string>) => void
}) {
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const box = useRef<HTMLDivElement>(null)
  const summary = questions.length > 1 && step === questions.length
  const q = questions[Math.min(step, questions.length - 1)]

  useEffect(() => box.current?.focus(), [step])

  const answerOf = (i: number): string => {
    const words = [...(picked[i] ?? [])]
    const typed = other[i]?.trim()
    if (typed) words.push(typed)
    return words.join(', ')
  }
  const all = () => Object.fromEntries(questions.map((qq, i) => [qq.question, answerOf(i)]))
  const next = (from = step) => {
    if (questions.length === 1) onAnswer(all())
    else setStep(from + 1)
  }
  const pick = (i: number, label: string) => {
    const multi = questions[i].multiSelect
    const now = picked[i] ?? []
    const after = multi ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label]
    setPicked((p) => ({ ...p, [i]: after }))
    if (!multi) {
      setOther((o) => ({ ...o, [i]: '' }))
      if (questions.length === 1) onAnswer({ [questions[0].question]: label })
      else window.setTimeout(() => setStep(i + 1), 140)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (summary) {
      if (e.key === 'Enter') onAnswer(all())
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') setStep(step - 1)
      return
    }
    const n = Number(e.key)
    if (n >= 1 && n <= q.options.length) pick(step, q.options[n - 1].label)
    if (e.key === 'Enter' && answerOf(step)) next()
    if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1)
  }

  return (
    <div ref={box} tabIndex={-1} onKeyDown={onKeyDown} role="group" aria-label="The agent asks" className={cx(DOCK, 'outline-none')}>
      {questions.length > 1 && (
        <div className="flex items-center gap-1 px-4 pt-3" aria-hidden>
          {[...questions.map((_, i) => (i === step ? 'now' : answerOf(i) ? 'done' : 'todo')), summary ? 'now' : 'todo'].map((st, i) => (
            <span
              key={i}
              className={cx(
                'h-0.75 min-w-0 flex-1 basis-0 rounded-full transition-colors duration-(--dur-2) ease-app',
                st === 'now' ? 'bg-accent' : st === 'done' ? 'bg-text-tertiary' : 'bg-border-strong',
              )}
            />
          ))}
        </div>
      )}
      {summary ? (
        <div key="summary" className="flex flex-col gap-1 px-2 pt-3 pb-2 animate-fade-in">
          <p className="m-0 mb-1 px-2 text-base font-medium text-text">Check your answers</p>
          {questions.map((qq, i) => (
            <button
              key={qq.question}
              type="button"
              onClick={() => setStep(i)}
              className={cx(
                BARE_BUTTON,
                'group/sum flex min-w-0 cursor-pointer items-baseline gap-3 rounded-md px-2 py-1.5 text-left',
                'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
              )}
            >
              <span className="w-28 shrink-0 truncate text-sm text-text-tertiary">{qq.header}</span>
              <span className="min-w-0 flex-1 text-sm text-text">{answerOf(i)}</span>
              <span className="shrink-0 text-xs text-text-tertiary opacity-0 group-hover/sum:opacity-100">Change</span>
            </button>
          ))}
        </div>
      ) : (
        <div key={step} className="flex flex-col gap-1 px-2 pt-3 pb-2 animate-fade-in">
          <div className="mb-1 flex flex-col gap-0.5 px-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary">
              <IconSparkle size={12} className="text-icon" />
              {q.header}
              {questions.length > 1 && <span className="tabular-nums"> · {step + 1} of {questions.length}</span>}
              {q.multiSelect && <span> · pick any</span>}
            </span>
            <span className="text-base text-text">{q.question}</span>
          </div>
          {q.options.map((o, i) => (
            <Choice
              key={o.label}
              n={i + 1}
              on={(picked[step] ?? []).includes(o.label)}
              label={o.label}
              description={o.description}
              multi={q.multiSelect}
              onPick={() => pick(step, o.label)}
            />
          ))}
          <OtherChoice
            n={q.options.length + 1}
            value={other[step] ?? ''}
            onChange={(v) => {
              setOther((o) => ({ ...o, [step]: v }))
              if (!q.multiSelect && v) setPicked((p) => ({ ...p, [step]: [] }))
            }}
            placeholder="Other — type your own answer"
            onEnter={() => next()}
          />
        </div>
      )}
      <DockFooter
        left={
          summary ? (
            <>
              <Kbd>Enter</Kbd> to send
            </>
          ) : (
            <>
              <Kbd>1</Kbd>–<Kbd>{String(q.options.length)}</Kbd> to pick · <Kbd>Enter</Kbd> to go on
            </>
          )
        }
      >
        {step > 0 && (
          <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {summary ? (
          <Button variant="primary" size="sm" icon={<IconCheck />} onClick={() => onAnswer(all())}>
            Send answers
          </Button>
        ) : (
          (q.multiSelect || (other[step] ?? '').trim() !== '' || questions.length > 1) && (
            <Button
              variant={answerOf(step) ? 'primary' : 'secondary'}
              size="sm"
              icon={questions.length === 1 ? <IconCheck /> : <IconArrowRight />}
              disabled={!answerOf(step)}
              onClick={() => next()}
            >
              {questions.length === 1 ? 'Send' : 'Next'}
            </Button>
          )
        )}
      </DockFooter>
    </div>
  )
}

/**
 * "May I run this?" — the call itself (the command, or the file's diff for an
 * edit), then Claude Code's three answers: yes; yes and don't ask again; no,
 * and here's what to do instead.
 */
export function ApprovalDock({
  call,
  onAnswer,
}: {
  call: ToolCall
  onAnswer: (answer: 'allow' | 'always' | 'deny', instead?: string) => void
}) {
  const [instead, setInstead] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  const verb =
    call.kind === 'execute' ? 'Run this command?' : call.kind === 'edit' ? `Make this edit to ${call.diff?.path ?? 'the file'}?` : call.kind === 'fetch' ? 'Fetch this page?' : 'Use this tool?'
  const first = call.title.split(/\s+/).slice(0, 2).join(' ')
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === '1') onAnswer('allow')
    if (e.key === '2') onAnswer('always')
    if (e.key === 'Escape') onAnswer('deny')
  }
  return (
    <div ref={box} tabIndex={-1} onKeyDown={onKeyDown} role="group" aria-label="The agent asks to" className={cx(DOCK, 'outline-none')}>
      <div className="flex flex-col gap-2 px-4 pt-3">
        <span className="flex items-center gap-2 text-sm font-medium text-text">
          <IconShield size={15} className="shrink-0 text-warning" />
          {verb}
        </span>
        {call.diff ? (
          <DiffView lines={call.diff.lines} />
        ) : (
          <pre className="m-0 overflow-x-auto rounded-md bg-surface-inset px-3 py-2 font-mono text-xs leading-[20px] whitespace-pre-wrap text-text ring-1 ring-inset ring-border-subtle">
            {call.kind === 'execute' && <span className="text-text-tertiary select-none">$ </span>}
            {call.title}
          </pre>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2 pt-2 pb-2">
        <Choice n={1} on={false} label="Yes" onPick={() => onAnswer('allow')} />
        <Choice
          n={2}
          on={false}
          label={
            call.kind === 'edit' ? (
              'Yes, and allow edits for the rest of this thread'
            ) : (
              <>
                Yes, and don’t ask again for <span className="font-mono text-xs">{first}</span> in this project
              </>
            )
          }
          onPick={() => onAnswer('always')}
        />
        <OtherChoice
          n={3}
          value={instead}
          onChange={setInstead}
          placeholder="No, and tell the agent what to do instead"
          onEnter={() => onAnswer('deny', instead)}
        />
      </div>
      <DockFooter
        left={
          <>
            <Kbd>1</Kbd> <Kbd>2</Kbd> to answer · <Kbd>Esc</Kbd> to deny
          </>
        }
      >
        <Button variant="ghost" size="sm" onClick={() => onAnswer('deny', instead || undefined)}>
          Deny
        </Button>
      </DockFooter>
    </div>
  )
}

/** The head of an MCP server's dock: which server asks, then what it says. */
function ServerAsks({ server, icon, message }: { server?: string; icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 pt-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary">
        {icon}
        {server ?? 'An MCP server'} asks
      </span>
      <span className="text-base text-text">{message}</span>
    </div>
  )
}

/** A form field's value while it is filled: numbers stay text until sent. */
type Draft = Record<string, string | boolean>

const draftOf = (fields: FormField[]): Draft =>
  Object.fromEntries(
    fields.map((f) => [f.key, f.type === 'boolean' ? (f.default ?? false) : f.default === undefined ? '' : String(f.default)]),
  )

/** The field's problem, if it has one: a required one left empty, or a number that is not one. */
function problemOf(f: FormField, v: string | boolean): string | undefined {
  if (typeof v === 'boolean') return undefined
  if (!v.trim()) return f.required ? 'Required' : undefined
  if (f.type === 'number' && (!Number.isFinite(Number(v)) || (f.integer && !Number.isInteger(Number(v))))) return f.integer ? 'A whole number' : 'A number'
  return undefined
}

const INPUT_TYPE = { email: 'email', uri: 'url', date: 'date' } as const

/**
 * An MCP server asks for a form (an ACP form elicitation): its fields as
 * simple controls — text, a number, a yes/no, one choice of several — then
 * Submit, or Decline. Required fields are checked before it goes.
 */
export function FormDock({
  server,
  message,
  fields,
  onSubmit,
  onDecline,
}: {
  server?: string
  message: string
  fields: FormField[]
  onSubmit: (values: FormValues) => void
  onDecline: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(fields))
  const [checked, setChecked] = useState(false)
  const box = useRef<HTMLFormElement>(null)
  useEffect(() => box.current?.focus(), [])
  const set = (key: string, v: string | boolean) => setDraft((d) => ({ ...d, [key]: v }))

  const submit = () => {
    setChecked(true)
    if (fields.some((f) => problemOf(f, draft[f.key]))) return
    const values: FormValues = {}
    for (const f of fields) {
      const v = draft[f.key]
      if (typeof v === 'boolean') values[f.key] = v
      else if (v.trim()) values[f.key] = f.type === 'number' ? Number(v) : v
    }
    onSubmit(values)
  }

  const control = (f: FormField, invalid: boolean) => {
    const v = draft[f.key]
    switch (f.type) {
      case 'boolean':
        return <Checkbox size="md" checked={v === true} onChange={(on) => set(f.key, on)} label={f.title} />
      case 'enum':
        return (
          <div role="radiogroup" aria-label={f.title} className="-mx-2.5 flex flex-col gap-0.5">
            {f.options.map((o, i) => (
              <Choice key={o.value} n={i + 1} on={v === o.value} label={o.label} onPick={() => set(f.key, o.value)} />
            ))}
          </div>
        )
      default:
        return (
          <TextField
            type={f.type === 'number' ? 'number' : f.format ? INPUT_TYPE[f.format] : 'text'}
            {...(f.type === 'number' && f.integer ? { step: 1 } : {})}
            value={typeof v === 'string' ? v : ''}
            onChange={(e) => set(f.key, e.target.value)}
            invalid={invalid}
            required={f.required}
          />
        )
    }
  }

  return (
    <form
      ref={box}
      tabIndex={-1}
      noValidate
      aria-label="An MCP server asks"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDecline()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className={cx(DOCK, 'outline-none')}
    >
      <ServerAsks server={server} icon={<IconCube size={12} className="text-icon" />} message={message} />
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-3">
        {fields.map((f) => {
          const problem = checked ? problemOf(f, draft[f.key]) : undefined
          return f.type === 'boolean' ? (
            <div key={f.key} className="flex flex-col gap-1">
              {control(f, false)}
              {f.description && <span className="text-xs text-text-tertiary">{f.description}</span>}
            </div>
          ) : (
            <Field
              key={f.key}
              label={
                <>
                  {f.title}
                  {f.required && <span className="text-text-tertiary"> · required</span>}
                </>
              }
              {...(f.description ? { help: f.description } : {})}
              {...(problem ? { error: problem } : {})}
            >
              {control(f, problem !== undefined)}
            </Field>
          )
        })}
      </div>
      <DockFooter
        left={
          <>
            <Kbd>Enter</Kbd> to submit · <Kbd>Esc</Kbd> to decline
          </>
        }
      >
        <Button variant="ghost" size="sm" onClick={onDecline}>
          Decline
        </Button>
        <Button type="submit" variant="primary" size="sm" icon={<IconCheck />}>
          Submit
        </Button>
      </DockFooter>
    </form>
  )
}

/**
 * An MCP server asks the human to open a page (an ACP URL elicitation: a
 * sign-in, a consent) and say when it is done — Done, or Decline.
 */
export function LinkDock({
  server,
  message,
  url,
  onDone,
  onDecline,
}: {
  server?: string
  message: string
  url: string
  onDone: () => void
  onDecline: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  return (
    <div
      ref={box}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDecline()
      }}
      role="group"
      aria-label="An MCP server asks"
      className={cx(DOCK, 'outline-none')}
    >
      <ServerAsks server={server} icon={<IconCube size={12} className="text-icon" />} message={message} />
      <div className="px-4 pt-2 pb-3">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cx(
            LINK,
            'flex min-w-0 items-center gap-2 rounded-md bg-surface-inset px-3 py-2 font-mono text-xs ring-1 ring-inset ring-border-subtle',
          )}
        >
          <IconExternalLink size={13} className="shrink-0" />
          <span className="min-w-0 truncate">{url}</span>
        </a>
      </div>
      <DockFooter
        left={
          <>
            Open it, then say when you are done · <Kbd>Esc</Kbd> to decline
          </>
        }
      >
        <Button variant="ghost" size="sm" onClick={onDecline}>
          Decline
        </Button>
        <Button variant="primary" size="sm" icon={<IconCheck />} onClick={onDone}>
          Done
        </Button>
      </DockFooter>
    </div>
  )
}
