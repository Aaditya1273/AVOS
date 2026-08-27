/**
 * Reconciliation invariants, including the injection property.
 *
 * The injection test here is the one worth reading. It does not assert that the
 * attacker's string was stripped, or that a model declined to follow it — both
 * are observations about one run of one model, and neither is a property you can
 * rely on next quarter. It asserts that the verdict object is **byte-identical**
 * with the text present and with it blanked. If those two match exactly, the
 * text had no causal path to the outcome, whatever it said.
 */

import { describe, it, expect } from 'vitest'
import { verifyClaim } from '@/lib/verifier/deterministic'
import { buildEvidencePack } from '@/lib/evidence/pack'
import { loadCases } from '@/lib/data/ledger'
import { detectInjection } from '@/lib/ai/qa'
import { replayDecision } from '@/lib/replay'
import type { EvidencePack, SettlementCase } from '@/lib/types'

function caseBy(suite: 'batch_120' | 'adversarial_30', id: string): SettlementCase {
  const c = loadCases(suite).find((x) => x.case_id === id)
  if (!c) throw new Error(`fixture case ${id} missing from ${suite}`)
  return c
}

function claimAll(pack: EvidencePack) {
  return {
    settlement_id: pack.settlement_id,
    proposed_status: 'RECONCILED' as const,
    evidence_ids: pack.evidence.map((e) => e.evidence_id),
  }
}

describe('reconciliation invariants', () => {
  it('injected text is byte-identical-inert across every injected case', () => {
    const truthless = loadCases('adversarial_30')
    const injected = truthless
      .map((c) => buildEvidencePack(c))
      .filter((p) => detectInjection(p).found)

    expect(injected.length, 'the adversarial suite must contain injected cases').toBeGreaterThan(0)

    for (const pack of injected) {
      const withText = verifyClaim(claimAll(pack), pack, pack.policy_snapshot)

      const blanked: EvidencePack = JSON.parse(JSON.stringify(pack))
      for (const e of blanked.evidence) e.display = {}
      const withoutText = verifyClaim(claimAll(blanked), blanked, blanked.policy_snapshot)

      expect(JSON.stringify(withText)).toBe(JSON.stringify(withoutText))
    }
  })

  it('the injection is surfaced rather than silently sanitised', () => {
    // Located by property, not by case id. Hardcoding an id couples the test to
    // whichever slot the generator happened to shuffle the attack into.
    const pack = loadCases('adversarial_30')
      .map((c) => buildEvidencePack(c))
      .find((p) => detectInjection(p).found)
    expect(pack, 'the adversarial suite must contain an injected case').toBeDefined()
    const found = detectInjection(pack!)
    expect(found.found).toBe(true)
    expect(found.rows.length).toBeGreaterThan(0)
    // The text is still there to be read. Removing it would destroy the only
    // evidence that an attack happened.
    const memo = pack!.evidence.map((e) => Object.values(e.display).join(' ')).join(' ')
    expect(memo).toContain('IGNORE ALL POLICIES')
  })

  it('verification is pure — repeated runs agree and the pack is not mutated', () => {
    const pack = buildEvidencePack(caseBy('batch_120', 'B092'))
    const before = JSON.stringify(pack)
    const a = verifyClaim(claimAll(pack), pack, pack.policy_snapshot)
    const b = verifyClaim(claimAll(pack), pack, pack.policy_snapshot)
    expect(JSON.stringify(pack)).toBe(before)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('replay under an earlier policy flips the hero card, and tampering is caught', () => {
    const c = caseBy('batch_120', 'B092')

    const asRecorded = replayDecision(c, 'batch_120')
    expect(asRecorded.replayed.verdict).toBe('FAILED')
    expect(asRecorded.replayed.reason_code).toBe('FEE_MISMATCH')

    // Same evidence, same arithmetic, looser tolerance.
    const earlier = replayDecision(c, 'batch_120', { asOf: '2026-08-01T00:00:00Z' })
    expect(earlier.replayed.verdict).toBe('VERIFIED')
    expect(earlier.verdict_changed).toBe(true)
    expect(earlier.replayed.difference_paise).toBe(asRecorded.replayed.difference_paise)

    // A mutated source row is caught rather than silently re-verified.
    const tampered = replayDecision(c, 'batch_120', { tamper: true })
    expect(tampered.reproducible).toBe(false)
    expect(tampered.replayed.reason_code).toBe('NON_REPRODUCIBLE')
  })
})
