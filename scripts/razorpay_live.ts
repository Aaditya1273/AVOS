/**
 * The real-network integration check.
 *
 * Deliberately NOT part of `npm run eval`. The benchmark must stay reproducible
 * on a machine with no credentials and no network, so nothing that can touch
 * the internet is allowed inside a gate. This script exists so the product path
 * can be exercised on purpose, end to end, by someone who has decided to.
 *
 * It runs exactly what the console runs — `syncRazorpay()` — and prints the
 * activity log, the connection state, the counts, and how far each settlement
 * got through the pipeline. It reads. It never writes.
 *
 * Exit codes: 0 when the connection is CONNECTED (even with zero records) or
 * NOT_CONFIGURED (skipped); 1 when credentials are present but the API could
 * not be reached or rejected them. Never printed: the key id beyond its
 * `rzp_test_` prefix, the secret, or any header.
 */

import { syncRazorpay } from '@/lib/razorpay/runtime'

const line = '='.repeat(76)

async function main(): Promise<void> {
  console.log('\nRAZORPAY LIVE — PRODUCT PATH\n' + line)
  const p = await syncRazorpay()

  if (p.connection.state === 'NOT_CONFIGURED') {
    console.log('  SKIPPED — Razorpay credentials not configured')
    console.log('            set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to run this.')
    console.log('            This is not a failure: the evaluation does not use them.')
    console.log(line + '\n')
    process.exit(0)
  }

  console.log(`  Key         ${p.connection.key_id_prefix}…  (mode: ${p.mode})`)
  console.log(`  Connection  ${p.connection.state} — ${p.connection.detail}`)
  console.log(`  Fetched at  ${p.fetched_at}`)
  console.log('')
  console.log('  API activity (all GET):')
  for (const a of p.activity) {
    const status = a.status === null ? 'no response' : `HTTP ${a.status}`
    const count = a.count === null ? '' : `  count=${a.count}`
    console.log(`    ${a.method} ${a.endpoint.padEnd(34)} ${status.padEnd(12)}${count}  ${a.elapsed_ms}ms`)
    if (a.error) console.log(`      error: ${a.error}`)
  }
  console.log('')
  console.log(`  settlements  ${p.counts.settlements}`)
  console.log(`  recon rows   ${p.counts.recon_rows}`)
  console.log(`  payments     ${p.counts.payments}`)
  console.log(`  refunds      ${p.counts.refunds}`)
  console.log(`  rejected     ${p.rejected.length}`)
  console.log(`  bank rows    0  (always — Razorpay has no bank-statement endpoint)`)
  console.log('')
  console.log(`  AI agent     ${p.agent.state.toUpperCase()} — ${p.agent.detail}`)
  console.log(`  Verifier     ${p.verifier_version}`)
  console.log('')

  if (p.cases.length === 0) {
    console.log(`  Outcome      ${p.outcome} — 0 settlement cases. Nothing was substituted.`)
    if (p.mode === 'test') {
      console.log('               Test mode runs no settlement cycle, so this is the usual state')
      console.log('               of a test account. Payments made in test mode appear under')
      console.log(`               "unsettled" (${p.unsettled.payments.length} here) and cannot be`)
      console.log('               verified until Razorpay settles them.')
    }
  } else {
    console.log(`  Outcome      ${p.outcome} — ${p.cases.length} settlement case(s):`)
    for (const c of p.cases) {
      const verdict = c.result ? `${c.result.verdict}${c.result.reason_code ? ' ' + c.result.reason_code : ''}` : 'no verdict (no agent claim)'
      const closure = c.closure ? c.closure.status : '—'
      console.log(`    ${c.settlement_id.padEnd(22)} evidence=${c.pack.evidence.length}  ${verdict.padEnd(32)} ${closure}`)
    }
  }
  console.log(line + '\n')
  process.exit(p.connection.state === 'CONNECTED' ? 0 : 1)
}

void main()
