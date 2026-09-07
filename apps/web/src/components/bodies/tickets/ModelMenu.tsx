import type { ModelEntry } from '@runcastle/core'
import { modelOptionGroups, RUNTIME_LABEL } from '../../../lib/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../../ui/select'

/**
 * Which model a ticket burns on — per row, and once over the whole ledger for
 * every pending ticket at once. `''` is the project's own model, which is why
 * it is a row of the list rather than an absence.
 *
 * The list is the `Select` primitive's, so it is portalled: this opens inside a
 * ticket card that clips its own overflow, and the hand-rolled menu it replaced
 * turned that card scrollable around itself.
 */
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
  const entry = roster.find((model) => model.id === value)
  // The closed pill says the runtime a model launches, where the row in the
  // list says the use-case note instead — so the trigger states its own text
  // rather than echoing the row it points at. A `label` overrides it outright:
  // the bulk control names what it acts on, there being no one value across
  // every pending ticket.
  const triggerText =
    label ?? (entry ? `${entry.id} · ${RUNTIME_LABEL[entry.runtime]}` : value || 'default model')
  // Named, not left to its own text: `combobox` takes no accessible name from
  // its content, so a trigger holding only the current value would read out as
  // an unnamed control.
  const name = label ?? 'Ticket model'

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={name}
        disabled={disabled}
        className="h-7 rounded-pill border border-hairline bg-transparent px-2 font-mono text-xs text-text-2 hover:border-hairline-strong hover:text-text disabled:opacity-40"
      >
        <SelectValue>{triggerText}</SelectValue>
      </SelectTrigger>
      <SelectContent aria-label={name} className="min-w-64 text-xs">
        <SelectItem value="">default (project model)</SelectItem>
        {modelOptionGroups(roster).map((group) => (
          <SelectGroup key={group.runtime}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.entries.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.note ? `${model.id} — ${model.note}` : model.id}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
