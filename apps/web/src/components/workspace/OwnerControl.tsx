import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { IconCheck, IconChevronDown, IconOrchestrator, IconUser } from '../../icons'
import { cx } from '../../ui'
import { Tooltip } from '../../ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import { FLOATING_ITEM, FLOATING_ITEM_DEFAULT } from '../../ui/floating'

/**
 * Who owns a feature (every-feature-has-one-owner decisions 1, 11): the human,
 * or one orchestrator chat — and then how far that chat takes it, shown to the
 * human before merging or merged by itself.
 */
export type FeatureOwner = { kind: 'you' } | { kind: 'chat'; name: string; finish: 'show' | 'merge' }

/** What the owner menu offers: take it, or give it to the chat with one of its two finishes. */
export type OwnerChoice = 'you' | 'show' | 'merge'

/** Every word the control says, so a design can try another set (decision 12). */
export interface OwnerLabels {
  /** The button, human-owned. */
  you: string
  /** The button while the human grills a feature the chat takes after the plan (decision 14). */
  planning: (chat: string) => string
  /** The button's words after the chat's name. */
  show: string
  merge: string
  /** The menu's three choices, each with its one line under it. */
  chooseYou: string
  chooseShow: (chat: string) => string
  chooseMerge: (chat: string) => string
  hintYou: string
  hintShow: string
  hintMerge: string
  /** The hover of a feature with no chat to hand it to (decision 21). */
  noChat: (feature: string) => string
}

/** The button's words while the human plans a feature its epic's chat takes after the plan, drawn after the epic's name. */
const IN_EPIC_PLANNING = 'yours to plan first'

/** The words the control ships with (decision 12). */
export const OWNER_LABELS: OwnerLabels = {
  you: 'Yours',
  planning: (chat) => `Yours to plan · then ${chat}`,
  show: 'you merge',
  merge: 'merges it',
  chooseYou: "I'll finish it",
  chooseShow: (chat) => `${chat} builds it and shows me before merging`,
  chooseMerge: (chat) => `${chat} builds and merges it`,
  hintYou: 'You talk to its agent, test it and merge it.',
  hintShow: 'It plans or builds, gets it reviewed, and asks you to test before merging.',
  hintMerge: 'It merges once the review is clean and the checks pass.',
  noChat: (feature) => `Yours. To hand it to an epic, tell its chat: run “${feature}” for me.`,
}

/**
 * The owner control at the start of the feature header's trail (decision 11):
 * a compact button saying who owns the feature — "Yours", "Notes triage · you
 * merge", "Notes triage · merges it" — that opens a short menu of three
 * choices, each spelled out in full. The chat's name truncates; the words
 * after it never do (decision 12). Picking
 * "I'll finish it" takes the feature; picking a chat's choice hands it back.
 * There is no other hand-back button and no other how-far setting.
 *
 * `owner` is the choice in force. While the human grills a feature whose
 * choice is a chat's (`planning`), the button reads "Yours to plan · then
 * <chat>" and the menu still marks the chat's choice, which takes effect at
 * the plan's yes (decision 14). With no `chatName` the feature has no chat to
 * hand it to: the control reads "Yours", does not open, and its hover says how
 * to give it to a chat (decision 21). Props only: the caller owns the data and
 * the mutation.
 */
