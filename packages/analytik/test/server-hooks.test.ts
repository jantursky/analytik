import { afterEach, describe, expect, it, vi } from 'vitest'

import { HOOK_TIMEOUT, runHook } from '../src/server/hooks'
import type { AnalytikHooks, HookEvent, StoredHookEvent } from '../src/server/types'
import type { Payment } from '../src/shared/types'
import { CHROME, type TestServer, testServer } from './helpers/server'

let server: TestServer | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await server?.close()
  server = undefined
})

const open = async (hooks?: AnalytikHooks) => {
  server = await testServer('memory', hooks ? { hooks } : {})
  const { site, apiKey } = await server.createSite()
  return { site, apiKey }
}
const send = (siteId: string, body: Record<string, unknown>) =>
  server!.event({ w: siteId, u: 'https://example.com/pricing', ...body })
const paths = async () =>
  (await server!.rows<{ path: string }>('SELECT path FROM events ORDER BY ts')).map((r) => r.path)

describe('runHook', () => {
  it('returns what the hook returns, and nothing for no hook', async () => {
    expect(await runHook('x', (n: number) => n + 1, 1)).toBe(2)
    expect(await runHook('x', (n: number) => Promise.resolve(n + 1), 1)).toBe(2)
    expect(await runHook('x', undefined, 1)).toBeUndefined()
  })

  it('logs a throwing hook and returns nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(
      await runHook(
        'boom',
        (): number => {
          throw new Error('bad')
        },
        1,
      ),
    ).toBeUndefined()
    expect(await runHook('late', (): Promise<number> => Promise.reject(new Error('bad')), 1)).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('abandons a hook that takes longer than a second', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = runHook('slow', () => new Promise<number>(() => undefined), 1)
    await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT)
    expect(await result).toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('slow took longer'))
  })
})

describe('beforeIngest', () => {
  it('changes nothing when there are no hooks', async () => {
    const { site } = await open()
    expect((await send(site.id, { t: 'pageview' })).status).toBe(202)
    expect(await paths()).toEqual(['/pricing'])
  })

  it('sees the event before it is stored and keeps it when it returns nothing', async () => {
    const seen: HookEvent[] = []
    const { site } = await open({ beforeIngest: (event) => void seen.push(event) })
    await send(site.id, { t: 'goal', n: 'signup', p: { plan: 'pro', nested: { no: 1 } } })
    expect(seen).toEqual([
      { siteId: site.id, type: 'goal', name: 'signup', path: '/pricing', props: { plan: 'pro' }, ts: server!.now },
    ])
    expect(await paths()).toEqual(['/pricing'])
  })

  it('drops an event when it returns null, and nothing else is stored', async () => {
    const { site } = await open({ beforeIngest: (event) => (event.path.startsWith('/admin') ? null : undefined) })
    const response = await server!.event({ w: site.id, t: 'pageview', u: 'https://example.com/admin/users' })
    expect(response.status).toBe(202)
    await send(site.id, { t: 'pageview' })
    expect(await paths()).toEqual(['/pricing'])
    expect(await server!.rows('SELECT id FROM sessions')).toHaveLength(1)
    const filtered = await server!.analytik.ingest({
      payload: { w: site.id, t: 'pageview', u: 'https://example.com/admin' },
      userAgent: CHROME,
      origin: 'https://example.com',
    })
    expect(filtered).toMatchObject({ status: 202, filtered: 'hook' })
  })

  it('stores a changed name, path and props, cleaned like client input', async () => {
    const { site } = await open({
      beforeIngest: (event) => ({
        ...event,
        name: 'renamed',
        path: '/changed',
        props: { plan: 'x'.repeat(600), nested: { no: 1 } } as never,
        type: 'pageview',
        siteId: 'other',
      }),
    })
    await send(site.id, { t: 'goal', n: 'signup' })
    const [row] = await server!.rows<{ name: string; path: string; props: string; type: string; site_id: string }>(
      'SELECT name, path, props, type, site_id FROM events',
    )
    expect(row).toMatchObject({ name: 'renamed', path: '/changed', type: 'goal', site_id: site.id })
    expect(JSON.parse(row!.props)).toEqual({ plan: 'x'.repeat(500) })
  })

  it('ignores a path that is not a path', async () => {
    const { site } = await open({ beforeIngest: (event) => ({ ...event, path: 'https://evil.example' }) })
    await send(site.id, { t: 'pageview' })
    expect(await paths()).toEqual(['/pricing'])
  })

  it('keeps the event when the hook throws or takes too long', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { site } = await open({
      beforeIngest: (event) => {
        if (event.path === '/pricing') throw new Error('bad')
        return new Promise<never>(() => undefined)
      },
    })
    expect((await send(site.id, { t: 'pageview' })).status).toBe(202)
    expect(await paths()).toEqual(['/pricing'])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = server!.event({ w: site.id, t: 'pageview', u: 'https://example.com/slow' })
    await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT)
    expect((await pending).status).toBe(202)
    expect(await paths()).toEqual(['/pricing', '/slow'])
    expect(log).toHaveBeenCalled()
  })

  it('is not asked about pings and sign-ins', async () => {
    const seen: string[] = []
    const { site } = await open({ beforeIngest: (event) => void seen.push(event.type) })
    await send(site.id, { t: 'ping', d: 1000 })
    await send(site.id, { t: 'identify', p: { email: 'a@b.c' } })
    expect(seen).toEqual([])
  })
})

