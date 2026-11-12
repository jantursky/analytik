import { useId, useState } from 'react'

import { t } from '../i18n'
import { Icon } from '../icons'
import { Popover } from './popover'

export interface MultiOption {
  value: string
  label: string
}

/** A dropdown of checkboxes with a "select all" on top. `summary` is what the closed trigger says. */
export function MultiSelect({
  label,
  options,
  chosen,
  onChange,
  summary,
}: {
  label: string
  options: readonly MultiOption[]
  chosen: readonly string[]
  onChange: (values: string[]) => void
  summary: string
}) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const summaryId = useId()
  const all = chosen.length === options.length
  const toggle = (value: string): void =>
    onChange(chosen.includes(value) ? chosen.filter((c) => c !== value) : [...chosen, value])
  return (
    <div className="analytik-field">
      <span className="analytik-field-label" id={labelId}>
        {label}
      </span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={label}
        className="analytik-date-popup"
        trigger={
          <button
            type="button"
            className="analytik-input analytik-date-trigger"
            style={{ justifyContent: 'space-between' }}
            aria-labelledby={`${labelId} ${summaryId}`}
          >
            <span id={summaryId}>{summary}</span>
            <Icon name="down" />
          </button>
        }
      >
        <div
          className="analytik-checks analytik-multi-list"
          style={{ flexDirection: 'column', flexWrap: 'nowrap', maxHeight: 260, overflowY: 'auto' }}
        >
          <label className="analytik-check">
            <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : options.map((o) => o.value))} />
            <strong>{t('Select all')}</strong>
          </label>
          {options.map((option) => (
            <label key={option.value} className="analytik-check">
              <input type="checkbox" checked={chosen.includes(option.value)} onChange={() => toggle(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </Popover>
    </div>
  )
}
