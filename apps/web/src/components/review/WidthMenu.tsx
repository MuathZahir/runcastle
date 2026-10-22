import { cx } from '../../ui'
import { SELECT_GHOST, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { PREVIEW_WIDTHS, parsePreviewWidth, previewWidthLabel, type PreviewWidth } from '../../lib/preview-width'

/**
 * The screen width a previewed page lays out at, in the frame's toolbar. Closed
 * it reads the width and the scale it is drawn at (`1440 · 61%`); open it
 * offers the devices, plus a width the agent asked for that none of them is.
 */
export function WidthMenu({
  width,
  scale,
  onPick,
}: {
  width: PreviewWidth
  scale: number
  onPick: (width: PreviewWidth) => void
}) {
  const options = PREVIEW_WIDTHS.some((o) => o.width === width)
    ? PREVIEW_WIDTHS
    : [{ width, name: 'Asked for' }, ...PREVIEW_WIDTHS]
  return (
    <Select
      value={String(width)}
      onValueChange={(next) => {
        const picked = parsePreviewWidth(next)
        if (picked !== null) onPick(picked)
      }}
    >
      <SelectTrigger aria-label="Screen width" className={cx(SELECT_GHOST, 'tabular-nums')}>
        <SelectValue>{previewWidthLabel(width, scale)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" aria-label="Screen width">
        {options.map((o) => (
          <SelectItem key={o.width} value={String(o.width)}>
            {o.width === 'fit' ? o.name : `${o.name} ${o.width}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
