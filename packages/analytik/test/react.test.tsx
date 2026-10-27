import { useEffect } from 'react'
import { describe, expect, it, type Mock, vi } from 'vitest'

import { AnalytikProvider, TrackClick, useAnalytik, useTrackPageviews } from '../src/react/index'
import type { Analytik } from '../src/tracker/types'
import { click, render } from './react-render'
import { captureWire } from './tracker-harness'

const wire = captureWire('https://app.example.com/home')

function fakeClient(): { [K in keyof Analytik]: Mock<Analytik[K]> } {
  return {
    track: vi.fn(),
    revenue: vi.fn(),
    identify: vi.fn(),
    pageview: vi.fn(),
    attribution: vi.fn(() => Promise.resolve(null)),
    consent: vi.fn(),
    withdrawConsent: vi.fn(),
    optOut: vi.fn(),
    optIn: vi.fn(),
  }
}

function Signup() {
  const analytik = useAnalytik()
  return (
    <button type="button" onClick={() => analytik.track('signup', { plan: 'pro' })}>
      Sign up
    </button>
  )
}

describe('AnalytikProvider', () => {
  it('creates a client from options, queues calls made before it exists, destroys it on unmount', async () => {
    const early: { ids?: Promise<unknown> } = {}
    function Early() {
      const analytik = useAnalytik()
      // Child effects run before the provider's, so this call is queued.
      useEffect(() => {
        early.ids = analytik.attribution()
      }, [analytik])
      return null
    }
    wire.respond('/attribution', () => Response.json({ visitorId: 'v', sessionId: 's' }))
    const view = await render(
      <AnalytikProvider site="app" api="https://stats.example.net/api" requireInteraction={false}>
        <Early />
        <Signup />
      </AnalytikProvider>,
    )
    expect(await early.ids).toEqual({ analytik_visitor_id: 'v', analytik_session_id: 's' })
    await click(view.container.querySelector('button'))
    const events = (await wire.sent()).filter((s) => s.url.endsWith('/event'))
    expect(events.map((s) => [s.body.t, s.body.n, s.body.p])).toEqual([
      ['pageview', undefined, undefined],
      ['goal', 'signup', { plan: 'pro' }],
    ])
    await view.unmount()
    wire.clear()
    history.pushState({}, '', '/after-unmount')
    expect(await wire.sent()).toEqual([])
  })

  it('queues method calls of every kind until the client exists', async () => {
    const calls: string[] = []
    function Calls() {
      const a = useAnalytik()
      if (!calls.length) {
        calls.push('done')
        a.revenue('order', 5)
        a.identify({ userId: 'u' })
        a.consent()
        a.withdrawConsent()
        a.optOut()
        a.optIn()
        a.pageview()
      }
      return null
    }
    await render(
      <AnalytikProvider site="app" api="/api" requireInteraction={false} autoPageviews={false}>
        <Calls />
      </AnalytikProvider>,
    )
    expect(await wire.types()).toEqual(['revenue', 'pageview'])
  })

  it('uses a client passed in', async () => {
    const client = fakeClient()
    const view = await render(
      <AnalytikProvider client={client}>
        <Signup />
      </AnalytikProvider>,
    )
    await click(view.container.querySelector('button'))
    expect(client.track).toHaveBeenCalledWith('signup', { plan: 'pro' })
    expect(await wire.sent()).toEqual([])
  })

  it('gives a no-op client outside a provider', async () => {
    const view = await render(<Signup />)
    await click(view.container.querySelector('button'))
    expect(await wire.sent()).toEqual([])
  })
})

describe('useTrackPageviews', () => {
  function Router({ location }: { location?: Parameters<typeof useTrackPageviews>[0] }) {
    useTrackPageviews(location)
    return null
  }

  it('records a pageview whenever the router location changes', async () => {
    const client = fakeClient()
    const view = await render(
      <AnalytikProvider client={client}>
        <Router location={{ pathname: '/a', search: '?x=1' }} />
      </AnalytikProvider>,
    )
    await view.rerender(
      <AnalytikProvider client={client}>
        <Router location={{ pathname: '/a', search: '?x=1' }} />
      </AnalytikProvider>,
    )
    expect(client.pageview).toHaveBeenCalledTimes(1)
    for (const location of [
      { pathname: '/b', search: { page: 2 } },
      { pathname: '/b', href: '/b?page=3' },
      '/c',
      { pathname: '/c' },
    ]) {
      await view.rerender(
        <AnalytikProvider client={client}>
          <Router location={location} />
        </AnalytikProvider>,
      )
    }
    expect(client.pageview).toHaveBeenCalledTimes(5)
  })

  it('follows History API navigation without a location', async () => {
    const client = fakeClient()
    const view = await render(
      <AnalytikProvider client={client}>
        <Router />
      </AnalytikProvider>,
    )
    history.pushState({}, '', '/next')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(client.pageview).toHaveBeenCalledTimes(3)
    await view.unmount()
    history.pushState({}, '', '/later')
    expect(client.pageview).toHaveBeenCalledTimes(3)
  })

  it('does not double count next to automatic pageviews', async () => {
    await render(
      <AnalytikProvider site="app" api="/api" requireInteraction={false}>
        <Router />
      </AnalytikProvider>,
    )
    history.pushState({}, '', '/two')
    expect((await wire.sent()).map((s) => s.body.u)).toEqual([
      'https://app.example.com/home',
      'https://app.example.com/two',
    ])
  })
})

describe('TrackClick', () => {
  it('tracks the goal and still runs the child onClick', async () => {
    const client = fakeClient()
    const own = vi.fn()
    const view = await render(
      <AnalytikProvider client={client}>
        <TrackClick event="cta" props={{ place: 'hero' }}>
          <button type="button" onClick={own}>
            Start
          </button>
        </TrackClick>
        <TrackClick event="plain">
          <a href="#x">Plain</a>
        </TrackClick>
      </AnalytikProvider>,
    )
    await click(view.container.querySelector('button'))
    await click(view.container.querySelector('a'))
    expect(client.track.mock.calls).toEqual([
      ['cta', { place: 'hero' }],
      ['plain', undefined],
    ])
    expect(own).toHaveBeenCalledOnce()
  })
})
