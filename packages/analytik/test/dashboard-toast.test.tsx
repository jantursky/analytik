import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider, useToast } from '../src/dashboard/ui/toast'
import { waitFor } from './dashboard-helpers'
import { actAsync, click, render } from './react-render'

function Buttons() {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast?.('Copied')}>
        good
      </button>
      <button type="button" onClick={() => toast?.('Copy failed', false)}>
        bad
      </button>
    </>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('toasts', () => {
  it('show a message for a moment, replace the one before, and mark failures as alerts', async () => {
    const { container } = await render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>,
    )
    const toasts = (): Element[] => [...document.querySelectorAll('.analytik-toast')]
    await click(container.querySelector('button'))
    expect(toasts().map((t) => t.textContent)).toEqual(['Copied'])
    await click(container.querySelectorAll('button')[1])
    await waitFor(() => (toasts().length === 1 && toasts()[0]?.textContent === 'Copy failed' ? true : null))
    expect(toasts()[0]?.getAttribute('role')).toBe('alert')
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 2600)))
    await waitFor(() => (toasts().length === 0 ? true : null), 100)
  })

  it('leave nothing running when the page goes away', async () => {
    vi.useFakeTimers()
    const view = await render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>,
    )
    await click(view.container.querySelector('button'))
    await view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('are absent outside a provider', async () => {
    const { container } = await render(<Buttons />)
    await click(container.querySelector('button'))
    expect(document.querySelector('.analytik-toast')).toBeNull()
  })
})
