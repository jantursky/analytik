import type { PrivacyMode } from '../../shared/types'
import { msg } from '../i18n'

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

const SHARED = msg(
  'Page, referrer, campaign, country and city (from the edge, rounded), browser, system, device, screen size, language, and the events and payments you send. The IP address is read for one computation and never stored.',
)

export const MODE_INFO: readonly ModeInfo[] = [
  {
    value: 'strict',
    label: msg('Strict'),
    hint: msg('No cookies or storage. Visitors are a server-side hash that changes every month.'),
    banner: 'none',
    bannerLabel: msg('No cookie banner needed'),
    details: [
      {
        title: msg('On the visitor’s device'),
        text: msg('Nothing. No cookies, no localStorage or sessionStorage written.'),
      },
      { title: msg('Stored on the server'), text: SHARED },
      {
        title: msg('Visitor id'),
        text: msg(
          'A hash of the site, IP and user agent with a secret salt that belongs to one month. The salt is deleted when the month ends, so old ids can no longer be linked.',
        ),
      },
      {
        title: msg('Limits'),
        text: msg(
          'A changed network counts as a new visitor, people sharing an IP and browser count once, and identify() and timing-based payment matching are off.',
        ),
      },
      {
        title: msg('Cookie banner'),
        text: msg(
          'Designed to need none, as long as you stay in strict mode and send no emails or names. Not legal advice.',
        ),
      },
    ],
  },
  {
    value: 'enriched',
    label: msg('Enriched'),
    hint: msg('Adds a per-tab id after the visitor consents.'),
    banner: 'consent',
    bannerLabel: msg('Cookie banner needed for the extra id'),
    details: [
      {
        title: msg('On the visitor’s device'),
        text: msg(
          'Before consent: nothing, like strict. After analytik.consent(): a random id in sessionStorage that dies with the tab.',
        ),
      },
      {
        title: msg('Stored on the server'),
        text: msg(
          'Page, referrer, campaign, country and city (from the edge, rounded), browser, system, device, screen size, language, and the events and payments you send. The IP address is read for one computation and never stored. After consent, also the tab id and identities from identify().',
        ),
      },
      {
        title: msg('Visitor id'),
        text: msg('The strict hash plus the tab id, so a visit stays one visit when the network changes.'),
      },
      {
        title: msg('Do Not Track'),
        text: msg(
          'A visitor whose browser sends Do Not Track or Global Privacy Control is still counted, in strict mode.',
        ),
      },
      {
        title: msg('Cookie banner'),
        text: msg(
          'For sites that already ask for consent: call analytik.consent() when the visitor agrees. Without consent it behaves like strict.',
        ),
      },
    ],
  },
  {
    value: 'persistent',
    label: msg('Persistent'),
    hint: msg('First-party cookies for returning visitors. Needs consent in the EU.'),
    banner: 'required',
    bannerLabel: msg('Cookie banner required in the EU'),
    details: [
      {
        title: msg('On the visitor’s device'),
        text: msg('Two first-party cookies: analytik_vid for a year and analytik_sid for 30 minutes, both random ids.'),
      },
      {
        title: msg('Stored on the server'),
        text: msg(
          'Page, referrer, campaign, country and city (from the edge, rounded), browser, system, device, screen size, language, and the events and payments you send. The IP address is read for one computation and never stored. Also the random visitor id and identities from identify().',
        ),
      },
      {
        title: msg('Visitor id'),
        text: msg(
          'A random id per browser. The most exact counts, returning visitors across months and timing-based payment matching.',
        ),
      },
      {
        title: msg('Do Not Track'),
        text: msg(
          'A visitor whose browser sends Do Not Track or Global Privacy Control gets no cookies until analytik.consent() is called.',
        ),
      },
      {
        title: msg('Cookie banner'),
        text: msg(
          'Treat it as required for EU visitors: ask before the tracker runs, and call analytik.consent() on agreement.',
        ),
      },
    ],
  },
]
