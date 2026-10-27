import { afterEach, describe, expect, it, vi } from 'vitest'

import { version } from '../package.json'
import { resetVersionCache } from '../src/server/version'
import { type TestServer, testServer } from './helpers/server'

let server: TestServer | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  resetVersionCache()
  await server?.close()
  server = undefined
})

const registry = (answer: () => Response | Promise<Response>) => {
  const fetcher = vi.fn(answer)
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('the version for the update notice', () => {
  it('reports the running version and the newest one on npm, asked at most every six hours', async () => {
    server = await testServer()
    const fetcher = registry(() => Response.json({ version: '9.9.9' }))
    expect((await server.request('/version')).status).toBe(401)
    expect(await server.adminJson('/version')).toEqual({ current: version, latest: '9.9.9' })
    await server.adminJson('/version')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((fetcher.mock.calls as unknown[][])[0]?.[0]).toBe('https://registry.npmjs.org/analytik/latest')
    server.advance(6 * 60 * 60 * 1000 + 1)
    await server.adminJson('/version')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('has no newest version when the registry fails, and tries again after ten minutes', async () => {
    server = await testServer()
    let up = false
    const fetcher = registry(() => (up ? Response.json({ version: '9.9.9' }) : new Response('down', { status: 503 })))
    expect(await server.adminJson('/version')).toEqual({ current: version, latest: null })
    await server.adminJson('/version')
    expect(fetcher).toHaveBeenCalledTimes(1)
    up = true
    server.advance(10 * 60 * 1000 + 1)
    expect(await server.adminJson('/version')).toEqual({ current: version, latest: '9.9.9' })
    registry(() => Promise.reject(new Error('offline')))
    resetVersionCache()
    expect(await server.adminJson('/version')).toEqual({ current: version, latest: null })
  })

  it('asks nobody with updateCheck off', async () => {
    server = await testServer('memory', { updateCheck: false })
    const fetcher = registry(() => Response.json({ version: '9.9.9' }))
    expect(await server.adminJson('/version')).toEqual({ current: version, latest: null })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
