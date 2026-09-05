/**
 * Regenerates the committed screenshots from a running production build.
 *
 *   PORT=6100 npm start &  node scripts/screenshot.mjs
 *
 * The console shots are taken from the local server on the evaluation
 * dataset (labelled as such on screen); the Razorpay tab shot is taken from
 * the deployment, because that is the environment whose credentials and
 * model a judge will see.
 */
import { chromium } from 'playwright'

const BASE = process.env.AVOS_SHOT_URL ?? 'http://localhost:6100'
const RZP = process.env.AVOS_RZP_SHOT_URL ?? 'https://avos-razorpay.vercel.app'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 2 })

// 1. The selected settlement — money, verdict, reason, proof — on the evaluation dataset.
await page.goto(BASE + '/console', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.getByRole('button', { name: 'Evaluation dataset', exact: true }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Settlements', exact: true }).first().click()
await page.getByText('₹94,385.56').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'docs/proof-card-failed.png' })
console.log('docs/proof-card-failed.png')

// 2. Replay: same evidence, earlier policy epoch, verdict flips.
await page.getByRole('button', { name: 'Controls', exact: true }).first().click()
await page.waitForTimeout(800)
await page.locator('button', { hasText: 'finance-policy-v12' }).first().click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'docs/replay-demo.png' })
console.log('docs/replay-demo.png')

// 3. The Razorpay overview, from the deployment.
await page.goto(RZP + '/console', { waitUntil: 'networkidle' })
await page.getByText(/Connected|Not configured|Authentication failed|Unavailable|Sync failed/).first().waitFor({ timeout: 90000 })
await page.waitForTimeout(800)
await page.screenshot({ path: 'docs/razorpay-tab.png' })
console.log('docs/razorpay-tab.png')

// 4. The landing page, above the fold.
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.screenshot({ path: 'docs/landing.png' })
console.log('docs/landing.png')

await browser.close()
