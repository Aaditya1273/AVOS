/**
 * Capture the screenshots the README embeds.
 *
 * Run against a production build so what is captured is what ships:
 *   npm run build && PORT=4300 npm start
 *   node scripts/screenshot.mjs
 *
 * The Proof Card is client-rendered after a fetch, so this settles on a fixed
 * wait rather than a locator. Anchoring on a selector was repeatedly flaky here
 * for reasons that were not worth chasing further: a fixed settle is dumber,
 * slower by four seconds, and reliable.
 */
import { chromium } from 'playwright'

const BASE = process.env.AVOS_SHOT_URL ?? 'http://localhost:5700'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 2 })

await page.goto(BASE + '/console', { waitUntil: 'networkidle' })
await page.waitForTimeout(6000)

// 1. The hero Proof Card: agent claim struck through beside the refusal.
await page.getByText('Agent claim', { exact: false }).first().scrollIntoViewIfNeeded()
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/proof-card-failed.png' })
console.log('docs/proof-card-failed.png')

// 2. Replay: same evidence, earlier policy epoch, verdict flips.
// `name` matches by SUBSTRING, so plain 'Replay' also hits the top-level
// 'Policy & replay' tab and trips strict mode. Only the proof card's tab is
// named exactly 'Replay'.
await page.getByRole('tab', { name: 'Replay', exact: true }).click()
await page.waitForTimeout(800)
await page.locator('button', { hasText: 'finance-policy-v12' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('As recorded', { exact: false }).first().scrollIntoViewIfNeeded()
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/replay-demo.png' })
console.log('docs/replay-demo.png')

// 3. The landing page: the pitch, above the fold.
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.screenshot({ path: 'docs/landing.png' })
console.log('docs/landing.png')

await browser.close()
