import { motion } from 'motion/react'
import { type SubmitEvent, useState } from 'react'

import type { Funnel, FunnelResult, FunnelStep } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber, formatPercent } from '../format'
import { Card, ConfirmButton, Field, Status } from '../ui'
import { EASE, View } from '../ui/motion'
import { Select, type SelectOption } from '../ui/select'

function FunnelSteps({ funnel }: { funnel: Funnel }) {
  const { client, site, query } = useDashboard()
  const result = useResource<FunnelResult>(requestKey('funnel', site.id, funnel.id, query), () =>
    client.funnel(site.id, funnel.id, query),
  )
  const first = result.data?.steps[0]?.visitors ?? 0
  return (
    <Status loading={result.loading} error={result.error}>
      <ol className="analytik-funnel" aria-label={`${funnel.name} steps`}>
        {result.data?.steps.map((step, i) => {
          const share = first ? step.visitors / first : 0
          return (
            <li key={`${i}-${step.match}`}>
              <motion.span
                className="analytik-funnel-bar"
                initial={{ width: 0 }}
                animate={{ width: `${share * 100}%` }}
                transition={{ duration: 0.7, ease: EASE, delay: i * 0.08 }}
                aria-hidden="true"
              />
              <span className="analytik-bar-label">
                {i + 1}. {step.match}
              </span>
              <span className="analytik-bar-value">
                {formatNumber(step.visitors)} · {formatPercent(share)}
                {step.dropOff != null && i > 0 && (
                  <span className="analytik-muted"> · {formatPercent(step.dropOff)} dropped</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </Status>
  )
}

const emptyStep = (): FunnelStep => ({ type: 'page', match: '' })

const STEP_TYPES: SelectOption<FunnelStep['type']>[] = [
  { value: 'page', label: 'Page' },
  { value: 'goal', label: 'Goal' },
]

function FunnelForm({ onCreated }: { onCreated: (funnel: Funnel) => void }) {
  const { client, site } = useDashboard()
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<FunnelStep[]>([emptyStep(), emptyStep()])
  const [error, setError] = useState('')
  const update = (index: number, patch: Partial<FunnelStep>): void =>
    setSteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const valid = steps.filter((s) => s.match.trim())
    if (valid.length < 2) {
      setError('A funnel needs at least two steps.')
      return
    }
    client.createFunnel(site.id, { name: name.trim(), steps: valid }).then(
      (funnel) => {
        setName('')
        setSteps([emptyStep(), emptyStep()])
        setError('')
        onCreated(funnel)
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )
  }

  return (
    <form className="analytik-form" onSubmit={submit}>
      <Field label="Funnel name">
        <input className="analytik-input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      {steps.map((step, i) => (
        <fieldset key={i} className="analytik-row">
          <legend className="analytik-sr-only">Step {i + 1}</legend>
          <Select
            label={`Step ${i + 1}`}
            value={step.type}
            options={STEP_TYPES}
            onChange={(type) => update(i, { type })}
          />
          <Field label={step.type === 'page' ? 'Path (trailing * matches a prefix)' : 'Goal name'}>
            <input
              className="analytik-input"
              value={step.match}
              placeholder={step.type === 'page' ? '/pricing' : 'signup'}
              onChange={(e) => update(i, { match: e.target.value })}
            />
          </Field>
          {steps.length > 2 && (
            <button
              type="button"
              className="analytik-button"
              onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              aria-label={`Remove step ${i + 1}`}
            >
              Remove
            </button>
          )}
        </fieldset>
      ))}
      {error && (
        <p className="analytik-error" role="alert">
          {error}
        </p>
      )}
      <div className="analytik-actions">
        <button type="button" className="analytik-button" onClick={() => setSteps([...steps, emptyStep()])}>
          Add step
        </button>
        <button type="submit" className="analytik-button" data-variant="primary">
          Create funnel
        </button>
      </div>
    </form>
  )
}

export function Funnels() {
  const { client, site } = useDashboard()
  const funnels = useResource<Funnel[]>(requestKey('funnels', site.id), () => client.funnels(site.id))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = funnels.data ?? []
  const selected = list.find((f) => f.id === selectedId) ?? list[0]

  return (
    <View>
      <Status loading={funnels.loading && !funnels.data} error={funnels.error}>
        {selected ? (
          <Card
            title={selected.name}
            actions={
              <div className="analytik-actions">
                {list.length > 1 && (
                  <Select
                    label="Funnel"
                    hideLabel
                    className="analytik-pill"
                    value={selected.id}
                    options={list.map((f) => ({ value: f.id, label: f.name }))}
                    onChange={setSelectedId}
                  />
                )}
                <ConfirmButton
                  label="Delete"
                  title={`Delete the funnel “${selected.name}”?`}
                  description="The funnel definition is removed. The visits and events it counted stay."
                  confirmLabel="Delete funnel"
                  onConfirm={() => void client.deleteFunnel(site.id, selected.id).then(funnels.reload)}
                />
              </div>
            }
          >
            <FunnelSteps funnel={selected} />
          </Card>
        ) : (
          <p className="analytik-empty">No funnels yet. Create one to see where visitors drop off.</p>
        )}
      </Status>
      <Card title="New funnel">
        <FunnelForm
          onCreated={(funnel) => {
            setSelectedId(funnel.id)
            funnels.reload()
          }}
        />
      </Card>
    </View>
  )
}
