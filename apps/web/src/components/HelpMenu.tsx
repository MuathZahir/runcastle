import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { IconButton } from '../ui'
import { IconHelp, IconList, IconPhone } from '../icons'

/**
 * The help menu in the sidebar's bottom row (ready-to-publish decisions 9 and
 * 16): one question-mark icon beside Settings, theme and notifications, with
 * the Glossary and the way onto your phone. The phone entry is left out on a
 * phone, which is already there.
 */
export function HelpMenu({
  onOpenGlossary,
  onOpenPhoneSetup,
}: {
  onOpenGlossary: () => void
  /** Absent on a phone. */
  onOpenPhoneSetup?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" label="Help" icon={<IconHelp />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuItem icon={<IconList />} onSelect={onOpenGlossary}>
          Glossary
        </DropdownMenuItem>
        {onOpenPhoneSetup && (
          <DropdownMenuItem icon={<IconPhone />} onSelect={onOpenPhoneSetup}>
            Use runcastle on your phone
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
