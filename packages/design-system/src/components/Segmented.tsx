export interface SegmentedOption {
  /** Text shown in the segment. */
  label: string
  /** Value reported to `onChange` when this segment is selected. */
  value: string
}

export interface SegmentedProps {
  /** Ordered segments, left to right. */
  options: SegmentedOption[]
  /** The currently selected value. */
  value: string
  /** Called with the value of a clicked segment. */
  onChange?: (value: string) => void
  /** Accessible group label. */
  'aria-label'?: string
}

/**
 * A compact mono segmented control — a size or mode switch. The active segment
 * fills violet; the rest are dim mono. Fully controlled: pass `value` and
 * handle `onChange`.
 */
export function Segmented({ options, value, onChange, ...rest }: SegmentedProps) {
  return (
    <div className="segmented" role="group" {...rest}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? 'is-on' : ''}
          aria-pressed={opt.value === value}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
