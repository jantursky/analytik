export type { EmailSettings, SummaryFrequency } from '../../shared/types'

/** One email, as the sender receives it. `to` is a single address; the body comes as plain text and HTML. */
export interface EmailMessage {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

/** Sends one message, or throws with the reason it was refused. */
export type EmailSend = (message: EmailMessage) => Promise<void>

/**
 * Turns on owner emails: payment alerts, a daily or weekly summary and a tracker-down alert. Which of them are on, and
 * where they go, is set in the dashboard (Settings → Email).
 */
export interface EmailOptions {
  /** Delivers a message; see `resendSender`, `httpSender` and `cloudflareSender` in `analytik/email`. */
  send: EmailSend
  /** The sender address, e.g. `analytik@example.com` or `Analytik <analytik@example.com>`. */
  from: string
  /** Recipient used until one is set in the dashboard. */
  to?: string
  /** Address of the dashboard, for the link in the summary. Default: the address the cron request came to. */
  url?: string
  /**
   * Secret for `POST /api/v1/cron`, sent as `Authorization: Bearer <secret>`. Without it the route answers 401; scheduled
   * work then only runs through `scheduled()`.
   */
  cronSecret?: string
}

/** What `scheduled()` did. */
export interface ScheduledResult {
  /** Which summary was sent, if one was due. */
  summary: 'daily' | 'weekly' | null
  /** Ids of the sites a tracker-down alert was sent for. */
  down: string[]
}
