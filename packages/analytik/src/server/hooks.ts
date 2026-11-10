import type { Context } from './context'
import type { SiteRecord } from './sites'
import type { Payment } from '../shared/types'
import type { StoredHookEvent } from './types'
import { deliverNotice } from './webhooks'

/** How long a hook may take before it is abandoned. */
export const HOOK_TIMEOUT = 1000

const TIMED_OUT = Symbol('timed out')

/**
 * Runs a hook of the embedding code and never throws: an error or a hook that does not finish in a second is logged and
 * counts as "returned nothing".
 */
export async function runHook<A, R>(
  name: string,
  hook: ((argument: A) => R | Promise<R>) | undefined,
  argument: A,
): Promise<Awaited<R> | undefined> {
  if (!hook) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), HOOK_TIMEOUT)
  })
  try {
    const result = await Promise.race([Promise.resolve().then(() => hook(argument)), late])
    if (result === TIMED_OUT) {
      console.error(`analytik: hook ${name} took longer than ${HOOK_TIMEOUT} ms and was abandoned`)
      return undefined
    }
    return result
  } catch (error) {
    console.error(`analytik: hook ${name} failed`, error)
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Hands work to `defer` (after the response, where the runtime has it), otherwise waits for it. */
export async function after(defer: ((work: Promise<unknown>) => void) | undefined, work: Promise<void>): Promise<void> {
  if (defer) defer(work)
  else await work
}

/** What happens after an event was stored: the `onEvent` hook, and the site's webhooks for a goal. Never throws. */
export async function eventStored(ctx: Context, site: SiteRecord, event: StoredHookEvent): Promise<void> {
  await Promise.all([
    runHook('onEvent', ctx.hooks.onEvent, event),
    event.type === 'goal' && event.name
      ? deliverNotice(
          ctx,
          site,
          'goal',
          (source) => ({
            type: 'goal',
            name: event.name ?? '',
            path: event.path,
            props: event.props,
            ts: event.ts,
            source,
          }),
          event.sessionId,
        )
      : undefined,
  ])
}

/** What happens after a new payment or refund was recorded: the `onPayment` hook and the site's webhooks. Never throws. */
export async function paymentRecorded(ctx: Context, site: SiteRecord, payment: Payment): Promise<void> {
  await Promise.all([
    runHook('onPayment', ctx.hooks.onPayment, payment),
    deliverNotice(
      ctx,
      site,
      'payment',
      (source) => ({
        type: 'payment',
        id: payment.id,
        kind: payment.kind,
        amount: payment.amount,
        currency: payment.currency,
        provider: payment.provider,
        ts: payment.ts,
        source,
      }),
      payment.sessionId,
    ),
  ])
}
