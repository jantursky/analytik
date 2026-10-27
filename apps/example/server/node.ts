import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_BODY = 64 * 1024

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY) throw new RangeError('Request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Converts a Node request into a Fetch `Request`. The caller's address goes in `x-forwarded-for`. */
export const toRequest = async (req: IncomingMessage): Promise<Request> => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  if (!headers.has('x-forwarded-for') && req.socket.remoteAddress) {
    headers.set('x-forwarded-for', req.socket.remoteAddress)
  }
  const method = req.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(req))
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body })
}

export const sendResponse = async (res: ServerResponse, response: Response): Promise<void> => {
  res.statusCode = response.status
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') res.setHeader(name, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)
  res.end(Buffer.from(await response.arrayBuffer()))
}
