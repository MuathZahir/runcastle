import { useEffect, useRef, useState } from 'react'
import type { FeatureFull } from '../lib/api'

export function DocsMenu({ docs, value, onPick }: { docs: FeatureFull['docs']; value?: string; onPick: (relPath: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const label = value?.split(/[\\/]/).pop() ?? 'docs'
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); triggerRef.current?.focus() } }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [open])
  const pick = (relPath: string) => { onPick(relPath); setOpen(false); triggerRef.current?.focus() }
  return (
    <div ref={rootRef} className="relative ml-auto inline-flex">
      <button ref={triggerRef} type="button" className="h-8 rounded-md px-2 font-mono text-xs text-text-3 hover:bg-panel-3 hover:text-text" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label} ▾</button>
      {open && <div role="listbox" className="absolute top-full right-0 z-20 mt-1 min-w-40 rounded-md border border-hairline bg-panel-3 p-1 font-mono text-xs shadow-menu">
        {docs.map((doc) => <button key={doc.relPath} type="button" role="option" aria-selected={doc.relPath === value} className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-text-2 hover:bg-accent-soft hover:text-text" onClick={() => pick(doc.relPath)}>{doc.title || doc.relPath.split(/[\\/]/).pop()}</button>)}
      </div>}
    </div>
  )
}
