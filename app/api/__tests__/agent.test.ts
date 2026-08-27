/**
 * The agent boundary, tested at the seam rather than through the network.
 *
 * These drive `proposeClaim` and `verifyClaim` directly instead of booting a
 * server and issuing HTTP. That is deliberate: the property under test is that
 * nothing the agent produces except `claim` can influence a verdict, and a
 * request/response test proves that only for the one route that happens to be
 * wired correctly today. Testing the seam proves it for every caller.
 *
 * No network. The provider falls back to its deterministic mock whenever
 * `OPENAI_API_KEY` is unset, and these run with it unset.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { proposeClaim } from '@/lib/ai/agent'
import { verifyClaim } from '@/lib/verifier/deterministic'
import { buildEvidencePack } from '@/lib/evidence/pack'
import { loadCases } from '@/lib/data/ledger'
import { USING_MOCK } from '@/lib/ai/provider'
import type { EvidencePack, StructuredClaim } from '@/lib/types'

function packFor(caseId: string): EvidencePack {
  const c = loadCases('batch_120').find((x) => x.case_id === caseId)
  if (!c) throw new Error(`fixture case ${caseId} missing`)
  return buildEvidencePack(c)
}

beforeAll(() => {
  // If a key leaked into the environment these would make real calls and cost
  // money. Fail loudly rather than silently billing someone.
  expect(USING_MOCK, 'these tests must run on the offline mock').toBe(true)
})

describe('agent boundary', () => {
  it('emits a claim with exactly three fields — no prose, no confidence', async () => {
    const proposal = await proposeClaim(packFor('B092'))
    expect(Object.keys(proposal.claim).sort()).toEqual([
      'evidence_ids',
      'proposed_status',
      'settlement_id',
    ])
    // Both exist on the proposal, and neither is on the claim. That is the seam.
    expect(proposal.agent_reason.length).toBeGreaterThan(0)
    expect(proposal.confidence).toBeGreaterThan(0)
  })

  it('a hallucinated evidence id is reported but does not contribute a reason code', () => {
    const pack = packFor('B001')
    const honest: StructuredClaim = {
      settlement_id: pack.settlement_id,
      proposed_status: 'RECONCILED',
      evidence_ids: pack.evidence.map((e) => e.evidence_id),
    }
    const lying: StructuredClaim = {
      ...honest,
      evidence_ids: [...honest.evidence_ids, 'bank_statement:bnk-DOES-NOT-EXIST'],
    }

    const a = verifyClaim(honest, pack, pack.policy_snapshot)
    const b = verifyClaim(lying, pack, pack.policy_snapshot)

    // The check fails and says so.
    const check = b.checks.find((c) => c.id === 'agent_citation_coverage')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('bnk-DOES-NOT-EXIST')

    // And the verdict does not move. An agent that could force UNCERTAIN by
    // citing garbage would have a lever over the outcome, which is the exact
    // thing this architecture exists to deny it.
    expect(b.verdict).toBe(a.verdict)
    expect(b.reason_code).toBe(a.reason_code)
  })

  it('omitting an inconvenient row does not change the verdict either', () => {
    // The verifier scores the whole retrieved pack, so dropping the second bank
    // credit from the citation list cannot hide a duplicate.
    const pack = packFor('B020')
    const all = pack.evidence.map((e) => e.evidence_id)
    const dropped = pack.evidence.filter((e) => e.kind === 'bank_credit')[1]

    const full = verifyClaim(
      { settlement_id: pack.settlement_id, proposed_status: 'RECONCILED', evidence_ids: all },
      pack,
      pack.policy_snapshot,
    )
    const partial = verifyClaim(
      {
        settlement_id: pack.settlement_id,
        proposed_status: 'RECONCILED',
        evidence_ids: all.filter((id) => id !== dropped?.evidence_id),
      },
      pack,
      pack.policy_snapshot,
    )

    expect(full.verdict).toBe(partial.verdict)
    expect(full.reason_code).toBe(partial.reason_code)
    expect(full.observed_paise).toBe(partial.observed_paise)
  })

  it('proposed_status does not steer the verdict', async () => {
    // AVOS reports the financial state. An agent claiming NOT_RECONCILED on
    // clean money must not turn it into an exception.
    const pack = packFor('B001')
    const ids = pack.evidence.map((e) => e.evidence_id)
    const verdicts = (['RECONCILED', 'NOT_RECONCILED', 'NEEDS_REVIEW'] as const).map(
      (proposed_status) =>
        verifyClaim(
          { settlement_id: pack.settlement_id, proposed_status, evidence_ids: ids },
          pack,
          pack.policy_snapshot,
        ).verdict,
    )
    expect(new Set(verdicts).size).toBe(1)
  })
})
