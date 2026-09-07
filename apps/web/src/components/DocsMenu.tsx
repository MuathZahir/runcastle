import type { FeatureFull } from '../lib/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * Picks which of a feature's docs the surface beside it shows. Right-aligned
 * under its trigger, and portalled — it opens inside the grill's panes and the
 * ticket ledger's rows, both of which clip their own overflow.
 */
export function DocsMenu({
  docs,
  value,
  onPick,
}: {
  docs: FeatureFull['docs']
  value?: string
  onPick: (relPath: string) => void
}) {
  const label = value?.split(/[\\/]/).pop() ?? 'docs'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="ml-auto h-8 rounded-md px-2 font-mono text-xs text-text-3 hover:bg-panel-3 hover:text-text">
        {label} ▾
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {docs.map((doc) => (
          <DropdownMenuItem
            key={doc.relPath}
            aria-current={doc.relPath === value ? 'true' : undefined}
            onSelect={() => onPick(doc.relPath)}
          >
            {doc.title || doc.relPath.split(/[\\/]/).pop()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
