/**
 * One real model call on the product path, against the committed
 * Razorpay-shaped fixture. Proves the configured provider actually returns a
 * schema-valid StructuredClaim through `proposeClaimStrict`, then hands it to
 * the verifier exactly as the console does. Not a gate: it costs a request.
 *
 * SKIPPED (exit 0) with no key. Never prints a key.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeRazorpay } from '@/lib/connectors/razorpay'
import { casesFromLedger } from '@/lib/razorpay/runtime'
import { buildEvidencePack } from '@/lib/evidence/pack'
import { proposeClaimStrict } from '@/lib/ai/agent'
import { verifyClaim } from '@/lib/verifier/deterministic'
import { modelAvailability } from '@/lib/ai/provider'

async function main(): Promise<void> {
  console.log('\nMODEL LIVE — PRODUCT PATH\n' + '='.repeat(76))
  const m = modelAvailability()
  if (!m.available) {
    console.log(`  SKIPPED — ${m.detail}`)
    console.log('='.repeat(76) + '\n')
    process.exit(0)
  }
  console.log(`  ${m.detail}`)
  const dir = path.join(process.cwd(), 'data', 'fixtures', 'razorpay')
  const recon = JSON.parse(readFileSync(path.join(dir, 'recon-report.json'), 'utf8'))
  const settlements = JSON.parse(readFileSync(path.join(dir, 'settlements.json'), 'utf8'))
  const now = new Date().toISOString()
  const { ledger } = normalizeRazorpay(recon, settlements, { ingestedAt: now, merchantId: 'RZP-TEST' })
  const [c] = casesFromLedger(ledger, now)
  const pack = buildEvidencePack(c, { ledger })

  const started = performance.now()
  try {
    const proposal = await proposeClaimStrict(pack)
    const ms = Math.round(performance.now() - started)
    console.log(`  Model        ${proposal.model_version}  (${ms} ms, used_mock=${proposal.used_mock})`)
    console.log(`  Claim        ${proposal.claim.proposed_status}  citing ${proposal.claim.evidence_ids.length}/${pack.evidence.length} rows`)
    console.log(`  Confidence   ${proposal.confidence.toFixed(2)}  (severed — not a verifier input)`)
    console.log(`  Rationale    ${proposal.agent_reason.slice(0, 140)}${proposal.agent_reason.length > 140 ? '…' : ''}`)
    const r = verifyClaim(proposal.claim, pack, pack.policy_snapshot, now)
    console.log(`  Verifier     ${r.verdict}${r.reason_code ? ' ' + r.reason_code : ''}  (${r.verifier_version})`)
    console.log('='.repeat(76) + '\n')
    process.exit(0)
  } catch (e) {
    console.log(`  FAILED  ${(e as Error).message.slice(0, 300)}`)
    console.log('='.repeat(76) + '\n')
    process.exit(1)
  }
}

void main()
