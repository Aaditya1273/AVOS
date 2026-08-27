/**
 * Capture the two screenshots the README embeds.
 *
 * Run against a production build so what is captured is what ships:
 *   npm run build && PORT=3800 npm start
 *   node scripts/screenshot.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.AVOS_SHOT_URL ?? 'http://localhost:3800'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 2 })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=AVOS verdict', { timeout: 20000 })
await page.waitForTimeout(1200)

// 1. The hero Proof Card: agent claim struck through beside the refusal.
await page.locator('text=AGENT CLAIM').first().scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await page.screenshot({ path: 'docs/proof-card-failed.png' })
console.log('docs/proof-card-failed.png')

// 2. Replay: same evidence, earlier policy epoch, verdict flips.
await page.getByRole('tab', { name: 'Replay' }).click()
await page.waitForTimeout(500)
await page.locator('button', { hasText: 'finance-policy-v12' }).first().click()
await page.waitForSelector('text=verdict changed', { timeout: 20000 })
await page.waitForTimeout(900)
// Frame the transition itself, not the control that triggered it.
await page.locator('text=As recorded').first().scrollIntoViewIfNeeded()
await page.waitForTimeout(500)
await page.screenshot({ path: 'docs/replay-demo.png' })
console.log('docs/replay-demo.png')

await browser.close()
