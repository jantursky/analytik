import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Animations fade content in; axe would measure contrast mid-fade, so run without them.
test.use({ reducedMotion: 'reduce' })

// No axe rule is turned off anywhere in this file. A rule that has to be, goes in here with the reason next to it.
const DISABLED_RULES: { rule: string; reason: string }[] = []

// Base UI puts two empty, off-screen `role="button"` focus guards around a popup so focus cannot leave it. WebKit
// reports them as unnamed commands. They are not content and a name would be read out for nothing, so they are left
// out of the analysis; no rule is turned off for the rest of the page.
const EXCLUDED = ['[data-base-ui-focus-guard]']

const check = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page })
    .disableRules(DISABLED_RULES.map((d) => d.rule))
    .exclude(EXCLUDED)
    .analyze()
  expect(violations).toEqual([])
}

for (const tab of ['site', 'install', 'privacy']) {
  test(`#${tab} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(`/#${tab}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await check(page)
  })
}

test('#install with the options open has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/#install')
  await page.getByRole('button', { name: /More options/ }).click()
  await expect(page.getByLabel('Your analytik host')).toBeVisible()
  await check(page)
})

// Every view of the dashboard and every Settings section reachable from the demo's Dashboard tab, by their address.
// `debug` is left out: it only shows on a server that opted in with `debug: true`, which the public demo does not.
const VIEWS: { name: string; query: string }[] = [
  { name: 'All sites', query: 'section=sites' },
  ...['overview', 'sources', 'pages', 'events', 'bots', 'funnels', 'journeys', 'retention', 'revenue', 'sessions'].map(
    (view) => ({ name: view, query: `section=${view}` }),
  ),
  { name: 'realtime', query: 'section=realtime' },
  ...[
    'general',
    'privacy',
    'tracking',
    'campaigns',
    'goals',
    'payments',
    'data',
    'sharing',
    'api',
    'email',
    'appearance',
    'formatting',
    'defaults',
    'changelog',
  ].map((tab) => ({ name: `settings, ${tab}`, query: `section=settings&tab=${tab}` })),
]

const SCHEMES = ['light', 'dark'] as const

/** Waits until the view has drawn: its heading is in the page and nothing says it is still loading. */
const settled = async (page: Page): Promise<void> => {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
  await expect(page.locator('.analytik-skeleton, .analytik-chart-skeleton, [aria-busy="true"]')).toHaveCount(0)
  // Cards fade in even with reduced motion; axe would measure the colours of a half-faded card.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.analytik-card[style*="opacity"]')].every(
      (el) => getComputedStyle(el).opacity === '1',
    ),
  )
}

for (const scheme of SCHEMES) {
  for (const view of VIEWS) {
    test(`dashboard ${view.name} in the ${scheme} scheme has no detectable accessibility violations`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`/?${view.query}#full`)
      await settled(page)
      await check(page)
    })
  }
}

// The theme button sets the theme on the dashboard root whatever the system scheme is.
for (const theme of ['Light', 'Dark']) {
  for (const view of ['overview', 'events', 'revenue']) {
    test(`dashboard ${view} with the theme button on ${theme} has no detectable accessibility violations`, async ({
      page,
    }) => {
      await page.goto(`/?section=${view}#full`)
      const toggle = page.locator('.analytik-theme-toggle')
      await expect(toggle).toBeVisible()
      while (!(await toggle.getAttribute('aria-label'))?.startsWith(`Theme: ${theme}`)) await toggle.click()
      await expect(page.locator(`[data-theme="${theme.toLowerCase()}"]`).first()).toBeAttached()
      await settled(page)
      await check(page)
    })
  }
}

for (const scheme of SCHEMES) {
  test(`the command palette in the ${scheme} scheme has no detectable accessibility violations`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/?section=overview#full')
    await settled(page)
    await page.keyboard.press('ControlOrMeta+K')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    await check(page)
  })

  test(`the shortcuts help in the ${scheme} scheme has no detectable accessibility violations`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/?section=overview#full')
    await settled(page)
    await page.locator('body').press('Shift+?')
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await check(page)
  })

  test(`the add website menu and the import dialog in the ${scheme} scheme have no detectable accessibility violations`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/?section=sites#full')
    await settled(page)
    await page.getByRole('button', { name: 'Add website' }).click()
    await page.getByRole('menuitem', { name: 'Import from another tool' }).click()
    await expect(page.getByRole('dialog').getByText('Which tool are you importing from?')).toBeVisible()
    await check(page)
  })
}