describe('onEvent', () => {
  it('sees each stored event with its ids', async () => {
    const seen: StoredHookEvent[] = []
    const { site } = await open({ onEvent: (event) => void seen.push(event) })
    await send(site.id, { t: 'pageview' })
    await send(site.id, { t: 'goal', n: 'signup', p: { plan: 'pro' } })
    await send(site.id, { t: 'outbound', n: 'https://github.com/x' })
    expect(seen.map((e) => [e.type, e.name])).toEqual([
      ['pageview', null],
      ['goal', 'signup'],
      ['outbound', 'https://github.com/x'],
    ])
    expect(seen[1]).toMatchObject({ siteId: site.id, props: { plan: 'pro' }, path: '/pricing' })
    expect(seen[1]?.visitorId).toBeTruthy()
    expect(seen[1]?.sessionId).toBeTruthy()
  })

  it('does not fail the event when it throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { site } = await open({
      onEvent: () => {
        throw new Error('bad')
      },
    })
    expect((await send(site.id, { t: 'pageview' })).status).toBe(202)
    expect(await paths()).toEqual(['/pricing'])
  })

  it('runs after the response where the caller can defer', async () => {
    let release = (): void => undefined
    const finished = vi.fn()
    const { site } = await open({
      onEvent: () =>
        new Promise<void>((resolve) => {
          release = () => {
            finished()
            resolve()
          }
        }),
    })
    const deferred: Promise<unknown>[] = []
    const result = await server!.analytik.ingest({
      payload: { w: site.id, t: 'pageview', u: 'https://example.com/' },
      userAgent: CHROME,
      origin: 'https://example.com',
      defer: (work) => deferred.push(work),
    })
    expect(result).toMatchObject({ status: 202 })
    expect(await paths()).toEqual(['/'])
    expect(finished).not.toHaveBeenCalled()
    release()
    await Promise.all(deferred)
    expect(finished).toHaveBeenCalledOnce()
  })
})

describe('onPayment', () => {
  const pay = (apiKey: string, body: Record<string, unknown>) =>
    server!.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })

  it('is called once for a new payment and not for a retry', async () => {
    const seen: Payment[] = []
    const { apiKey, site } = await open({ onPayment: (payment) => void seen.push(payment) })
    expect((await pay(apiKey, { id: 'pay_1', amount: 1999, currency: 'USD' })).status).toBe(200)
    await pay(apiKey, { id: 'pay_1', amount: 1999, currency: 'USD' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ id: 'pay_1', siteId: site.id, amount: 1999, kind: 'payment' })
    await pay(apiKey, { id: 'ref_1', amount: 500, currency: 'USD', kind: 'refund' })
    expect(seen.map((p) => p.kind)).toEqual(['payment', 'refund'])
  })

  it('does not fail the payment when it throws, and is not called for the browser’s own revenue report', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const calls = vi.fn(() => {
      throw new Error('bad')
    })
    const { apiKey, site } = await open({ onPayment: calls })
    const response = await pay(apiKey, { id: 'pay_2', amount: 100, currency: 'USD' })
    expect(response.status).toBe(200)
    expect(await server!.rows('SELECT id FROM payments')).toHaveLength(1)
    await send(site.id, { t: 'revenue', n: 'purchase', a: 9.99, c: 'USD', o: 'order_1' })
    expect(calls).toHaveBeenCalledOnce()
  })
})
