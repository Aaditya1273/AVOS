/**
 * THE MATCHING ENGINE — the front half of the finance-ops loop.
 *
 * Everything downstream of this file verifies a pairing. This file *derives*
 * one, and that is a different and harder job.
 *
 * The earlier build skipped it: the settlement row carried a UTR, the bank row
 * carried the same UTR, and retrieval was an equality lookup. That verifies
 * arithmetic on a match somebody else made. Reconciliation is deciding which
 * bank credit belongs to which settlement when the reference is missing,
 * truncated, duplicated, or attached to the wrong row — which is the situation
 * a finance team is actually in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DETERMINISTIC, AND NOT A MODEL
 *
 * A language model would be good at this. It would also make the match
 * unauditable, because "these two look like a match" cannot be replayed, cannot
 * be explained to a regulator, and cannot be shown to have produced the same
 * answer last quarter.
 *
 * So the match is scored by fixed rules over fixed features, and every decision
 * carries the reason codes that produced it. AI sits either side — proposing
 * what to look at, explaining what failed — and never inside.
 *
 * The engine has three outcomes, and the middle one is the point:
 *
 *   MATCHED     exactly one candidate clears the bar, and it clears it by a
 *               margin over the runner-up
 *   AMBIGUOUS   two or more candidates are indistinguishable. This is NOT an
 *               error and must never be silently resolved by picking the first.
 *               Two credits of the same amount in the same window is the
 *               classic double-payout, and guessing turns a detectable problem
 *               into an undetectable one.
 *   UNMATCHED   nothing clears the bar
 *
 * Only MATCHED proceeds toward closure. The other two are exceptions with a
 * money value attached.
 * ---------------------------------------------------------------------------
 *
 * Pure and importless by the same contract as the verifier: no clock, no
 * randomness, no I/O. Same inputs, same match, forever.
 */

import type { Paise, PolicySnapshot } from '@/lib/types'

export const MATCHER_VERSION = 'matcher-v1.0'

/** Minimum total score for a candidate to be considered at all. */
const SCORE_THRESHOLD = 0.5

/**
 * How far the best candidate must beat the runner-up to be called unambiguous.
 *
 * Without this the engine picks a winner from a coin-flip and reports high
 * confidence, which is worse than reporting nothing: it converts "two identical
 * credits, please look" into "matched, closed".
 */
const AMBIGUITY_MARGIN = 0.12

export type MatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'

export type MatchReason =
  | 'REFERENCE_EXACT'
  | 'REFERENCE_PARTIAL'
  | 'REFERENCE_ABSENT'
  | 'AMOUNT_EXACT'
  | 'AMOUNT_WITHIN_TOLERANCE'
  | 'AMOUNT_OUTSIDE_TOLERANCE'
  | 'DATE_SAME_DAY'
  | 'DATE_WITHIN_WINDOW'
  | 'DATE_OUTSIDE_WINDOW'
  | 'TIED_WITH_RUNNER_UP'
  | 'NO_CANDIDATES_IN_WINDOW'

/** What the matcher is asked to find a counterpart for. */
export interface MatchSubject {
  settlement_id: string
  /** The reference the settlement believes it was paid under. May be absent. */
  utr: string
  /** The settlement's own declared net — a hint, never the truth. */
  declared_net_paise: Paise
  settled_at: string
}

/** A bank credit that might be the counterpart. */
export interface MatchCandidateRow {
  row_id: string
  /** Often blank, truncated or malformed in a real export. */
  utr: string
  credit_paise: Paise
  value_date: string
}

export interface ScoredCandidate {
  row_id: string
  score: number
  reasons: MatchReason[]
  amount_delta_paise: Paise
  date_delta_days: number
}

export interface MatchResult {
  settlement_id: string
  status: MatchStatus
  /** The chosen counterpart, when exactly one clears the bar. */
  matched_row_ids: string[]
  /** 0–1. Derived from the score, not self-reported by anything. */
  confidence: number
  reasons: MatchReason[]
  candidates: ScoredCandidate[]
  matcher_version: string
}

