import { cx } from '../ui'
import { Tooltip } from '../ui/tooltip'
import { EPIC_COLOR_NAME, EPIC_COLORS, EPIC_ICONS, EpicIcon, epicStyle, type EpicColor, type EpicIconId } from '../lib/epic-look'

/**
 * The epic menu's "Colour and icon…" (epics-that-look-alive decision 3): the
 * eight colours as swatches over the icon list, each icon drawn in the chosen
 * colour. A pick applies at once; an icon the human picks is never changed by
 * the orchestrator again. The body only — the caller puts it in a
 * `PopoverContent` anchored to the epic.
 */
export function EpicLookPicker({
  color,
  icon,
  onColor,
  onIcon,
}: {
  color: EpicColor
  icon: EpicIconId | null
  onColor: (c: EpicColor) => void
  onIcon: (i: EpicIconId) => void
}) {
  return (
    <div style={epicStyle(color)} className="flex w-[244px] flex-col gap-3 p-2">
      <div role="radiogroup" aria-label="Colour" className="flex flex-col gap-2">
        <span className="text-xs font-medium text-text-tertiary">Colour</span>
        <div className="flex items-center justify-between px-0.5">
          {EPIC_COLORS.map((c) => {
            const on = c === color
            return (
              <Tooltip key={c} label={EPIC_COLOR_NAME[c]}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={EPIC_COLOR_NAME[c]}
                  onClick={() => onColor(c)}
                  style={epicStyle(c)}
                  className={cx(
                    'size-5 cursor-pointer rounded-full bg-(--epic) transition-shadow duration-(--dur-1) ease-app',
                    on
                      ? 'shadow-[0_0_0_2px_var(--color-surface-raised),0_0_0_3.5px_var(--epic)]'
                      : 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-text)_10%,transparent)] hover:shadow-[0_0_0_2px_var(--color-surface-raised),0_0_0_3.5px_color-mix(in_oklab,var(--epic)_45%,transparent)]',
                  )}
                />
              </Tooltip>
            )
          })}
        </div>
      </div>
      <div role="radiogroup" aria-label="Icon" className="flex flex-col gap-2">
        <span className="text-xs font-medium text-text-tertiary">Icon</span>
        <div className="grid grid-cols-6 gap-1">
          {EPIC_ICONS.map((x) => {
            const on = x.id === icon
            return (
              <Tooltip key={x.id} label={x.label}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={x.label}
                  onClick={() => onIcon(x.id)}
                  className={cx(
                    'inline-flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors duration-(--dur-1) ease-app',
                    on
                      ? 'bg-[color-mix(in_oklab,var(--epic)_20%,transparent)] text-(--epic-text) ring-1 ring-[color-mix(in_oklab,var(--epic)_45%,transparent)] ring-inset'
                      : 'text-text-tertiary hover:bg-surface-hover hover:text-(--epic-text)',
                  )}
                >
                  <EpicIcon icon={x.id} size={16} />
                </button>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
