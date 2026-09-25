import type { FeatureFull } from '../lib/api'
import { IconCheck, IconChevronDown, IconDoc } from '../icons'
import { Button, cx } from '../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * Picks which of a feature's docs the surface beside it shows (or peeks). A
 * ghost trigger naming the doc on show; the menu lists every doc by title, the
 * one on show checked. Portalled — it opens inside panes and rows that clip
 * their own overflow.
 */
export function DocsMenu({
  docs,
  value,
  onPick,
  className,
}: {
  docs: FeatureFull['docs']
  value?: string
  onPick: (relPath: string) => void
  className?: string
}) {
  const label = value?.split(/[\\/]/).pop() ?? 'Docs'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconDoc />}
          className={cx('max-w-56', className)}
          aria-label={value ? `Docs — showing ${label}` : 'Docs'}
        >
          <span className={cx('truncate', value && 'font-mono')}>{label}</span>
          <IconChevronDown size={12} className="shrink-0 text-icon" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {docs.map((doc) => (
          <DropdownMenuItem
            key={doc.relPath}
            icon={doc.relPath === value ? <IconCheck /> : <IconDoc />}
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
