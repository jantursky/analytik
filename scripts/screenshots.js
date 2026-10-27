// Captures the demo for the READMEs: `bun run screenshots`. Builds the demo, serves it, and saves light and dark
// PNGs to .github/assets/. Uses the seeded demo data only.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/* global document */
import { chromium } from 'playwright'
import sharp from 'sharp'

const root = new URL('..', import.meta.url).pathname
const out = join(root, '.github/assets')
const port = 4181
const views = [
  { name: 'dashboard', hash: '#dashboard', ready: '[data-testid="overview"], .analytik-stat-strip, h1' },
  { name: 'privacy', hash: '#privacy', ready: 'h1' },
  { name: 'site', hash: '#site', ready: 'h1' },
]

mkdirSync(out, { recursive: true })
const build = spawnSync('bun', ['run', 'build'], { cwd: root, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const server = spawn('bunx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
  cwd: join(root, 'apps/example'),
  stdio: 'ignore',
})
const stop = () => server.kill()
process.on('exit', stop)

const base = `http://localhost:${port}/`
for (let i = 0; i < 50; i++) {
  if (
    await fetch(base).then(
      (r) => r.ok,
      () => false,
    )
  )
    break
  await new Promise((resolve) => setTimeout(resolve, 200))
}

const browser = await chromium.launch()
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    })
    const page = await context.newPage()
    for (const view of views) {
      await page.goto(base + view.hash)
      await page.locator(view.ready).first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(1200)
      const png = await page.screenshot()
      await sharp(png)
        .png({ palette: true, quality: 85, compressionLevel: 9 })
        .toFile(join(out, `${view.name}-${scheme}.png`))
    }
    await context.close()
  }
} finally {
  await browser.close()
  stop()
}
