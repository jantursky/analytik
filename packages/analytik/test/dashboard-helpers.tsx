import { MotionGlobalConfig } from 'motion/react'

import { actAsync, click, settled } from './react-render'

// Animations finish at once, so exits unmount and tweens land on their final value within `settled()`.
MotionGlobalConfig.skipAnimations = true

// Reduced motion also switches off the Recharts animations, which would otherwise keep frames running in every test.
const matchMedia = window.matchMedia.bind(window)
const ignore = (): void => undefined
window.matchMedia = (query: string) =>
  query.includes('prefers-reduced-motion')
    ? ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: ignore,
        removeEventListener: ignore,
        dispatchEvent: () => false,
      } as unknown as MediaQueryList)
    : matchMedia(query)

// happy-dom has no layout, so every box measures 0 and Recharts would draw nothing; give chart containers a size.
const measure = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')?.value as (
  this: Element,
) => DOMRect
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  if (!this.classList.contains('recharts-responsive-container')) return measure.call(this)
  const height = parseFloat(this.style.height) || 200
  return DOMRect.fromRect({ width: 640, height })
}

/** Waits until `find` returns something, letting lazy chunks and effects settle in between. */
export async function waitFor<T>(find: () => T | null | undefined, tries = 50): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const found = find()
    if (found) return found
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
  throw new Error('waitFor timed out')
}

/** A pointer press on an element, the way Base UI list items expect it before their click. */
export async function press(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to press')
  await actAsync(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))
  })
  await click(element)
}

/** Opens a Base UI select or combobox popup from its trigger and picks the option with this text. */
export async function choose(trigger: Element | null | undefined, option: string): Promise<void> {
  await click(trigger)
  await settled()
  const item = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === option)
  await press(item)
  await settled()
}

/** The trigger of a select labelled `label` (by aria-label or a Base UI label). */
export function selectTrigger(container: Element, label: string): HTMLElement | undefined {
  const direct = container.querySelector<HTMLElement>(`[role="combobox"][aria-label="${label}"]`)
  if (direct) return direct
  const labelEl = [...container.querySelectorAll('.analytik-field-label')].find((l) => l.textContent === label)
  return labelEl?.parentElement?.querySelector<HTMLElement>('[role="combobox"]') ?? undefined
}

/** The switch whose visible label is `text`. */
export function switchFor(container: Element, text: string): HTMLElement | undefined {
  const label = [...container.querySelectorAll('.analytik-switch-field')].find((l) => l.textContent.trim() === text)
  return label?.querySelector<HTMLElement>('[role="switch"]') ?? undefined
}

/** The text input of the combobox labelled `label`. */
export function comboboxInput(container: Element, label: string): HTMLInputElement | undefined {
  const labelEl = [...container.querySelectorAll('label')].find((l) => l.textContent === label)
  const id = labelEl?.getAttribute('for')
  return id ? (container.querySelector<HTMLInputElement>(`[id="${id}"]`) ?? undefined) : undefined
}

/** Types into a text input like a person (an `insertText` input event), which is what opens a Base UI combobox. */
export async function type(input: HTMLInputElement | null | undefined, text: string): Promise<void> {
  if (!input) throw new Error('nothing to type into')
  await actAsync(() => {
    Reflect.set(HTMLInputElement.prototype, 'value', text, input)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  })
  await settled()
}