const DAY_MS = 86_400_000

/** Strip everything a bank might mangle, so two spellings of one reference compare equal. */
function normaliseRef(ref: string): string {
  return (ref ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Reference similarity, deliberately conservative.
 *
 * Exact match scores 1. A genuine prefix or suffix relationship — which is what
 * truncation produces — scores 0.6 and only when the shared run is long enough
 * to be improbable. Anything else scores 0.
 *
 * No edit distance. Two unrelated UTRs differing in one character are far more
 * likely to be two different payouts than one payout typed twice, and a fuzzy
 * matcher that "helpfully" joins them creates a reconciliation error that is
 * invisible precisely because it looks resolved.
 */
function referenceScore(a: string, b: string): { score: number; reason: MatchReason } {
  const x = normaliseRef(a)
  const y = normaliseRef(b)
  if (x === '' || y === '') return { score: 0, reason: 'REFERENCE_ABSENT' }
  if (x === y) return { score: 1, reason: 'REFERENCE_EXACT' }

  const [longer, shorter] = x.length >= y.length ? [x, y] : [y, x]
  if (shorter.length >= 8 && (longer.startsWith(shorter) || longer.endsWith(shorter))) {
    return { score: 0.6, reason: 'REFERENCE_PARTIAL' }
  }
  return { score: 0, reason: 'REFERENCE_ABSENT' }
}

function amountScore(
  declared: Paise,
  credited: Paise,
  tolerance: Paise,
): { score: number; reason: MatchReason; delta: Paise } {
  const delta = declared - credited
  const abs = Math.abs(delta)
  if (abs === 0) return { score: 1, reason: 'AMOUNT_EXACT', delta }
  if (abs <= tolerance) return { score: 0.8, reason: 'AMOUNT_WITHIN_TOLERANCE', delta }

  // Beyond tolerance the amount still carries information — a credit 0.5% out is
  // a better candidate than one 40% out — but it can no longer carry a match on
  // its own. Decays to zero at ten times tolerance.
  const decayed = Math.max(0, 0.5 - abs / (tolerance * 20 || 1))
  return { score: decayed, reason: 'AMOUNT_OUTSIDE_TOLERANCE', delta }
}

function dateScore(
  settledAt: string,
  valueDate: string,
  maxLagDays: number,
): { score: number; reason: MatchReason; deltaDays: number } {
  const s = Date.parse(settledAt)
  const v = Date.parse(valueDate)
  if (!Number.isFinite(s) || !Number.isFinite(v)) {
    return { score: 0, reason: 'DATE_OUTSIDE_WINDOW', deltaDays: Number.NaN }
  }
  // Settlement precedes credit. A credit dated before the settlement is not a
  // late payment, it is a different payment.
  const deltaDays = Math.floor((v - s) / DAY_MS)
  if (deltaDays < 0) return { score: 0, reason: 'DATE_OUTSIDE_WINDOW', deltaDays }
  if (deltaDays === 0) return { score: 1, reason: 'DATE_SAME_DAY', deltaDays }
  if (deltaDays <= maxLagDays) {
    return { score: 1 - (deltaDays / (maxLagDays + 1)) * 0.4, reason: 'DATE_WITHIN_WINDOW', deltaDays }
  }
  return { score: 0, reason: 'DATE_OUTSIDE_WINDOW', deltaDays }
}

/**
 * Weights, tuned so a credit with NO usable reference can still be matched on
 * amount and date alone. That case is the majority of real reconciliation work:
 * bank exports drop, truncate and mangle references constantly, and a matcher
 * that needs one is a matcher that gives up exactly when it is needed.
 *
 * Exact amount plus a same-day credit scores 0.60; exact amount at the far edge
 * of a T+3 window scores 0.54. Both clear the 0.5 bar. A credit whose amount is
 * outside tolerance scores about 0.28 even on the right day, and does not.
 *
 * Reference dominates when present, but cannot carry a match alone —
 * a correct UTR against a wildly wrong amount is a mis-posted payment, not a
 * reconciliation, and the engine should say so rather than tidy it away.
 */
const W_REFERENCE = 0.4
const W_AMOUNT = 0.4
const W_DATE = 0.2

export function matchSettlement(
  subject: MatchSubject,
  rows: MatchCandidateRow[],
  policy: PolicySnapshot,
): MatchResult {
  const tolerance = policy.fee_tolerance_paise
  const maxLag = policy.max_settlement_lag_days

  const candidates: ScoredCandidate[] = []
  for (const row of rows) {
    const date = dateScore(subject.settled_at, row.value_date, maxLag)
    // A hard constraint, not a weight. Outside the window it is not a candidate
    // at all, however well the amount happens to line up.
    if (date.score === 0) continue

    const ref = referenceScore(subject.utr, row.utr)
    const amt = amountScore(subject.declared_net_paise, row.credit_paise, tolerance)

    candidates.push({
      row_id: row.row_id,
      score:
        Math.round((ref.score * W_REFERENCE + amt.score * W_AMOUNT + date.score * W_DATE) * 1000) /
        1000,
      reasons: [ref.reason, amt.reason, date.reason],
      amount_delta_paise: amt.delta,
      date_delta_days: date.deltaDays,
    })
  }

  // Deterministic ordering. row_id breaks score ties so two runs never disagree
  // about which candidate is "first" — a tie is reported as a tie, not resolved
  // by whichever order the loader happened to produce.
  candidates.sort((a, b) => (b.score - a.score) || a.row_id.localeCompare(b.row_id))

  const base = {
    settlement_id: subject.settlement_id,
    candidates,
    matcher_version: MATCHER_VERSION,
  }

  if (candidates.length === 0) {
    return {
      ...base,
      status: 'UNMATCHED',
      matched_row_ids: [],
      confidence: 0,
      reasons: ['NO_CANDIDATES_IN_WINDOW'],
    }
  }

  const best = candidates[0]
  if (best.score < SCORE_THRESHOLD) {
    return { ...base, status: 'UNMATCHED', matched_row_ids: [], confidence: best.score, reasons: best.reasons }
  }

  // Candidates that are byte-identical to the best one are the SAME credit
  // ingested twice, not a second credit competing for the match. There is
  // nothing to be ambiguous between, so they must not trigger a tie — they are
  // carried into the pack alongside the winner, where the duplicate check is
  // the thing qualified to rule on them.
  //
  // Without this, a re-ingested settlements file makes every affected record
  // AMBIGUOUS, no bank evidence enters the pack, and the verifier abstains with
  // MISSING_EVIDENCE. The double-credit is then invisible: the matcher has
  // quietly converted an integrity failure into a shrug.
  const bestRow = rows.find((r) => r.row_id === best.row_id)
  const isSameCreditAsBest = (rowId: string): boolean => {
    const r = rows.find((x) => x.row_id === rowId)
    return (
      !!r &&
      !!bestRow &&
      r.utr === bestRow.utr &&
      r.credit_paise === bestRow.credit_paise &&
      r.value_date === bestRow.value_date
    )
  }

  const runnerUp = candidates.slice(1).find((c) => !isSameCreditAsBest(c.row_id))
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) {
    // Two credits the engine cannot tell apart. Reported, never guessed.
    return {
      ...base,
      status: 'AMBIGUOUS',
      matched_row_ids: candidates
        .filter((c) => best.score - c.score < AMBIGUITY_MARGIN && !isSameCreditAsBest(c.row_id))
        .map((c) => c.row_id),
      confidence: best.score,
      reasons: [...best.reasons, 'TIED_WITH_RUNNER_UP'],
    }
  }

  return {
    ...base,
    status: 'MATCHED',
    matched_row_ids: [best.row_id],
    confidence: best.score,
    reasons: best.reasons,
  }
}
