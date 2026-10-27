import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => Promise<void>)[] = []

/** Runs `fn` in an async act scope, so effects and the updates they schedule settle before it resolves. */
export async function actAsync(fn: () => unknown): Promise<void> {
  await act(async () => {
    await fn()
  })
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** Renders into a fresh container with react-dom and waits for effects. Unmounted after each test. */
export async function render(ui: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await actAsync(() => root.render(ui))
  const unmount = async (): Promise<void> => {
    await actAsync(() => root.unmount())
    container.remove()
  }
  cleanups.push(unmount)
  return {
    container,
    rerender: (next: ReactNode) => actAsync(() => root.render(next)),
    unmount,
  }
}

/** Lets pending promises and the React updates they cause settle. */
export async function settled(): Promise<void> {
  for (let i = 0; i < 5; i++) await actAsync(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to click')
  await actAsync(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export async function key(element: Element | null | undefined, name: string): Promise<void> {
  if (!element) throw new Error('nothing to press')
  await actAsync(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  })
}

/** Sets the value of an input, textarea or select the way a user would, so React sees the change. */
export async function fill(element: Element | null | undefined, value: string): Promise<void> {
  if (!element) throw new Error('nothing to fill')
  // React tracks the value property, so set it through the prototype setter like a browser does.
  const proto = Object.getPrototypeOf(element) as object
  await actAsync(() => {
    Reflect.set(proto, 'value', value, element)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

export async function submit(form: Element | null | undefined): Promise<void> {
  if (!(form instanceof HTMLFormElement)) throw new Error('not a form')
  await actAsync(() => {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  })
}

/** The element whose text content is exactly `text` (trimmed), matching `selector`. */
export function byText(container: Element, text: string, selector = '*'): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent.trim() === text)
}

/** The form control labelled `label`, via a wrapping label or aria-label. */
export function byLabel(container: Element, label: string): HTMLInputElement | undefined {
  const aria = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
  if (aria) return aria
  const wrapper = [...container.querySelectorAll('label')].find(
    (l) => l.querySelector('.analytik-field-label')?.textContent === label || l.textContent.trim() === label,
  )
  return wrapper?.querySelector<HTMLInputElement>('input, select, textarea') ?? undefined
}
