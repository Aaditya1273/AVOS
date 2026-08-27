import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 760 }, deviceScaleFactor: 2 })
await p.goto('file://' + process.cwd() + '/scripts/architecture-diagram.html')
await p.waitForTimeout(600)
await p.screenshot({ path: 'docs/architecture.png', fullPage: true })
await b.close()
console.log('docs/architecture.png')
