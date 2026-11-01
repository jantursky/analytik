import type { EmailMessage, EmailSend } from './types'

type Fetcher = (input: string, init: RequestInit) => Promise<Response>

async function post(fetcher: Fetcher, url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200)
    throw new Error(`email API answered ${response.status}${detail ? `: ${detail}` : ''}`)
  }
}

/** Sends through Resend (https://resend.com). */
export function resendSender(options: { apiKey: string; fetch?: Fetcher }): EmailSend {
  const fetcher: Fetcher = options.fetch ?? ((input, init) => fetch(input, init))
  return (message) =>
    post(
      fetcher,
      'https://api.resend.com/emails',
      { authorization: `Bearer ${options.apiKey}` },
      { from: message.from, to: [message.to], subject: message.subject, text: message.text, html: message.html },
    )
}

/**
 * Sends through any HTTP email API: a JSON POST of `{ from, to, subject, text, html }`, or whatever `body` returns for
 * the message (Postmark, SendGrid, Mailgun's JSON API, your own relay). A non-2xx answer is an error.
 */
export function httpSender(options: {
  url: string
  headers?: Record<string, string>
  body?: (message: EmailMessage) => unknown
  fetch?: Fetcher
}): EmailSend {
  const fetcher: Fetcher = options.fetch ?? ((input, init) => fetch(input, init))
  return (message) => post(fetcher, options.url, options.headers ?? {}, options.body ? options.body(message) : message)
}

/** The `EmailMessage` class of `cloudflare:email`. */
export type CloudflareEmailMessage = new (from: string, to: string, raw: string) => unknown

/** The `send_email` binding of a Worker. */
export interface CloudflareEmailBinding {
  send(message: never): Promise<void>
}

const address = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value.trim()

/** UTF-8 text as base64 in lines of 76 characters, which any mail server accepts. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return (btoa(binary).match(/.{1,76}/g) ?? []).join('\r\n')
}

/** A header value on one line: a line break in it would start a new header. */
const headerValue = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

/**
 * A subject as plain text when it is short ASCII, else as RFC 2047 encoded words of at most 75 characters each,
 * cut between characters so none is split.
 */
export function encodeSubject(subject: string): string {
  const text = headerValue(subject)
  if (/^[\x20-\x7e]{0,60}$/.test(text)) return text
  const words: string[] = []
  let chunk = ''
  for (const char of text) {
    if (new TextEncoder().encode(chunk + char).length > 42) {
      words.push(chunk)
      chunk = ''
    }
    chunk += char
  }
  if (chunk) words.push(chunk)
  return words.map((word) => `=?UTF-8?B?${base64(word).replace(/\r\n/g, '')}?=`).join('\r\n ')
}

/** A multipart/alternative message in MIME, which Cloudflare's `send_email` binding takes instead of fields. */
export function mimeMessage(message: EmailMessage, id: string, date: Date): string {
  const boundary = `analytik-${id}`
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      'Content-Transfer-Encoding: base64',
      '',
      base64(body),
    ].join('\r\n')
  return [
    `From: ${headerValue(message.from)}`,
    `To: ${headerValue(message.to)}`,
    `Subject: ${encodeSubject(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${address(message.from).split('@')[1] ?? 'analytik'}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', message.text),
    part('text/html', message.html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

/**
 * Sends through a Worker's `send_email` binding. Pass the binding and the `EmailMessage` class from `cloudflare:email`;
 * the recipient must be a verified destination address of the zone.
 */
export function cloudflareSender(
  binding: CloudflareEmailBinding,
  EmailMessageClass: CloudflareEmailMessage,
): EmailSend {
  return async (message) => {
    const id = crypto.randomUUID()
    const raw = mimeMessage(message, id, new Date())
    await binding.send(new EmailMessageClass(address(message.from), address(message.to), raw) as never)
  }
}
