/**
 * The single contract every layer binds to.
 *
 * This file is AVOS's chart of accounts: agent, evidence builder, verifier,
 * replay engine, eval harness and UI all speak these types and nothing else.
 * The reference project's `schema.py` earned its keep by being the one place a
 * category could be defined; this is the same idea applied to a verification
 * pipeline, with one addition that matters more than all the rest:
 *
 *   **The verifier's input type has no field that can carry agent prose.**
 *
 * `StructuredClaim` is {settlement_id, proposed_status, evidence_ids}. There is
 * no `reason`, no `explanation`, no `confidence`. The agent's narrative lives on
 * `AgentProposal`, which the verifier never receives. An LLM cannot argue its
 * way to VERIFIED because there is no channel through which an argument could
 * travel. That is an architectural guarantee, not a prompt instruction.
 */

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Integer paise. Never a float, anywhere, ever.
 *
 * Floating-point money in a verifier is uniquely dangerous: a 0.01 rounding
 * artefact is indistinguishable from a real 0.01 discrepancy, so the system
 * either raises false exceptions or learns to ignore small ones. Both are fatal
 * for the product. All arithmetic is exact integer arithmetic in paise, and
 * rupees exist only at the render boundary.
 */
export type Paise = number

// ---------------------------------------------------------------------------
// The structured claim — the ONLY thing an agent is permitted to emit
// ---------------------------------------------------------------------------

export type ProposedStatus = 'RECONCILED' | 'NOT_RECONCILED' | 'NEEDS_REVIEW'

export interface StructuredClaim {
  settlement_id: string
  proposed_status: ProposedStatus
  /** Locators only. The agent selects evidence; it never supplies evidence. */
  evidence_ids: string[]
}

/**
 * What an agent actually produces. `claim` crosses into the verifier;
 * everything else on this object is display-only and is quarantined at the
 * boundary by `lib/evidence/pack.ts`.
 */
