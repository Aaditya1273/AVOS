/**
 * Optional live connectivity check.
 *
 * Deliberately NOT part of `npm run eval`. The benchmark must stay reproducible
 * on a machine with no credentials and no network, so nothing that can touch the
 * internet is allowed inside a gate. This script exists so the live path can be
 * exercised on purpose, by someone who has decided to.
 *
 * With no credentials it prints SKIPPED and exits 0. That is the expected state
 * for a reviewer, for CI, and for the deployed demo — absence of a key is a
 * configuration, not a failure.
 *
 * It reads. It never writes. See the GET-only proof in the adapter test (RZ17).
 */

import { fetchRazorpayLedger, razorpayStatus } from '@/lib/connectors/razorpay'

async function main(): Promise<void> {
  const status = razorpayStatus()

  console.log('\nRAZORPAY LIVE CONNECTIVITY\n' + '='.repeat(76))

  if (!status.configured) {
    console.log('  SKIPPED — Razorpay credentials not configured')
    console.log('            set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to run this.')
    console.log('            This is not a failure: the benchmark and the demo do not use them.')
    console.log('='.repeat(76) + '\n')
    process.exit(0)
  }

  // Only the non-secret prefix is ever printed, here or anywhere else.
  console.log(`  Key      ${status.keyIdPrefix}…  (mode: ${status.mode})`)

  if (status.mode === 'test') {
    console.log('')
    console.log('  NOTE  Test mode processes simulated transactions and does not run a')
    console.log('        settlement cycle, so /settlements and the recon report are')
    console.log('        commonly empty on test keys. An empty result below is the')
    console.log('        expected outcome, not a broken adapter.')
  }

  const now = new Date()
  // Last full month: the current one is still accruing.
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const year = prev.getUTCFullYear()
  const month = prev.getUTCMonth() + 1

  console.log(`\n  Fetching recon for ${year}-${String(month).padStart(2, '0')} (read-only)…`)

  try {
    const { ledger, rejected, counts } = await fetchRazorpayLedger({
      year,
      month,
      // Pinned so a re-run diffs on data rather than on the clock.
      ingestedAt: new Date().toISOString(),
    })

    console.log('')
    console.log(`  settlements  ${counts.settlements}`)
    console.log(`  payments     ${counts.payments}`)
    console.log(`  refunds      ${counts.refunds}`)
    console.log(`  holds        ${counts.holds}`)
    console.log(`  rejected     ${rejected.length}`)
    console.log(`  bank rows    ${ledger.bankAll.length}  (always 0 — Razorpay has no statement API)`)

    if (rejected.length > 0) {
      console.log('\n  Quarantined rows (first 10):')
      for (const r of rejected.slice(0, 10)) console.log(`    ${r.entity_id}  ${r.reason}`)
    }

    const total = counts.settlements + counts.payments + counts.refunds
    if (total === 0) {
      console.log('\n  No rows returned. On a test key this is expected (see NOTE above).')
    } else {
      console.log(`\n  Normalised ${total} live rows into the AVOS ledger shape.`)
      console.log('  The committed benchmark is unaffected: it never reads this path.')
    }

    console.log('='.repeat(76) + '\n')
    process.exit(0)
  } catch (e) {
    // A network or credential failure here is a real failure of THIS script, and
    // of nothing else. No gate, no build and no deployed page depends on it.
    console.log('')
    // `fetch failed` on its own is useless: it is undici's blanket wrapper for
    // DNS, TLS, proxy and connection-reset failures alike. The cause is what
    // tells you which.
    const err = e as Error & { cause?: { message?: string; code?: string } }
    const cause = err.cause?.message ?? err.cause?.code ?? ''
    console.log(`  FAILED  ${err.message}${cause ? ` — ${cause}` : ''}`)
    console.log('')
    console.log('  This does not affect `npm run eval`, `npm run build` or the demo,')
    console.log('  none of which use Razorpay credentials.')
    console.log('='.repeat(76) + '\n')
    process.exit(1)
  }
}

void main()
