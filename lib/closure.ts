/**
 * The closing step — the end of the finance-ops loop.
 *
 * Everything upstream produces an opinion. This is where the opinion becomes a
 * state change to the books, and the whole system exists to make one invariant
 * true at this line:
 *
 *   **Only VERIFIED may become CLOSED.**
 *
 * Not "the agent said reconciled". Not "confidence was high". Not "it looked
 * fine". The matcher derived a pairing, the pack proved the evidence, the
 * verifier recomputed the money under the policy in force — and only if that
 * chain ends in VERIFIED does anything close.
 *
 * The function is total and takes no options, deliberately. An `force` or
 * `override` parameter is how invariants die: it appears for one urgent case and
 * is load-bearing by the next quarter. If a human needs to close something AVOS
 * refused, that belongs in a separate, separately-audited action — not as a flag
 * on this one.
 */

import type { Closure, Decision, Paise, ReasonCode } from '@/lib/types'

/**
 * Severity weight per reason code, for queue ordering.
 *
 * Not a judgement about how "bad" each finding is — it is about how much money
 * moves if it is ignored. A duplicate credit double-pays; a stale policy stamp
 * is a provenance defect on money that is probably fine. An operator with forty
 * exceptions and an afternoon needs that ordering.
 */
const SEVERITY: Record<ReasonCode, number> = {
  DUPLICATE_PAYMENT_ID_CONFLICT: 1.0,
  DUPLICATE_FILE: 1.0,
  DUPLICATE_EVENT: 1.0,
  DUPLICATE_UTR: 1.0,
  OVER_REFUND: 0.95,
  NON_REPRODUCIBLE: 0.95,
  CONTRADICTORY_SOURCE: 0.9,
  AMOUNT_MISMATCH: 0.85,
  FEE_MISMATCH: 0.8,
  POLICY_BREACH: 0.75,
  TEMPORAL_INCONSISTENCY: 0.6,
  MISSING_EVIDENCE: 0.5,
  MALFORMED_EVIDENCE: 0.5,
  STALE_EVIDENCE: 0.4,
  STALE_POLICY: 0.3,
}

/**
 * What a reviewer would have to produce to make this record closeable.
 *
 * The difference between a system that says "I don't know" and one that is
 * actually useful. Derived from the failing checks rather than written as a
 * lookup table, so it cannot drift away from what the verifier actually wanted.
 */
function requiredEvidence(d: Decision): string[] {
  const need: string[] = []
  const kinds = new Set(d.pack.evidence.map((e) => e.kind))
  const match = d.pack.match

  if (match?.status === 'UNMATCHED') {
    need.push(
      `A bank credit for ${d.result.settlement_id} dated on or after ${d.pack.event_time.slice(0, 10)} — none was found in the settlement window.`,
    )
  }
  if (match?.status === 'AMBIGUOUS') {
    need.push(
      `A reference (UTR) on one of the tied credits ${match.matched_row_ids.join(', ')} — they are identical in amount and date, so nothing distinguishes them.`,
    )
  }
  if (!kinds.has('payment')) need.push('Payment-level rows for this settlement; the fee cannot be recomputed without them.')
  if (!kinds.has('settlement')) need.push('The settlement record itself.')

  switch (d.result.reason_code) {
    case 'STALE_POLICY':
      need.push(`Re-stamp the pack with ${d.pack.decision_policy_version}, the policy actually in force at decision time.`)
      break
    case 'STALE_EVIDENCE':
      need.push('A fresher ingestion of the source rows; these were already outside the freshness window when the decision was taken.')
      break
    case 'CONTRADICTORY_SOURCE':
      need.push('A supersession marker identifying which restatement of this settlement is authoritative.')
      break
    case 'FEE_MISMATCH':
      need.push('Confirmation of the contracted rate card for this merchant, or a corrected settlement fee line.')
      break
    default:
      break
  }
  return need
}

function summarise(d: Decision, status: Closure['status']): string {
  const m = d.pack.match
  if (status === 'CLOSED') {
    return `Recomputed net matches the credited amount within policy tolerance. Closed against ${d.pack.evidence.length} evidence rows.`
  }
  if (m?.status === 'AMBIGUOUS') {
    return `${m.matched_row_ids.length} bank credits are indistinguishable for this settlement. Closing would pick one at random.`
  }
  if (m?.status === 'UNMATCHED') {
    return 'No bank credit could be matched to this settlement inside its window.'
  }
  return d.result.reason_code
    ? `Verification failed: ${d.result.reason_code.toLowerCase().replace(/_/g, ' ')}.`
    : 'Verification did not complete.'
}

/**
 * Decide, and record, what happened to one record.
 *
 * `closedAt` is passed in rather than read from a clock so that a batch closes
 * at one instant and the result is reproducible. A closure timestamp that
 * changes on every run is not an audit trail.
 */
export function closeRecord(d: Decision, closedAt: string): Closure {
  const value: Paise = d.batch_value_paise

  // THE INVARIANT. Everything else in this repository exists to make this line
  // safe, and nothing may route around it.
  const status: Closure['status'] =
    d.result.verdict === 'VERIFIED'
      ? 'CLOSED'
      : d.result.verdict === 'UNCERTAIN'
        ? 'REFUSED_TO_CLOSE'
        : 'FAILED'

  const severity = d.result.reason_code ? SEVERITY[d.result.reason_code] : 0
  return {
    status,
    closed_at: status === 'CLOSED' ? closedAt : null,
    value_paise: value,
    summary: summarise(d, status),
    required_evidence: status === 'CLOSED' ? [] : requiredEvidence(d),
    // Money first, severity second. An operator works the queue top-down.
    priority: status === 'CLOSED' ? 0 : Math.round(value * (0.5 + severity / 2)),
  }
}

export interface BatchClosure {
  closed: number
  refused: number
  failed: number
  closed_value_paise: Paise
  /** Money AVOS declined to close. The headline "value protected" figure. */
  withheld_value_paise: Paise
  total_value_paise: Paise
}

export function summariseBatch(closures: Closure[]): BatchClosure {
  const out: BatchClosure = {
    closed: 0,
    refused: 0,
    failed: 0,
    closed_value_paise: 0,
    withheld_value_paise: 0,
    total_value_paise: 0,
  }
  for (const c of closures) {
    out.total_value_paise += c.value_paise
    if (c.status === 'CLOSED') {
      out.closed += 1
      out.closed_value_paise += c.value_paise
    } else {
      if (c.status === 'REFUSED_TO_CLOSE') out.refused += 1
      else out.failed += 1
      out.withheld_value_paise += c.value_paise
    }
  }
  return out
}