export function OwnerControl({
  owner,
  chatName,
  planning = false,
  feature,
  labels: overrides,
  inEpic = false,
  onChoose,
}: {
  owner: FeatureOwner
  /** The feature's remembered chat, which its chat choices name; absent for a feature made outside a chat. */
  chatName?: string
  /** Grilled with the human and not yet planned; the chat takes it after the plan. */
  planning?: boolean
  /** The feature's title, for the no-chat hover ("run … for me"). */
  feature?: string
  /** Another set of words, for a design to compare (decision 12). */
  labels?: Partial<OwnerLabels>
  /**
   * Drawn right after its own epic's name, in one crumb (orchestrator-chats-become-epics
   * decision 15): a chat owner's name and glyph go, leaving the finish words
   * ("you merge", "merges it", "yours to plan first").
   */
  inEpic?: boolean
  onChoose: (choice: OwnerChoice) => void
}) {
  const w: OwnerLabels = { ...OWNER_LABELS, ...overrides }
  const chat = owner.kind === 'chat' ? owner.name : chatName
  const current: OwnerChoice = owner.kind === 'chat' ? owner.finish : 'you'

  const finishWords = owner.kind === 'chat' ? (owner.finish === 'show' ? w.show : w.merge) : ''
  const nameless = inEpic && owner.kind === 'chat'
  const lead = nameless
    ? planning
      ? IN_EPIC_PLANNING
      : finishWords
    : owner.kind === 'you'
      ? w.you
      : planning
        ? w.planning(owner.name)
        : owner.name
  const tail = !nameless && owner.kind === 'chat' && !planning ? ` · ${finishWords}` : ''
  const words = lead + tail
  const icon = nameless ? null : owner.kind === 'chat' && !planning ? <IconOrchestrator size={14} /> : <IconUser size={14} />
  // The crumb that holds the control clips its overflow, so the focus ring is drawn inside the control's edge.
  // It keeps its width while the title and thread give way; its own cap is what truncates the chat's name.
  const look =
    'inline-flex h-6 max-w-56 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-text-tertiary focus-visible:outline-offset-[-2px]!'

  if (!chat) {
    return (
      <Tooltip label={w.noChat(feature ?? 'this feature')} side="bottom" align="start">
        {/* Focusable so the hint reaches a keyboard too; nothing opens. */}
        <span data-owner-control="" tabIndex={0} className={look}>
          <span className="inline-flex shrink-0 text-icon">{icon}</span>
          <span className="min-w-0 truncate">{words}</span>
        </span>
      </Tooltip>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-owner-control=""
          title={`Who finishes this feature: ${nameless && owner.kind === 'chat' ? `${owner.name} · ${words}` : words}`}
          className={cx(
            look,
            'group/owner cursor-pointer',
            'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text',
            'data-[state=open]:bg-surface-selected data-[state=open]:text-text',
          )}
        >
          {icon && <span className="inline-flex shrink-0 text-icon">{icon}</span>}
          {/* One run of words: the tail's own space is the only gap after the name. */}
          <span className="flex min-w-0">
            <span className="min-w-0 truncate">{lead}</span>
            {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
          </span>
          <IconChevronDown size={12} className="shrink-0 text-icon" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <OwnerChoices current={current} chat={chat} labels={w} onChoose={onChoose} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The menu's three choices, the held one checked: the owner control's whole
 * menu, and the same choices in the feature row's "…" menu (decision 11). Must
 * sit inside a `DropdownMenuContent`.
 */
export function OwnerChoices({
  current,
  chat,
  labels,
  onChoose,
}: {
  current: OwnerChoice
  /** The feature's chat, which the two chat choices name. */
  chat: string
  labels?: Partial<OwnerLabels>
  onChoose: (choice: OwnerChoice) => void
}) {
  const w: OwnerLabels = { ...OWNER_LABELS, ...labels }
  return (
    <DropdownMenuPrimitive.RadioGroup
      value={current}
      onValueChange={(v) => {
        if (v !== current) onChoose(v as OwnerChoice)
      }}
    >
      <OwnerOption value="you" label={w.chooseYou} hint={w.hintYou} />
      <OwnerOption value="show" label={w.chooseShow(chat)} hint={w.hintShow} />
      <OwnerOption value="merge" label={w.chooseMerge(chat)} hint={w.hintMerge} />
    </DropdownMenuPrimitive.RadioGroup>
  )
}

/**
 * One choice: the menu's own row (`FLOATING_ITEM`), a radio item so the held
 * choice is announced as checked, its check in the leading column and its one
 * line under the label. A `DropdownMenuRadioItem` primitive would hold this if
 * a second menu ever needs a checked choice.
 */
function OwnerOption({ value, label, hint }: { value: OwnerChoice; label: ReactNode; hint: string }) {
  return (
    <DropdownMenuPrimitive.RadioItem value={value} className={cx(FLOATING_ITEM, FLOATING_ITEM_DEFAULT)}>
      <span className="mt-1.5 inline-flex size-4 shrink-0 self-start">
        <DropdownMenuPrimitive.ItemIndicator>
          <IconCheck size={16} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
        <span className="text-text">{label}</span>
        <span className="text-xs text-pretty text-text-tertiary">{hint}</span>
      </span>
    </DropdownMenuPrimitive.RadioItem>
  )
}
