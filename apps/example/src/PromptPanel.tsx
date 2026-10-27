import { useId } from 'react'
import type { SimpleIcon } from 'simple-icons'

import { CopyButton } from './components'
import { iconColors } from './lib/icons'

interface Option<Id extends string> {
  id: Id
  label: string
}

interface PromptPanelProps<Id extends string> {
  title: string
  description: string
  options: readonly Option<Id>[]
  icons: Record<Id, readonly SimpleIcon[]>
  value: Id
  onChange: (id: Id) => void
  prompt: string
}

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  const { light, dark } = iconColors(icon.hex)
  return (
    <svg
      className="brand-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      style={{ '--icon-light': light, '--icon-dark': dark } as React.CSSProperties}
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  )
}

/** A picker of icon tiles (a radio group) and the prompt it produces, with a preview and a copy button. */
export function PromptPanel<Id extends string>({
  title,
  description,
  options,
  icons,
  value,
  onChange,
  prompt,
}: PromptPanelProps<Id>) {
  const name = useId()
  const headingId = useId()
  const previewId = useId()
  const label = options.find((option) => option.id === value)?.label ?? value
  return (
    <section className="prompt card" aria-labelledby={headingId}>
      <div className="prompt__head">
        <h3 id={headingId}>{title}</h3>
        <p className="muted">{description}</p>
      </div>
      <fieldset className="tiles">
        <legend className="sr-only">{title}: choose a platform</legend>
        {options.map((option) => (
          <label key={option.id} className="tile">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={option.id === value}
              onChange={() => {
                onChange(option.id)
              }}
            />
            <span className="tile__icons">
              {icons[option.id].map((icon) => (
                <BrandIcon key={icon.slug} icon={icon} />
              ))}
            </span>
            <span className="tile__label">{option.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="prompt__preview">
        <div className="code__bar">
          <span id={previewId}>Prompt for {label}</span>
          <span className="row">
            <span className="faint" data-testid="prompt-count">
              {prompt.length.toLocaleString('en')} characters
            </span>
            <CopyButton text={prompt} label={`Copy the ${title.toLowerCase()} for ${label}`} primary />
          </span>
        </div>
        <pre tabIndex={0} aria-labelledby={previewId} key={value}>
          <code>{prompt}</code>
        </pre>
      </div>
    </section>
  )
}
