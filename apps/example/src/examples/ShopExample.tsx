import { createClient } from 'analytik/client'
import { AnalytikProvider, TrackClick, useAnalytik, useTrackPageviews } from 'analytik/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { API_BASE, SITE_ID } from '../config'

// A tiny storefront for a fictional indie product, instrumented with analytik/react.
// Routing is plain history.pushState so the tracker sees real paths: /, /pricing, /checkout, /thank-you.

const PLANS = [
  { id: 'solo', name: 'Solo', cents: 2900, perks: ['One user', 'Lifetime updates'] },
  { id: 'studio', name: 'Studio', cents: 7900, perks: ['Five users', 'Lifetime updates', 'Priority support'] },
] as const

type Plan = (typeof PLANS)[number]
type Route = '/' | '/pricing' | '/checkout' | '/thank-you'

const ROUTES: readonly Route[] = ['/', '/pricing', '/checkout', '/thank-you']
const NAVIGATE_EVENT = 'shop:navigate'

const money = (cents: number) => `$${(cents / 100).toFixed(0)}`

const currentRoute = (): Route => ROUTES.find((route) => route === window.location.pathname) ?? '/'

const subscribeRoute = (notify: () => void) => {
  window.addEventListener('popstate', notify)
  window.addEventListener(NAVIGATE_EVENT, notify)
  return () => {
    window.removeEventListener('popstate', notify)
    window.removeEventListener(NAVIGATE_EVENT, notify)
  }
}

const navigate = (route: Route) => {
  window.history.pushState(null, '', `${route}${window.location.hash}`)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/** What the visitor put in the cart; lives in memory only, so the shop itself stores nothing on the device. */
const cart: { plan: Plan; orderId: string } = { plan: PLANS[0], orderId: '' }

const fillCart = (plan: Plan) => {
  cart.plan = plan
  cart.orderId = crypto.randomUUID()
}

function Landing() {
  const analytik = useAnalytik()
  return (
    <>
      <h2>Fernwood, a quiet place to write.</h2>
      <p className="muted">A distraction-free writing app. Pay once, keep it forever.</p>
      <div className="row">
        <TrackClick event="trial_click" props={{ location: 'hero' }}>
          <button type="button" className="btn" onClick={() => analytik.track('trial_hint')}>
            Download the free trial
          </button>
        </TrackClick>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            navigate('/pricing')
          }}
        >
          See pricing
        </button>
      </div>
    </>
  )
}

function Pricing() {
  const analytik = useAnalytik()
  const choose = (plan: Plan) => {
    fillCart(plan)
    analytik.track('plan_select', { plan: plan.id, price: plan.cents / 100 })
    navigate('/checkout')
  }
  return (
    <>
      <h2>One payment. No subscription.</h2>
      <div className="plans">
        {PLANS.map((plan) => (
          <article key={plan.id} className="card plan">
            <h2>{plan.name}</h2>
            <p className="plan__price">{money(plan.cents)}</p>
            <ul>
              {plan.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn"
              onClick={() => {
                choose(plan)
              }}
            >
              Buy {plan.name}
            </button>
          </article>
        ))}
      </div>
    </>
  )
}

function Checkout() {
  const [email, setEmail] = useState('')
  return (
    <>
      <h2>Checkout</h2>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          navigate('/thank-you')
        }}
      >
        <p className="muted">
          {cart.plan.name} licence, {money(cart.plan.cents)}. This is a stub: no card is charged.
        </p>
        <label className="field">
          Email for the receipt
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Pay {money(cart.plan.cents)}
        </button>
      </form>
    </>
  )
}

function ThankYou() {
  const analytik = useAnalytik()
  const sent = useRef(false)
  useEffect(() => {
    // Strict mode runs effects twice in development; the order id also de-duplicates on the server.
    if (sent.current) return
    sent.current = true
    cart.orderId ||= crypto.randomUUID()
    analytik.revenue('purchase', cart.plan.cents / 100, {
      currency: 'USD',
      orderId: cart.orderId,
      plan: cart.plan.id,
    })
  }, [analytik])
  return (
    <>
      <h2>Thank you!</h2>
      <p className="muted">
        Your {cart.plan.name} licence is on its way. This page reported a {money(cart.plan.cents)} revenue event with
        order id <code>{cart.orderId.slice(0, 8)}</code>, attributed to the channel that brought you here.
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          navigate('/')
        }}
      >
        Back to the start
      </button>
    </>
  )
}

function Shop() {
  useTrackPageviews()
  const route = useSyncExternalStore(subscribeRoute, currentRoute, () => '/')
  return (
    <div className="shop">
      <div className="shop__bar">
        <span className="badge">fernwood.example</span>
        <span className="shop__url" data-testid="shop-url">
          {route}
        </span>
      </div>
      <nav className="shop__nav" aria-label="Shop">
        <strong>Fernwood</strong>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            navigate('/')
          }}
        >
          Home
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            navigate('/pricing')
          }}
        >
          Pricing
        </button>
      </nav>
      <div className="shop__page">
        {route === '/' && <Landing />}
        {route === '/pricing' && <Pricing />}
        {route === '/checkout' && <Checkout />}
        {route === '/thank-you' && <ThankYou />}
      </div>
    </div>
  )
}

function ConsentSwitch({ granted, onChange }: { granted: boolean; onChange: (granted: boolean) => void }) {
  const analytik = useAnalytik()
  return (
    <div className="card row">
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={granted}
        aria-label="Analytics consent"
        onClick={() => {
          if (granted) analytik.withdrawConsent()
          else analytik.consent()
          onChange(!granted)
        }}
      />
      <div>
        <strong>Analytics consent</strong>
        <p className="muted">
          {granted
            ? 'Enriched: a tab id sits in sessionStorage, so returning pages in this tab are linked.'
            : 'Strict: nothing is stored on this device; the server derives an anonymous id.'}
        </p>
      </div>
      <span className={granted ? 'badge badge--accent' : 'badge badge--success'} data-testid="mode-badge">
        {granted ? 'enriched' : 'strict'}
      </span>
    </div>
  )
}

export function ShopExample() {
  const [client] = useState(() =>
    createClient({ site: SITE_ID, api: API_BASE, mode: 'enriched', allowLocalhost: true }),
  )
  const [granted, setGranted] = useState(false)
  return (
    <AnalytikProvider client={client}>
      <div className="stack">
        <ConsentSwitch granted={granted} onChange={setGranted} />
        <Shop />
        <p className="faint">
          Browse, buy a licence and open the Dashboard tab: your visit shows up under Realtime within seconds.
        </p>
      </div>
    </AnalytikProvider>
  )
}

export default ShopExample
