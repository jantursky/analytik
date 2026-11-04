import { describe, expect, it, vi } from 'vitest'

import { installMenubar, type MenubarIo } from '../src/create/menubar'

const release = (tag: string, assets = ['Analytik-Menu-Bar-0.1.0.zip']) => ({
  tag_name: tag,
  assets: assets.map((name) => ({ name, browser_download_url: `https://example.test/${name}` })),
})

function io(overrides: Partial<MenubarIo> = {}) {
  const calls: string[] = []
  const value: MenubarIo = {
    platform: 'darwin',
    releases: () => Promise.resolve([release('1.16.0', []), release('menubar-v0.1.0'), release('menubar-v0.0.9')]),
    download: (url) => (calls.push(`download ${url}`), Promise.resolve('/tmp/app.zip')),
    unzip: (zip) => (calls.push(`unzip ${zip}`), '/tmp/unpacked'),
    install: (unpacked, dir) => (calls.push(`install ${unpacked} ${dir}`), `${dir}/Analytik Menu Bar.app`),
    open: (app) => void calls.push(`open ${app}`),
    log: vi.fn(),
    ...overrides,
  }
  return { value, calls }
}

describe('installMenubar', () => {
  it('installs the newest menu bar release into Applications and opens it', async () => {
    const { value, calls } = io()
    const result = await installMenubar(value)
    expect(result).toEqual({ tag: 'menubar-v0.1.0', app: '/Applications/Analytik Menu Bar.app' })
    expect(calls).toEqual([
      'download https://example.test/Analytik-Menu-Bar-0.1.0.zip',
      'unzip /tmp/app.zip',
      'install /tmp/unpacked /Applications',
      'open /Applications/Analytik Menu Bar.app',
    ])
  })

  it('honours a folder and skips opening', async () => {
    const { value, calls } = io()
    await installMenubar(value, { dir: '/tmp/apps', open: false })
    expect(calls).toContain('install /tmp/unpacked /tmp/apps')
    expect(calls.some((c) => c.startsWith('open'))).toBe(false)
  })

  it('refuses other systems than macOS', async () => {
    await expect(installMenubar(io({ platform: 'linux' }).value)).rejects.toThrow('macOS 14')
  })

  it('says so when no menu bar release has a zip yet', async () => {
    const none = io({ releases: () => Promise.resolve([release('1.16.0'), release('menubar-v0.1.0', [])]) })
    await expect(installMenubar(none.value)).rejects.toThrow('No Mac app release found')
  })
})
