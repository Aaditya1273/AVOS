/**
 * Historical replay.
 *
 * One sentence justifies this whole module:
 *
 *   **A historical decision is evaluated under the policy that existed when the
 *   decision occurred, not the policy that exists today.**
 *
 * Most systems get this wrong in a way that never shows up until an audit. They
 * store a verdict, and when someone asks "why was this closed?", they re-run
 * today's rules against yesterday's evidence and get an answer that has nothing
 * to do with the decision that was actually taken. The verdict looks
 * reproducible because nobody checked what it was reproduced *against*.
 *
 * Replay makes the policy epoch an explicit parameter, so both questions can be
 * asked and answered separately:
 *
 *   "Was this decision right at the time?"  -> replay as-of decision_time
 *   "Would we take it today?"               -> replay as-of now
 *
 * And it makes a third question answerable at all:
 *
 *   "Is the evidence still what it was?"    -> compare content hashes
 *
 * A settlement with a ₹120 fee delta is VERIFIED under a ₹150 tolerance and
 * FAILED under a ₹50 one. Same rows, same arithmetic, same verifier build — a
 * different answer, for a reason that is written down and dated. That is what
 * auditability means in practice, and it is not something you can retrofit.
 */

import { materializeDecision, loadDecisionLog } from '@/lib/decisions'
import { POLICY_SNAPSHOTS } from '@/lib/policy/snapshots'
import type { Suite } from '@/lib/data/ledger'
import type { ReplayResult, SettlementCase } from '@/lib/types'

export interface ReplayOptions {
  /** Evaluate under the policy in force at this instant. Defaults to decision_time. */
  asOf?: string
  /**
   * Perturb one evidence row in memory before hashing, to demonstrate that a
   * mutated source is caught rather than silently re-verified. Pass `true` to
   * target the first bank credit, or an explicit evidence_id.
   */
  tamper?: boolean | string
}

export function replayDecision(
  c: SettlementCase,
  suite: Suite,
  opts: ReplayOptions = {},
): ReplayResult {
  const log = loadDecisionLog()

  // The decision as it stands: decision-time policy, untampered evidence.
  const original = materializeDecision(c, suite, log)

  let tamperEvidenceId: string | undefined
  if (opts.tamper === true) {
    tamperEvidenceId =
      original.pack.evidence.find((e) => e.kind === 'bank_credit')?.evidence_id ??
      original.pack.evidence[0]?.evidence_id
  } else if (typeof opts.tamper === 'string') {
    tamperEvidenceId = opts.tamper
  }

  const asOf = opts.asOf ?? c.decision_time
  const replayedDecision = materializeDecision(c, suite, log, { asOf, tamperEvidenceId })

  const changedEvidence = replayedDecision.pack.evidence
    .filter((e) => !e.hash_matches_recorded)
    .map((e) => e.evidence_id)

  const originalPolicy = original.result.policy_version
  const replayedPolicy = replayedDecision.result.policy_version
  const policyChanged = originalPolicy !== replayedPolicy
  const verdictChanged =
    original.result.verdict !== replayedDecision.result.verdict ||
    original.result.reason_code !== replayedDecision.result.reason_code

  return {
    case_id: c.case_id,
    settlement_id: c.settlement_id,
    original: original.result,
    replayed: replayedDecision.result,
    as_of: asOf,
    verdict_changed: verdictChanged,
    policy_changed: policyChanged,
    reproducible: changedEvidence.length === 0,
    changed_evidence_ids: changedEvidence,
    narrative: narrate({
      settlementId: c.settlement_id,
      asOf,
      policyChanged,
      verdictChanged,
      originalPolicy,
      replayedPolicy,
      originalVerdict: original.result.verdict,
      replayedVerdict: replayedDecision.result.verdict,
      originalTolerance: original.result.tolerance_paise,
      replayedTolerance: replayedDecision.result.tolerance_paise,
      difference: replayedDecision.result.difference_paise,
      changedEvidence,
      hasBaseline: Boolean(log?.entries[c.case_id]),
    }),
  }
}

interface NarrateInput {
  settlementId: string
  asOf: string
  policyChanged: boolean
  verdictChanged: boolean
  originalPolicy: string
  replayedPolicy: string
  originalVerdict: string
  replayedVerdict: string
  originalTolerance: number | null
  replayedTolerance: number | null
  difference: number | null
  changedEvidence: string[]
  hasBaseline: boolean
}

function rupees(paise: number | null): string {
  if (paise === null) return '—'
  return `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function narrate(i: NarrateInput): string {
  if (!i.hasBaseline) {
    return (
      `No recorded baseline for ${i.settlementId}, so reproducibility cannot be asserted. ` +
      'Run `npm run eval` to write the decision log, then replay.'
    )
  }

  if (i.changedEvidence.length > 0) {
    return (
      `NON-REPRODUCIBLE. ${i.changedEvidence.length} evidence row(s) no longer hash to the values ` +
      `recorded when this decision was taken (${i.changedEvidence.join(', ')}). ` +
      'The source changed after the fact, so no verdict computed from it can be trusted — ' +
      'including a verdict that would otherwise have passed.'
    )
  }

  if (i.policyChanged && i.verdictChanged) {
    return (
      `Replayed as of ${i.asOf}. The evidence is byte-identical and the arithmetic is unchanged; ` +
      `the difference of ${rupees(i.difference)} is exactly what it was. The verdict moves from ` +
      `${i.originalVerdict} to ${i.replayedVerdict} because the policy in force moved from ` +
      `${i.originalPolicy} (fee tolerance ${rupees(i.originalTolerance)}) to ${i.replayedPolicy} ` +
      `(fee tolerance ${rupees(i.replayedTolerance)}). Historical decisions are evaluated using the ` +
      'policy that existed when the decision occurred.'
    )
  }

  if (i.policyChanged) {
    return (
      `Replayed as of ${i.asOf} under ${i.replayedPolicy} instead of ${i.originalPolicy}. ` +
      `The verdict is unchanged at ${i.replayedVerdict} — the difference of ${rupees(i.difference)} ` +
      'falls on the same side of both tolerances.'
    )
  }

  return (
    `Replayed as of ${i.asOf}. Same policy (${i.replayedPolicy}), same evidence hashes, ` +
    `same verdict: ${i.replayedVerdict}. Fully reproducible.`
  )
}

/**
 * The replay presets the UI offers: one per policy epoch, plus a point just
 * before the first change so "the old rules" is always reachable.
 */
export function policyChangePoints(): { label: string; at: string; tolerance_paise: number }[] {
  return POLICY_SNAPSHOTS.map((p) => ({
    label: p.version,
    at: p.effective_at,
    tolerance_paise: p.fee_tolerance_paise,
  }))
}
