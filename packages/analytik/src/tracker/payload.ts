import type { Props } from '../shared/types'

const MAX_PROPS = 30

export const clip = (value: unknown, max: number): string => String(value).slice(0, max)

/**
 * Keeps at most 30 props with keys up to 64 and string values up to 255 characters.
 * Values other than strings, finite numbers, booleans and null are dropped. Returns undefined when nothing is left.
 */
export function sanitizeProps(input?: Record<string, unknown> | null): Props | undefined {
  let out: Props | undefined
  let count = 0
  for (const key in input) {
    const value = input[key]
    const type = typeof value
    if (count >= MAX_PROPS) break
    if (type === 'string' || value === null || type === 'boolean' || (type === 'number' && isFinite(value as number))) {
      out ??= {}
      out[clip(key, 64)] = type === 'string' ? clip(value, 255) : (value as Props[string])
      count++
    }
  }
  return out
}

/** Props declared on an element as `data-analytik-plan="pro"`. */
export function attributeProps(el: Element): Props | undefined {
  const props: Record<string, string> = {}
  for (const { name, value } of el.attributes) {
    const key = /^data-analytik-(.+)$/.exec(name)?.[1]
    if (key && name !== 'data-analytik-event') props[key] = value
  }
  return sanitizeProps(props)
}
