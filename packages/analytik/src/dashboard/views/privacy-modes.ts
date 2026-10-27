import type { PrivacyMode } from '../../shared/types'

/** Whether a mode needs a cookie banner: no, only for what it adds after consent, or yes. */
export type BannerNeed = 'none' | 'consent' | 'required'

export interface ModeInfo {
  value: PrivacyMode
  label: string
  /** One line for the list. */
  hint: string
  banner: BannerNeed
  /** The highlighted verdict on the cookie banner. */
  bannerLabel: string
  /** What the mode means, as rows for the detail tooltip. */
  details: { title: string; text: string }[]
}

const SHARED =
  'Page, referrer, campaign, country and city (from the edge, rounded), browser, system, device, screen size, language, and the events and payments you send. The IP address is read for one computation and never stored.'

export const MODE_INFO: readonly ModeInfo[] = [
  {
    value: 'strict',
    label: 'Strict',
    hint: 'No cookies or storage. Visitors are a server-side hash that changes every month.',
    banner: 'none',
    bannerLabel: 'No cookie banner needed',
    details: [
      { title: 'On the visitor’s device', text: 'Nothing. No cookies, no localStorage or sessionStorage written.' },
      { title: 'Stored on the server', text: SHARED },
      {
        title: 'Visitor id',
        text: 'A hash of the site, IP and user agent with a secret salt that belongs to one month. The salt is deleted when the month ends, so old ids can no longer be linked.',
      },
      {
        title: 'Limits',
        text: 'A changed network counts as a new visitor, people sharing an IP and browser count once, and identify() and timing-based payment matching are off.',
      },
      {
        title: 'Cookie banner',
        text: 'Designed to need none, as long as you stay in strict mode and send no emails or names. Not legal advice.',
      },
    ],
  },
  {
    value: 'enriched',
    label: 'Enriched',
    hint: 'Adds a per-tab id after the visitor consents.',
    banner: 'consent',
    bannerLabel: 'Cookie banner needed for the extra id',
    details: [
      {
        title: 'On the visitor’s device',
        text: 'Before consent: nothing, like strict. After analytik.consent(): a random id in sessionStorage that dies with the tab.',
      },
      {
        title: 'Stored on the server',
        text: `${SHARED} After consent, also the tab id and identities from identify().`,
      },
      {
        title: 'Visitor id',
        text: 'The strict hash plus the tab id, so a visit stays one visit when the network changes.',
      },
      {
        title: 'Do Not Track',
        text: 'A visitor whose browser sends Do Not Track or Global Privacy Control is still counted, in strict mode.',
      },
      {
        title: 'Cookie banner',
        text: 'For sites that already ask for consent: call analytik.consent() when the visitor agrees. Without consent it behaves like strict.',
      },
    ],
  },
  {
    value: 'persistent',
    label: 'Persistent',
    hint: 'First-party cookies for returning visitors. Needs consent in the EU.',
    banner: 'required',
    bannerLabel: 'Cookie banner required in the EU',
    details: [
      {
        title: 'On the visitor’s device',
        text: 'Two first-party cookies: analytik_vid for a year and analytik_sid for 30 minutes, both random ids.',
      },
      { title: 'Stored on the server', text: `${SHARED} Also the random visitor id and identities from identify().` },
      {
        title: 'Visitor id',
        text: 'A random id per browser. The most exact counts, returning visitors across months and timing-based payment matching.',
      },
      {
        title: 'Do Not Track',
        text: 'A visitor whose browser sends Do Not Track or Global Privacy Control gets no cookies until analytik.consent() is called.',
      },
      {
        title: 'Cookie banner',
        text: 'Treat it as required for EU visitors: ask before the tracker runs, and call analytik.consent() on agreement.',
      },
    ],
  },
]
