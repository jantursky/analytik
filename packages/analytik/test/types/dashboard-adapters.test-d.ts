import { describe, expectTypeOf, it } from 'vitest'

import * as creem from '../../src/adapters/creem'
import * as dodo from '../../src/adapters/dodo'
import * as gumroad from '../../src/adapters/gumroad'
import * as lemonsqueezy from '../../src/adapters/lemonsqueezy'
import * as paddle from '../../src/adapters/paddle'
import * as polar from '../../src/adapters/polar'
import * as razorpay from '../../src/adapters/razorpay'
import * as stripe from '../../src/adapters/stripe'
import type { WebhookRequest } from '../../src/adapters/shared'
import type { DashboardProps, DashboardView } from '../../src/dashboard'
import type { PaymentInput } from '../../src/shared/types'

describe('Dashboard props', () => {
  it('needs only the API address', () => {
    expectTypeOf<{ api: string }>().toExtend<DashboardProps>()
    expectTypeOf<DashboardProps['api']>().toEqualTypeOf<string>()
  })

  it('types the options', () => {
    expectTypeOf<DashboardProps['theme']>().toEqualTypeOf<'light' | 'dark' | undefined>()
    expectTypeOf<DashboardProps['view']>().toEqualTypeOf<DashboardView | undefined>()
    expectTypeOf<DashboardProps['urlState']>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<DashboardProps['share']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<DashboardProps['locale']>().toEqualTypeOf<string | undefined>()
  })

  it('rejects an unknown theme', () => {
    // @ts-expect-error only light and dark
    const props: DashboardProps = { api: '/api', theme: 'sepia' }
    expectTypeOf(props).toEqualTypeOf<DashboardProps>()
  })
})

describe('payment adapters', () => {
  it('verify a webhook request and turn an event into a payment', () => {
    for (const adapter of [creem, dodo, gumroad, lemonsqueezy, paddle, polar, razorpay, stripe]) {
      expectTypeOf(adapter.toPayment).returns.toEqualTypeOf<PaymentInput | null>()
      expectTypeOf(adapter.toPayment).parameter(0).toBeUnknown()
    }
    expectTypeOf(stripe.verify).parameter(0).toEqualTypeOf<WebhookRequest>()
    expectTypeOf(stripe.verify).returns.toEqualTypeOf<Promise<boolean>>()
  })
})
