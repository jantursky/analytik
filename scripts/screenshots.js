// Captures the demo dashboard for the READMEs: `bun run screenshots`. Builds the demo, serves it, and saves light and
// dark PNGs of the overview, the live map and revenue to .github/assets/, and the overview on a phone. Uses the seeded
// demo data only. `bun run screenshots phone` captures only the phone pair.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/* global document, window */
import { chromium } from 'playwright'
import sharp from 'sharp'

const root = new URL('..', import.meta.url).pathname
const out = join(root, '.github/assets')
const port = 4181
// Each view of the embedded dashboard, captured without the demo page around it and cut at `height` CSS pixels.
const views = [
  { name: 'dashboard', tab: null, ready: '.analytik-overview .analytik-stat', height: 1100 },
  { name: 'live', tab: 'Live', ready: '.analytik-map', height: 820 },
  { name: 'revenue', tab: 'Revenue', ready: '.analytik-view .analytik-card', height: 1000 },
]

const only = process.argv.slice(2)
const wanted = (name) => only.length === 0 || only.includes(name)

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
    for (const view of views.filter((v) => wanted(v.name))) {
      await page.goto(base + '#dashboard')
      await page.locator('.analytik-toolbar').waitFor()
      if (view.tab) await page.locator('.analytik nav').getByText(view.tab, { exact: true }).first().click()
      await page.locator(view.ready).first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      // Long enough for the view switch and the charts to finish animating.
      await page.waitForTimeout(3000)
      // Clicking a tab can scroll the demo page; the clip below is in page coordinates, so start from the top.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(300)
      const box = await page.locator('.analytik').first().boundingBox()
      if (!box) throw new Error(`no dashboard on ${view.name}`)
      const png = await page.screenshot({
        fullPage: true,
        clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, view.height) },
      })
      await sharp(png)
        .png({ palette: true, quality: 85, compressionLevel: 9 })
        .toFile(join(out, `${view.name}-${scheme}.png`))
    }
    await context.close()

    if (wanted('phone')) {
      // The full-page view on a phone, without the demo's own header: the view list, the toolbar and the summary.
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        colorScheme: scheme,
      })
      const view = await phone.newPage()
      await view.goto(base + '?section=overview#full')
      await view.locator('.analytik-overview .analytik-stat').first().waitFor()
      await view.evaluate(() => document.fonts.ready)
      await view.waitForTimeout(3000)
      const box = await view.locator('.analytik').first().boundingBox()
      if (!box) throw new Error('no dashboard on the phone')
      const png = await view.screenshot({ clip: { x: 0, y: box.y, width: 390, height: 760 } })
      await sharp(png)
        .png({ palette: true, quality: 85, compressionLevel: 9 })
        .toFile(join(out, `phone-${scheme}.png`))
      await phone.close()
    }
  }
} finally {
  await browser.close()
  stop()
}
