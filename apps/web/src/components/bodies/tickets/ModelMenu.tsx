import { useEffect, useRef, useState } from 'react'
import type { ModelEntry } from '@runcastle/core'
import { modelOptionGroups, RUNTIME_LABEL } from '../../../lib/settings'

export function ModelMenu({
  value,
  roster,
  onChange,
  disabled = false,
  label,
}: {
  value: string
  roster: readonly ModelEntry[]
  onChange: (id: string) => void
  disabled?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const entry = roster.find((model) => model.id === value)
  const options = ['', ...modelOptionGroups(roster).flatMap((group) => group.entries.map((model) => model.id))]

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current.get(value)?.focus()
  }, [open, value])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    triggerRef.current?.focus()
  }
  const option = (id: string, text: string, index: number) => (
    <button
      key={id || 'default'}
      ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id) }}
      type="button"
      role="option"
      aria-selected={id === value}
      className={`flex w-full justify-between gap-3 rounded-sm border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-accent-soft hover:text-text ${id === value ? 'text-accent-hi' : 'text-text-2'}`}
      onClick={() => pick(id)}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        optionRefs.current.get(options[next] ?? '')?.focus()
      }}
    >
      <span>{text}</span>{id === value && <span aria-hidden>✓</span>}
    </button>
  )

  const triggerText = label ?? (entry ? `${entry.id} · ${RUNTIME_LABEL[entry.runtime]}` : value ? value : 'default model')
  return (
    <div ref={rootRef} className="relative inline-flex">
      <button ref={triggerRef} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} className="inline-flex h-7 items-center rounded-pill border border-hairline bg-transparent px-2 font-mono text-xs text-text-2 hover:border-hairline-strong hover:text-text disabled:opacity-40" onClick={() => setOpen((current) => !current)}>
        {triggerText} ▾
      </button>
      {open && <div role="listbox" aria-label={label ?? 'Ticket model'} className="absolute top-full right-0 z-30 mt-1 min-w-64 rounded-md border border-hairline bg-panel-3 p-1 font-mono text-xs shadow-menu">
        {option('', 'default (project model)', 0)}
        {modelOptionGroups(roster).map((group) => <div key={group.runtime}>
          <div className="px-2.5 pt-2 pb-1 text-xs uppercase tracking-wider text-text-4">{group.label}</div>
          {group.entries.map((model) => option(model.id, model.note ? `${model.id} — ${model.note}` : model.id, options.indexOf(model.id)))}
        </div>)}
      </div>}
    </div>
  )
}