export interface AgentProposal {
  claim: StructuredClaim
  /**
   * QUARANTINED. Rendered in the UI so a reviewer can see what the agent said,
   * struck through, next to what AVOS computed. Never an input to a verdict.
   */
  agent_reason: string
  /**
   * QUARANTINED, and the more interesting of the two.
   *
   * The agent emits a self-reported 0–1 confidence alongside its claim. It is
   * severed at the same boundary as the prose, for the reason the product is
   * named after: closure is conditional on evidence, not on confidence. A score
   * the claimant assigns to its own claim is not evidence about the claim.
   *
   * Keeping it — rather than dropping it — makes it measurable. `lib/metrics.ts`
   * reports mean confidence on the closures AVOS accepted versus the ones it
   * refused. If those two numbers are the same, the score carries no signal, and
   * any system that routed on it was routing on noise.
   */
  confidence: number
  agent_version: string
  model_version: string
  used_mock: boolean
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceSource =
  | 'razorpay_payments'
  | 'razorpay_settlements'
  | 'bank_statement'
  | 'refunds'
  | 'holds'
  | 'webhook_events'

export type EvidenceKind =
  | 'payment'
  | 'settlement'
  | 'bank_credit'
  | 'refund'
  | 'hold'
  | 'webhook_event'

export interface EvidenceKeys {
  settlement_id?: string
  utr?: string
  payment_id?: string
  event_id?: string
}

export interface EvidenceItem {
  evidence_id: string
  source: EvidenceSource
  kind: EvidenceKind
  /** Locator in the source file, so a human can open the row and look at it. */
  row_id: string
  /** When the underlying financial fact occurred. */
  timestamp: string
  /** When this row entered our system. Freshness is measured from here. */
  ingested_at: string
  /** decision_time - ingested_at, in hours. Negative means ingested after the decision. */
  freshness_hours: number
  amount_paise: Paise
  /** sha256 over canonical content, excluding row_id. Re-ingestion of an
   *  identical row therefore collides — which is how duplicate files are caught. */
  hash: string
  /** False when the live row no longer hashes to what the decision log recorded. */
  hash_matches_recorded: boolean
  keys: EvidenceKeys
  fee_paise?: Paise
  tax_paise?: Paise
  status?: string
  /** Settlement lifecycle start. Typed, because the verifier needs to order it. */
  created_at?: string
  /**
   * Free text from the source row: bank narration, hold reason, event type.
   *
   * THE VERIFIER MUST NEVER READ THIS FIELD, and `evals/isolation.ts` fails the
   * build if `lib/verifier/deterministic.ts` names it in executable code.
   *
   * The rule for what belongs here is not "things the UI shows" — it is
   * "unstructured text we did not generate". Anything the verifier legitimately
   * needs gets a typed field of its own (see `created_at` above), so that this
   * bucket stays exactly what it claims to be: the attacker-controlled surface,
   * quarantined off the verdict path. Prompt injection is not filtered here.
   * It is simply not connected to anything that decides.
   */
  display: Record<string, string>
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface PolicySnapshot {
  version: string
  effective_at: string
  fee_tolerance_paise: Paise
  /**
   * The rate card, in basis points.
   *
   * The verifier recomputes what the fee *should* have been from these, rather
   * than trusting the fee recorded on the settlement or on its payment rows.
   * That matters: if a mispricing bug wrote the same wrong fee to both, a
   * verifier that compares them against each other sees perfect agreement and
   * passes. Deriving from the rate card is the only way to catch it.
   */
  fee_rate_bps: number
  gst_rate_bps: number
  max_settlement_lag_days: number
  evidence_freshness_max_hours: number
  closeable_statuses: string[]
}

// ---------------------------------------------------------------------------
// Evidence Pack — the "Prove" pillar
// ---------------------------------------------------------------------------

export interface EvidencePack {
  decision_id: string
  settlement_id: string
  merchant_id: string
  /** When the money moved. */
  event_time: string
  /** When the closure decision was taken. Policy is resolved against THIS. */
  decision_time: string
  evidence: EvidenceItem[]
  /**
   * The policy the verdict is evaluated under. Normally the one in force at
   * `decision_time`; during replay, the one in force at the replay instant.
   */
  policy_snapshot: PolicySnapshot
  /**
   * The policy version actually in force at `decision_time`, always — replay
   * does not move it. Guard compares `recorded_policy_version` against this,
   * so a replay under a different epoch does not masquerade as a stale stamp.
   */
  decision_policy_version: string
  /** The policy version the ingestion pipeline stamped on this pack. If it
   *  disagrees with `decision_policy_version`, the decision was judged under the
   *  wrong epoch and Guard abstains. */
  recorded_policy_version: string
  agent_version: string
  model_version: string
  evidence_hashes: string[]
  /** sha256 over the ordered evidence hashes. One value identifies the whole pack. */
  pack_hash: string
  /** True when every row still hashes to what it hashed at decision time. */
  reproducible: boolean
}

// ---------------------------------------------------------------------------
// Verdict — the "Verify" pillar
// ---------------------------------------------------------------------------

export type Verdict = 'VERIFIED' | 'UNCERTAIN' | 'FAILED'

/**
 * Reason codes.
 *
 * The five the brief names are canonical; the rest exist because a reason code
 * that lumps two different failures together is worse than no reason code —
 * an operator cannot route it to the right owner.
 */
export type ReasonCode =
  // --- canonical ---
  | 'FEE_MISMATCH'
  | 'DUPLICATE_UTR'
  | 'MISSING_EVIDENCE'
  | 'STALE_POLICY'
  | 'CONTRADICTORY_SOURCE'
  // --- additional, each mapped to a distinct operational owner ---
  | 'AMOUNT_MISMATCH'
  | 'DUPLICATE_FILE'
  | 'DUPLICATE_EVENT'
  | 'TEMPORAL_INCONSISTENCY'
  | 'STALE_EVIDENCE'
  | 'NON_REPRODUCIBLE'
  | 'POLICY_BREACH'
  /** An amount or timestamp reached the verifier malformed. Never a verdict input. */
  | 'MALFORMED_EVIDENCE'

export type Pillar = 'guard' | 'prove' | 'verify'

export type CheckStatus = 'pass' | 'fail' | 'skipped'

export interface CheckResult {
  id: string
  pillar: Pillar
  /**
   * `skipped` is a first-class outcome, not a pass.
   *
   * If the bank leg is missing, the arithmetic check did not succeed — it never
   * ran. Recording that as a pass would let an incomplete pack accumulate green
   * ticks and look verified. Every Proof Card shows the full check ledger, so
   * the distinction is visible to whoever signs off.
   */
  status: CheckStatus
  /** Written BY the verifier. Never read by it. */
  detail: string
}

export interface VerificationResult {
  settlement_id: string
  verdict: Verdict
  reason_code: ReasonCode | null
  /** Recomputed from payment-level evidence: gross - refunds - fees - tax - holds. */
  expected_paise: Paise | null
  /** What the bank actually credited. */
  observed_paise: Paise | null
  /** expected - observed. Positive means the bank paid less than the ledger says. */
  difference_paise: Paise | null
  /** What the rate card in force says the fee should have been. */
  policy_fee_paise: Paise | null
  /** settlement-declared fee − policy-derived fee. The settlement over/undercharged. */
  fee_delta_paise: Paise | null
  /** sum(payment-level fees) − policy-derived fee. The payment rows themselves are off. */
  recorded_fee_delta_paise: Paise | null
  tolerance_paise: Paise | null
  policy_version: string
  policy_effective_at: string
  verifier_version: string
  checks: CheckResult[]
  evidence_ids_used: string[]
  /** The instant the policy was resolved against. Equals decision_time unless replaying. */
  evaluated_as_of: string
}

// ---------------------------------------------------------------------------
// Cases, decisions, replay
// ---------------------------------------------------------------------------

/**
 * A row of `settlement_batch_120.csv` — everything the agent is allowed to see.
 *
 * A denormalised summary, in the messy shape a finance team actually receives:
 * formatted money, mixed date conventions, semicolon-packed id lists. All of it
 * is normalised to exact paise and ISO-8601 by `lib/data/ledger.ts` at load.
 *
 * These summary figures are **not evidence**. The verifier ignores every one of
 * them and recomputes from the normalised source files, which is why a case can
 * present a perfectly tidy summary row and still fail. A summary that agrees
 * with itself proves nothing — that is the entire premise of the product.
 */
export interface SettlementCase {
  case_id: string
  settlement_id: string
  merchant_id: string
  /** Semicolon-packed in the CSV; split at load. Empty when the payment leg is absent. */
  razorpay_payment_ids: string[]
  /** The settlement's own declared net. Summary only — never trusted. */
  settlement_amount_paise: Paise
  /** What the export says landed. Null when the bank leg is missing entirely. */
  bank_credit_paise: Paise | null
  fee_paise: Paise
  refund_paise: Paise
  utr: string
  event_time: string
  decision_time: string
  /** The policy version stamped on this case by ingestion. Checked, not believed. */
  recorded_policy_version: string
  agent_claim: ProposedStatus
  /** Free-text memo carried on the adversarial index. Display and Q&A only. */
  memo: string
  /** Derived from `settlement_amount_paise`; the denominator of value coverage. */
  batch_value_paise: Paise
}

/** An entry in `ground_truth.json` — eval harness only. Never reaches the agent. */
export interface GroundTruth {
  case_id: string
  settlement_id: string
  scenario: string
  expected_verdict: Verdict
  expected_reason: string
}

/** One fully-assembled decision: claim, evidence, verdict. What a Proof Card renders. */
export interface Decision {
  case_id: string
  suite: 'batch_120' | 'adversarial_30'
  proposal: AgentProposal
  pack: EvidencePack
  result: VerificationResult
  batch_value_paise: Paise
}

export interface ReplayResult {
  case_id: string
  settlement_id: string
  /** The verdict as originally recorded, under the policy active at decision_time. */
  original: VerificationResult
  /** The verdict when re-evaluated as-of `as_of`. */
  replayed: VerificationResult
  as_of: string
  verdict_changed: boolean
  policy_changed: boolean
  /** False when live evidence no longer hashes to the recorded values. */
  reproducible: boolean
  changed_evidence_ids: string[]
  narrative: string
}
