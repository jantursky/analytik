import { afterEach, describe, expect, it } from 'vitest'

import { type AnalytikClient, createClient } from '../src/client/index'
import { captureWire } from './tracker-harness'

const wire = captureWire('https://shop.example.com/cart?utm_medium=email&email=a%40b.c')
let client: AnalytikClient | undefined

afterEach(() => client?.destroy())

describe('createClient in a browser', () => {
  it('tracks like the script, with options instead of attributes', async () => {
    client = createClient({ site: 'shop', api: 'https://stats.example.net/api', requireInteraction: false })
    client.track('add_to_cart', { sku: 'A1' })
    client.revenue('purchase', 19.99, { currency: 'usd', orderId: 'o1' })
    expect((await wire.sent()).map((s) => s.body)).toEqual([
      { w: 'shop', t: 'pageview', u: 'https://shop.example.com/cart?utm_medium=email', sw: screen.width, m: 'strict' },
      {
        w: 'shop',
        t: 'goal',
        u: 'https://shop.example.com/cart?utm_medium=email',
        sw: screen.width,
        m: 'strict',
        n: 'add_to_cart',
        p: { sku: 'A1' },
      },
      {
        w: 'shop',
        t: 'revenue',
        u: 'https://shop.example.com/cart?utm_medium=email',
        sw: screen.width,
        m: 'strict',
        n: 'purchase',
        a: 19.99,
        c: 'USD',
        o: 'o1',
      },
    ])
    expect('ids' in client).toBe(false)
  })

  it('stops after destroy', async () => {
    client = createClient({ site: 'shop', requireInteraction: false })
    client.destroy()
    wire.clear()
    history.pushState({}, '', '/other')
    expect(await wire.sent()).toEqual([])
  })
})
