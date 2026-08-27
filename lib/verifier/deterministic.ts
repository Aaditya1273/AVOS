/**
 * THE DETERMINISTIC VERIFIER — the "Verify" and "Guard" pillars.
 *
 * ===========================================================================
 *  ISOLATION CONTRACT. `evals/isolation.ts` fails the build if this is broken.
 * ===========================================================================
 *
 *  1. This module has **zero runtime imports**. Every import below is a
 *     type-only import, erased at compile time. There is no model client, no
 *     network call, no filesystem read, no clock, no randomness. It is a pure
 *     function of its arguments.
 *
 *  2. It **never reads free text**. Not agent narrative — `StructuredClaim` has
 *     no field to carry any — and not the free-text columns of evidence rows,
 *     which the pack builder segregates into a field this file must not name.
 *     A prompt injected into a bank narration is therefore not "filtered"; it is
 *     on a data path that does not reach a verdict.
 *
 *  3. It **recomputes over the whole retrieved pack, not the agent's citation
 *     set**. This is the subtle one. If the verifier scored only the rows the
 *     agent chose to cite, an agent could win VERIFIED by omitting the duplicate
 *     bank credit it did not like. Selection is the agent's job; evaluation is
 *     ours, over everything retrieval found.
 *
 * ---------------------------------------------------------------------------
 * VERDICT SEMANTICS — the distinction the whole product turns on:
 *
 *   VERIFIED   The recomputed financial state supports the claim, under the
 *              policy in force when the decision was taken.
 *   FAILED     The evidence positively refutes the claim, or its integrity is
 *              broken such that closing would move real money incorrectly.
 *   UNCERTAIN  The evidence is incomplete, stale, or unenforceable. AVOS does
 *              not know, and says so. This is why false-closure rate can be
 *              zero: when we cannot prove it, we do not close it.
 *
 * An UNCERTAIN is not a failure of the system. A wrong VERIFIED is.
 * ---------------------------------------------------------------------------
 */

import type {
  CheckResult,
  EvidenceItem,
  EvidencePack,
  Paise,
  PolicySnapshot,
  ReasonCode,
  StructuredClaim,
  VerificationResult,
  Verdict,
} from '@/lib/types'

export const VERIFIER_VERSION = 'deterministic-v2.1'

/**
 * The verifier's entire input surface.
 *
 * Look at what is absent: no `agent_reason`, no `confidence`, no `explanation`,
 * no model handle. The type system, not a code review, is what guarantees the
 * agent cannot talk its way past this function.
 */
export interface VerifierInput {
  claim: StructuredClaim
  pack: EvidencePack
  policy: PolicySnapshot
  /**
   * The instant policy was resolved against. Equal to `pack.decision_time` for a
   * live verdict; a different instant when replaying history.
   */
  as_of: string
}

/**
 * Integer half-up. Must match `apply_bps` in scripts/generate_data.py, exactly.
 *
 * Not `Math.round(paise * rate)`. Python's round() is banker's rounding and
 * JavaScript's Math.round() rounds half away from zero, so `1225 * 2%` is 24 in
 * the generator and 25 here. A one-paisa phantom fee gap on every amount landing
 * on an exact half is precisely the class of defect AVOS exists to catch — and
 * it would be arriving from our own toolchain. Integer arithmetic with an
 * explicit tie-break has no language-dependent behaviour to disagree about.
 */
export function applyBps(paise: Paise, bps: number): Paise {
  return Math.floor((paise * bps + 5000) / 10000)
}

/**
 * What the fee and GST *should* have been, from the rate card in force.
 *
 * Charged per payment, not on the batch total, because that is how the fee is
 * actually levied — and because `sum(round(x_i))` and `round(sum(x_i))` differ
 * by a few paise across a dozen payments. Computing it the wrong way would
 * manufacture a discrepancy on every settlement in the ledger.
 *
 * Deriving from policy rather than from a recorded fee is the point. A verifier
 * that checks the settlement's declared fee against its payment rows' fees sees
 * two numbers that agree — and passes — when a mispricing bug wrote the same
 * wrong value to both. The rate card is the only independent source.
 */
export function calcFees(
  payments: EvidenceItem[],
  policy: PolicySnapshot,
): { fee: Paise; tax: Paise } {
  let fee = 0
  let tax = 0
  for (const p of payments) {
    // The rate stamped on the row wins over the decision-time rate. A fee is
    // levied at capture, so a settlement spanning a repricing is priced per
    // payment; falling back to the decision-time card only when the pack builder
    // could not resolve one.
    // A payment with no resolvable rate card is priced at the decision-time card
    // and flagged by `rate_card_resolved` above, which abstains. Zero is never a
    // safe default for a rate: it silently prices the fee at nothing.
    const feeBps = p.fee_rate_bps ?? policy.fee_rate_bps
    const gstBps = p.gst_rate_bps ?? policy.gst_rate_bps
    const f = applyBps(p.amount_paise, feeBps)
    fee += f
    tax += applyBps(f, gstBps)
  }
  return { fee, tax }
}

/**
 * Findings, in precedence order. The first one present decides the verdict.
 *
 * The ordering is not cosmetic — it is the operational routing table:
 *
 * The organising principle is **how much of the answer the finding invalidates**:
 *
 *  1. Findings that make computation impossible. Tampered, absent, or
 *     out-of-date evidence: nothing downstream means anything, so they come
 *     first. STALE_EVIDENCE sits here because rows too old to trust cannot
 *     support an assertion that the money is definitely wrong either.
 *
 *  2. Policy-INDEPENDENT integrity breaks. A duplicate UTR is wrong under every
 *     tolerance that has ever existed, so it outranks anything that depends on
 *     which tolerance applies. It also names a different owner: reporting
 *     AMOUNT_MISMATCH on a doubled bank credit sends a finance operator hunting a
 *     fee bug that does not exist.
 *
 *  3. Policy-DEPENDENT findings. Real, actionable, but only meaningful once the
 *     evidence set is sound and the epoch is known.
 *
 *  4. STALE_POLICY last, and this is the one worth explaining. It does NOT mean
 *     the wrong tolerance was applied — the verifier always resolves policy from
 *     decision_time, so the arithmetic above is already correct. It means the
 *     ingestion pipeline stamped the wrong version, which is a provenance defect
 *     rather than a financial one. If the money is definitely wrong, say that
 *     first; the stamping bug is the second call to make, not the first.
 */
const PRECEDENCE: ReasonCode[] = [
  // --- cannot compute at all -------------------------------------------------
  'MALFORMED_EVIDENCE',
  'NON_REPRODUCIBLE',
  'MISSING_EVIDENCE',
  'STALE_EVIDENCE',
  // --- policy-INDEPENDENT integrity breaks -----------------------------------
  'DUPLICATE_PAYMENT_ID_CONFLICT',
  'DUPLICATE_EVENT',
  'DUPLICATE_FILE',
  'DUPLICATE_UTR',
  'CONTRADICTORY_SOURCE',
  'OVER_REFUND',
  // --- policy-DEPENDENT findings ---------------------------------------------
  'POLICY_BREACH',
  'TEMPORAL_INCONSISTENCY',
  'FEE_MISMATCH',
  'AMOUNT_MISMATCH',
  // --- provenance defect, money is fine --------------------------------------
  'STALE_POLICY',
]

const VERDICT_FOR: Record<ReasonCode, Verdict> = {
  // Refuted, or integrity broken beyond the possibility of a safe close.
  NON_REPRODUCIBLE: 'FAILED',
  DUPLICATE_EVENT: 'FAILED',
  DUPLICATE_FILE: 'FAILED',
  DUPLICATE_UTR: 'FAILED',
  CONTRADICTORY_SOURCE: 'FAILED',
  POLICY_BREACH: 'FAILED',
  TEMPORAL_INCONSISTENCY: 'FAILED',
  FEE_MISMATCH: 'FAILED',
  AMOUNT_MISMATCH: 'FAILED',
  DUPLICATE_PAYMENT_ID_CONFLICT: 'FAILED',
  OVER_REFUND: 'FAILED',
  // Not disproved — undecidable. Abstain rather than close.
  STALE_POLICY: 'UNCERTAIN',
  MISSING_EVIDENCE: 'UNCERTAIN',
  STALE_EVIDENCE: 'UNCERTAIN',
  MALFORMED_EVIDENCE: 'UNCERTAIN',
}

const DAY_MS = 86_400_000

/**
 * Was this row's fact already true when the decision was taken?
 *
 * A refund processed six hours after a settlement was closed is real, and it is
 * not evidence about that closure — the person who closed it could not have
 * known. Netting it into `expected` grades a historical decision against
 * information from its future, which produces a discrepancy that never existed
 * and is unfixable by whoever gets paged for it.
 *
 * This is the verifier's only notion of "now", and it is supplied rather than
 * read: `decision_time` arrives on the pack. There is no clock in this file.
 */
export function isEvidenceAvailableAtDecisionTime(
  e: EvidenceItem,
  decisionTime: string,
): boolean {
  const at = Date.parse(e.timestamp)
  const cutoff = Date.parse(decisionTime)
  if (!Number.isFinite(at) || !Number.isFinite(cutoff)) return true
  // Day granularity when the source lost its time component, so a same-day
  // date-only stamp is not read as "after".
  if (e.timestamp_precision === 'date') {
    return e.timestamp.slice(0, 10) <= decisionTime.slice(0, 10)
  }
  return at <= cutoff
}

// ---------------------------------------------------------------------------

/**
 * Verify a structured claim against an evidence pack under a policy snapshot.
 *
 * Policy is a parameter rather than something read off the pack, so the caller
 * must state which epoch it is asking about. That makes the replay question
 * — "was this right at the time?" versus "would we take it today?" — impossible
 * to ask by accident.
 */
export function verifyClaim(
  claim: StructuredClaim,
  pack: EvidencePack,
  policy: PolicySnapshot,
  asOf: string = pack.decision_time,
): VerificationResult {
  return verify({ claim, pack, policy, as_of: asOf })
}

export function verify(input: VerifierInput): VerificationResult {
  const { claim, pack, policy, as_of } = input
  const checks: CheckResult[] = []
  const findings = new Set<ReasonCode>()

  const add = (
    id: string,
    pillar: CheckResult['pillar'],
    status: CheckResult['status'],
    detail: string,
    reason?: ReasonCode,
  ): void => {
    checks.push({ id, pillar, status, detail })
    if (status === 'fail' && reason) findings.add(reason)
  }

  // -------------------------------------------------------------------------
  // 0. GUARD — the claim must bind to this pack.
  // -------------------------------------------------------------------------
  const bound = claim.settlement_id === pack.settlement_id
  add(
    'claim_binds_to_pack',
    'guard',
    bound ? 'pass' : 'fail',
    bound
      ? `claim references ${claim.settlement_id}, which is the subject of this pack`
      : `claim references ${claim.settlement_id} but the pack is for ${pack.settlement_id}`,
    'MISSING_EVIDENCE',
  )

  // -------------------------------------------------------------------------
  // 0b. PROVE — preconditions.
  //
  // The verifier does not parse money or dates; `lib/csv.ts` does that at the
  // ingest boundary and throws on anything malformed. But a verifier that
  // silently computes over a NaN is worse than one that crashes, so it checks
  // its own preconditions and abstains rather than trusting a caller.
  //
  // Note it abstains rather than failing. Malformed input means we do not know
  // the financial state — not that the claim is false.
  // -------------------------------------------------------------------------
  const malformed = pack.evidence.filter(
    (e) =>
      !Number.isSafeInteger(e.amount_paise) ||
      (e.fee_paise !== undefined && !Number.isSafeInteger(e.fee_paise)) ||
      (e.tax_paise !== undefined && !Number.isSafeInteger(e.tax_paise)) ||
      !Number.isFinite(Date.parse(e.timestamp)),
  )
  add(
    'evidence_well_formed',
    'prove',
    malformed.length === 0 ? 'pass' : 'fail',
    malformed.length === 0
      ? `all ${pack.evidence.length} rows carry integer paise and a parseable timestamp`
      : `${malformed.length} row(s) reached the verifier malformed: ${malformed
          .map((e) => e.evidence_id)
          .join(', ')}`,
    'MALFORMED_EVIDENCE',
  )

  // -------------------------------------------------------------------------
  // 1. PROVE — every cited row must still hash to what it hashed at decision time.
  // -------------------------------------------------------------------------
  const mutated = pack.evidence.filter((e) => !e.hash_matches_recorded)
  add(
    'evidence_reproducible',
    'prove',
    mutated.length === 0 ? 'pass' : 'fail',
    mutated.length === 0
      ? `all ${pack.evidence.length} rows hash to their recorded values (pack ${pack.pack_hash.slice(0, 12)})`
      : `${mutated.length} row(s) no longer hash to their recorded values: ${mutated
          .map((e) => e.evidence_id)
          .join(', ')}`,
    'NON_REPRODUCIBLE',
  )

  // -------------------------------------------------------------------------
  // 2. GUARD — a policy must have been in force, and it must be the right epoch.
  // -------------------------------------------------------------------------
  const hasPolicy = policy.version !== 'none-in-force' && policy.effective_at !== ''
  add(
    'policy_in_force',
    'guard',
    hasPolicy ? 'pass' : 'fail',
    hasPolicy
      ? `${policy.version} in force as of ${as_of} (effective ${policy.effective_at})`
      : `no finance policy was in force at ${as_of}; closure is unenforceable`,
    'STALE_POLICY',
  )

  // The stamped version is compared against the epoch of the DECISION, never of
  // the replay. Judging an Aug-10 decision by Aug-12 rules is the exact mistake
  // this catches — and it is a mistake that reads as a clean pass everywhere else.
  const epochOk = pack.recorded_policy_version === pack.decision_policy_version
  add(
    'policy_epoch_matches_decision',
    'guard',
    epochOk ? 'pass' : 'fail',
    epochOk
      ? `pack stamped ${pack.recorded_policy_version}, which is the version in force at decision_time ${pack.decision_time}`
      : `pack stamped ${pack.recorded_policy_version} but ${pack.decision_policy_version} was in force at decision_time ${pack.decision_time}; historical decisions are evaluated under the policy that existed when the decision occurred`,
    'STALE_POLICY',
  )

  // -------------------------------------------------------------------------
  // 3. PROVE — completeness. Partition once; every later check reads these.
  // -------------------------------------------------------------------------
  // --- H21: nothing dated after the decision may inform it -----------------
  const fromTheFutureByEvent = pack.evidence.filter(
    (e) => !isEvidenceAvailableAtDecisionTime(e, pack.decision_time),
  )
  const available = pack.evidence.filter((e) =>
    isEvidenceAvailableAtDecisionTime(e, pack.decision_time),
  )
  add(
    'evidence_available_at_decision_time',
    'prove',
    fromTheFutureByEvent.length === 0 ? 'pass' : 'fail',
    fromTheFutureByEvent.length === 0
      ? `all ${pack.evidence.length} rows were already facts at ${pack.decision_time}`
      : `${fromTheFutureByEvent.length} row(s) dated after decision_time are excluded from the ` +
        `recomputation — the decision could not have known them: ${fromTheFutureByEvent
          .map((e) => `${e.evidence_id} @ ${e.timestamp}`)
          .join(', ')}`,
  )

  const settlementsForClaim = available.filter(
    (e) => e.kind === 'settlement' && e.keys.settlement_id === claim.settlement_id,
  )
  const allSettlementRows = available.filter((e) => e.kind === 'settlement')

  // --- H22: a payment captured after the settlement was cut is not in it ----
  const settlementCut = settlementsForClaim[0]?.created_at ?? ''
  const cutMs = Date.parse(settlementCut)
  const allPayments = available.filter((e) => e.kind === 'payment')
  const afterCut = Number.isFinite(cutMs)
    ? allPayments.filter((e) => {
        const captured = Date.parse(e.timestamp)
        return Number.isFinite(captured) && captured > cutMs
      })
    : []
  add(
    'payments_predate_settlement_cut',
    'prove',
    afterCut.length === 0 ? 'pass' : 'fail',
    afterCut.length === 0
      ? `all ${allPayments.length} payment(s) were captured before the settlement was cut`
      : `${afterCut.length} payment(s) captured after the settlement was cut at ${settlementCut} ` +
        `are excluded from gross — they belong to a later settlement: ${afterCut
          .map((e) => e.evidence_id)
          .join(', ')}`,
  )
  const inCutPayments = allPayments.filter((e) => !afterCut.includes(e))

  // --- H23: the same payment restated at a different amount -----------------
  const byPaymentId = new Map<string, EvidenceItem[]>()
  for (const e of inCutPayments) {
    const id = e.keys.payment_id ?? e.row_id
    const list = byPaymentId.get(id)
    if (list) list.push(e)
    else byPaymentId.set(id, [e])
  }
  const conflicts = [...byPaymentId.entries()].filter(
    ([, rows]) => new Set(rows.map((r) => r.amount_paise)).size > 1,
  )
  add(
    'payment_ids_unique',
    'verify',
    inCutPayments.length === 0 ? 'skipped' : conflicts.length === 0 ? 'pass' : 'fail',
    inCutPayments.length === 0
      ? 'no payment evidence to check'
      : conflicts.length === 0
        ? `${byPaymentId.size} distinct payment_id(s), no restatements`
        : conflicts
            .map(
              ([id, rows]) =>
                `payment ${id} appears ${rows.length} times at different amounts (` +
                `${rows.map((r) => `${r.amount_paise}p`).join(', ')}) with no supersession marker`,
            )
            .join('; '),
    'DUPLICATE_PAYMENT_ID_CONFLICT',
  )
  // Deduplicate by payment_id, first row wins, so a conflict never double-counts
  // gross on top of being reported.
  const payments = [...byPaymentId.values()].map((rows) => rows[0])

  const bankCredits = available.filter((e) => e.kind === 'bank_credit')
  const refunds = available.filter((e) => e.kind === 'refund')
  const holds = available.filter((e) => e.kind === 'hold')
  const webhooks = available.filter((e) => e.kind === 'webhook_event')

  // --- H27: a refund cannot exceed the payment it refunds -------------------
  const refundedByPayment = new Map<string, number>()
  for (const r of refunds) {
    const pid = r.keys.payment_id
    if (!pid) continue
    refundedByPayment.set(pid, (refundedByPayment.get(pid) ?? 0) + r.amount_paise)
  }
  const overRefunds: string[] = []
  for (const [pid, refunded] of refundedByPayment) {
    const parent = payments.find((p) => p.keys.payment_id === pid)
    if (parent && refunded > parent.amount_paise) {
      overRefunds.push(`${pid}: refunded ${refunded}p against a ${parent.amount_paise}p payment`)
    }
  }
  add(
    'refunds_within_their_payments',
    'verify',
    refunds.length === 0 ? 'skipped' : overRefunds.length === 0 ? 'pass' : 'fail',
    refunds.length === 0
      ? 'no refunds attached to this settlement'
      : overRefunds.length === 0
        ? `${refunds.length} refund(s), each within the payment it refunds`
        : `refund exceeds its parent payment — impossible, not merely unbalanced: ${overRefunds.join('; ')}`,
    'OVER_REFUND',
  )

  const missing: string[] = []
  if (settlementsForClaim.length === 0) missing.push('settlement')
  if (payments.length === 0) missing.push('payments')
  if (bankCredits.length === 0) missing.push('bank_credit')

  add(
    'evidence_complete',
    'prove',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0
      ? `${payments.length} payment(s), ${refunds.length} refund(s), ${holds.length} hold(s), ${bankCredits.length} bank credit(s), ${webhooks.length} webhook event(s)`
      : `cannot recompute: no ${missing.join(' and no ')} evidence retrieved`,
    'MISSING_EVIDENCE',
  )

  // REPORTED, NEVER FATAL — and the distinction is load-bearing.
  //
  // An earlier version let a bad citation set contribute MISSING_EVIDENCE, which
  // meant an agent could force UNCERTAIN by citing an id that does not exist.
  // That hands the agent a lever over the verdict, which is precisely what this
  // architecture exists to deny it. The verifier already scores the whole
  // retrieved pack, so a hallucinated or omitted citation tells us something
  // about the agent and nothing about the settlement. It is surfaced on the
  // Proof Card and scored by the eval; it does not move the outcome.
  const packIds = new Set(pack.evidence.map((e) => e.evidence_id))
  const uncited = pack.evidence.filter((e) => !claim.evidence_ids.includes(e.evidence_id))
  const phantom = claim.evidence_ids.filter((id) => !packIds.has(id))
  add(
    'agent_citation_coverage',
    'guard',
    phantom.length === 0 ? 'pass' : 'fail',
    phantom.length > 0
      ? `agent cited ${phantom.length} evidence id(s) that retrieval never returned: ${phantom.join(', ')}`
      : `agent cited ${claim.evidence_ids.length}/${pack.evidence.length} retrieved rows` +
        (uncited.length > 0
          ? `; ${uncited.length} retrieved row(s) went uncited and were scored anyway`
          : ''),
    // No reason code, deliberately. See the note above: a citation defect is a
    // fact about the agent, not about the settlement, and must not move a verdict.
  )

  // -------------------------------------------------------------------------
  // 4. GUARD — freshness, measured from ingest to decision.
  // -------------------------------------------------------------------------
  const maxAge = policy.evidence_freshness_max_hours
  const stale = pack.evidence.filter(
    (e) => Number.isFinite(e.freshness_hours) && e.freshness_hours > maxAge,
  )
  // Negative freshness means the row landed after the decision was taken, so the
  // decision could not possibly have been based on it. That is a timeline defect,
  // not an ageing one, and it routes to a different owner.
  const fromTheFuture = pack.evidence.filter(
    (e) => Number.isFinite(e.freshness_hours) && e.freshness_hours < 0,
  )

  if (hasPolicy) {
    add(
      'evidence_fresh',
      'guard',
      stale.length === 0 ? 'pass' : 'fail',
      stale.length === 0
        ? `oldest row ${maxAgeOf(pack.evidence)}h old at decision time, limit ${maxAge}h`
        : `${stale.length} row(s) older than the ${maxAge}h limit: ${stale
            .map((e) => `${e.evidence_id} (${e.freshness_hours}h)`)
            .join(', ')}`,
      'STALE_EVIDENCE',
    )
  } else {
    add('evidence_fresh', 'guard', 'skipped', 'no policy in force; no freshness limit to apply')
  }

  add(
    'evidence_predates_decision',
    'prove',
    fromTheFuture.length === 0 ? 'pass' : 'fail',
    fromTheFuture.length === 0
      ? 'every row was ingested before the decision was taken'
      : `${fromTheFuture.length} row(s) were ingested after decision_time and cannot have informed it: ${fromTheFuture
          .map((e) => e.evidence_id)
          .join(', ')}`,
    'TEMPORAL_INCONSISTENCY',
  )

  // -------------------------------------------------------------------------
  // 5. VERIFY — webhook idempotency. Same event_id twice means a redelivery was
  //    processed twice, which credits the merchant twice.
  // -------------------------------------------------------------------------
  const eventCounts = countBy(webhooks, (e) => e.keys.event_id ?? '')
  const replayedEvents = [...eventCounts.entries()].filter(([id, n]) => id !== '' && n > 1)
  add(
    'webhook_idempotent',
    'verify',
    webhooks.length === 0 ? 'skipped' : replayedEvents.length === 0 ? 'pass' : 'fail',
    webhooks.length === 0
      ? 'no webhook evidence in pack'
      : replayedEvents.length === 0
        ? `${webhooks.length} event(s), all event_ids distinct`
        : `webhook redelivery processed more than once: ${replayedEvents
            .map(([id, n]) => `${id} x${n}`)
            .join(', ')}`,
    'DUPLICATE_EVENT',
  )

  // -------------------------------------------------------------------------
  // 6. VERIFY — file re-ingestion. Identical content under two row locators.
  //    Webhooks are excluded: they are covered above by event_id, and a single
  //    reason code for two different operational fixes helps nobody.
  // -------------------------------------------------------------------------
  const dupeGroups: string[] = []
  for (const [source, items] of groupBy(
    pack.evidence.filter((e) => e.source !== 'webhook_events'),
    (e) => e.source,
  )) {
    for (const [hash, rows] of groupBy(items, (e) => e.hash)) {
      if (rows.length > 1) {
        dupeGroups.push(
          `${source} rows [${rows.map((r) => r.row_id).join(', ')}] share content hash ${hash.slice(0, 12)}`,
        )
      }
    }
  }
  add(
    'no_duplicate_ingestion',
    'verify',
    dupeGroups.length === 0 ? 'pass' : 'fail',
    dupeGroups.length === 0
      ? 'no two rows in any source share a content hash'
      : `the same source content was ingested more than once: ${dupeGroups.join('; ')}`,
    'DUPLICATE_FILE',
  )

  // -------------------------------------------------------------------------
  // 7. VERIFY — UTR uniqueness across settlements. A bank reference claimed by
  //    two settlements means one of them is about to be reconciled against
  //    money that belongs to the other.
  // -------------------------------------------------------------------------
  const utrOwners = new Map<string, Set<string>>()
  for (const s of allSettlementRows) {
    const utr = s.keys.utr
    const sid = s.keys.settlement_id
    if (!utr || !sid) continue
    const set = utrOwners.get(utr) ?? new Set<string>()
    set.add(sid)
    utrOwners.set(utr, set)
  }
  const contestedUtrs = [...utrOwners.entries()].filter(([, owners]) => owners.size > 1)
  add(
    'utr_unique',
    'verify',
    allSettlementRows.length === 0
      ? 'skipped'
      : contestedUtrs.length === 0
        ? 'pass'
        : 'fail',
    allSettlementRows.length === 0
      ? 'no settlement evidence to check'
      : contestedUtrs.length === 0
        ? `UTR ${[...utrOwners.keys()].join(', ')} is claimed by exactly one settlement`
        : contestedUtrs
            .map(([utr, owners]) => `UTR ${utr} is claimed by ${[...owners].sort().join(' and ')}`)
            .join('; '),
    'DUPLICATE_UTR',
  )

  // -------------------------------------------------------------------------
  // 8. VERIFY — source agreement. Two rows for the same settlement with
  //    different content and no supersession marker: there is no fact of the
  //    matter, so there is nothing to close.
  // -------------------------------------------------------------------------
  const distinctVersions = new Set(settlementsForClaim.map((e) => e.hash))
  add(
    'sources_agree',
    'verify',
    settlementsForClaim.length === 0
      ? 'skipped'
      : distinctVersions.size <= 1
        ? 'pass'
        : 'fail',
    settlementsForClaim.length === 0
      ? 'no settlement evidence to compare'
      : distinctVersions.size <= 1
        ? `${settlementsForClaim.length} settlement row(s) for ${claim.settlement_id}, all in agreement`
        : `${distinctVersions.size} irreconcilable versions of ${claim.settlement_id}: ` +
          settlementsForClaim
            .map((e) => `${e.row_id} net=${e.amount_paise}p`)
            .join(', ') +
          '; no supersession marker distinguishes them',
    'CONTRADICTORY_SOURCE',
  )

  // The authoritative row, once we know there is exactly one version of it.
  const settlement: EvidenceItem | null =
    distinctVersions.size === 1 ? settlementsForClaim[0] : null

  // -------------------------------------------------------------------------
  // 9. GUARD — permissibility. Is this settlement in a state the policy allows
  //    to be closed at all?
  // -------------------------------------------------------------------------
  if (settlement && hasPolicy) {
    const status = settlement.status ?? ''
    const allowed = policy.closeable_statuses.includes(status)
    add(
      'closure_permitted_by_policy',
      'guard',
      allowed ? 'pass' : 'fail',
      allowed
        ? `status '${status}' is closeable under ${policy.version}`
        : `status '${status}' is not closeable under ${policy.version} (allowed: ${policy.closeable_statuses.join(', ') || 'none'})`,
      'POLICY_BREACH',
    )
  } else {
    add(
      'closure_permitted_by_policy',
      'guard',
      'skipped',
      'no single authoritative settlement row, or no policy in force',
    )
  }

  // -------------------------------------------------------------------------
  // 10. VERIFY — temporal consistency of the settlement lifecycle.
  // -------------------------------------------------------------------------
  if (settlement && hasPolicy) {
    const created = Date.parse(settlement.created_at ?? '')
    const settled = Date.parse(settlement.timestamp)
    const problems: string[] = []

    if (Number.isFinite(created) && Number.isFinite(settled)) {
      if (settled < created) {
        problems.push(`settled_at ${settlement.timestamp} precedes creation`)
      } else {
        // Whole days. "T+3" is a calendar promise, not a 72.0-hour SLA, so a
        // settlement that lands 3 days and 4 hours later has not breached T+3.
        const lagDays = Math.floor((settled - created) / DAY_MS)
        if (lagDays > policy.max_settlement_lag_days) {
          problems.push(
            `settlement lag T+${lagDays} exceeds the T+${policy.max_settlement_lag_days} limit in ${policy.version}`,
          )
        }
      }
    }

    for (const b of bankCredits) {
      const valued = Date.parse(b.timestamp)
      if (!Number.isFinite(valued) || !Number.isFinite(settled)) continue
      // A date-only value date carries no time of day, so comparing it against a
      // to-the-second settled_at compares a fact against a guess. Drop to
      // calendar days when either side lost precision — otherwise every bank
      // that exports `08/20/2026` looks like it paid before it was asked to.
      const dayGranularity =
        b.timestamp_precision === 'date' || settlement.timestamp_precision === 'date'
      const isBefore = dayGranularity
        ? b.timestamp.slice(0, 10) < settlement.timestamp.slice(0, 10)
        : valued < settled
      if (isBefore) {
        problems.push(`bank credit ${b.row_id} is value-dated before the settlement was made`)
      }
    }

    add(
      'temporal_consistency',
      'verify',
      problems.length === 0 ? 'pass' : 'fail',
      problems.length === 0
        ? `lifecycle ordered: created -> settled ${settlement.timestamp} -> credited, within T+${policy.max_settlement_lag_days}`
        : problems.join('; '),
      'TEMPORAL_INCONSISTENCY',
    )
  } else {
    add('temporal_consistency', 'verify', 'skipped', 'no authoritative settlement row to order')
  }

  // -------------------------------------------------------------------------
  // 11. VERIFY — the arithmetic. Integer paise throughout.
  //
  //     expected = gross - refunds - fees - tax - holds     (payment-level truth)
  //     observed = bank credit                              (what actually landed)
  //     difference = expected - observed
  //
  //     The fee term comes from the PAYMENTS, not from the settlement's own
  //     declared total. Using the settlement's number would be asking the thing
  //     under audit to supply the answer.
  // -------------------------------------------------------------------------
  let expected: Paise | null = null
  let observed: Paise | null = null
  let difference: Paise | null = null
  let feeDelta: Paise | null = null
  let recordedFeeDelta: Paise | null = null
  let policyFee: Paise | null = null

  const canCompute = payments.length > 0 && bankCredits.length > 0
  if (canCompute && hasPolicy) {
    const gross = sum(payments, (e) => e.amount_paise)
    const refundTotal = sum(refunds, (e) => e.amount_paise)
    const holdTotal = sum(holds, (e) => e.amount_paise)

    // The fee comes from the RATE CARD, not from any recorded fee. Neither the
    // settlement's declared total nor the payment rows' own fee columns are
    // trusted here — both are the thing under audit, and a mispricing bug that
    // wrote the same wrong value to both would sail through a check that only
    // compared them to each other.
    const { fee: policyFees, tax: policyTax } = calcFees(payments, policy)
    policyFee = policyFees

    expected = gross - refundTotal - policyFees - policyTax - holdTotal
    observed = sum(bankCredits, (e) => e.amount_paise)
    difference = expected - observed

    // Two independent fee comparisons, because they route to different owners.
    const paymentFees = sum(payments, (e) => e.fee_paise ?? 0)
    recordedFeeDelta = paymentFees - policyFees
    if (settlement) feeDelta = (settlement.fee_paise ?? 0) - policyFees
  }

  if (canCompute && hasPolicy && expected !== null && observed !== null && difference !== null) {
    const tolerance = policy.fee_tolerance_paise
    const within = Math.abs(difference) <= tolerance

    // A discrepancy the fee line accounts for exactly is a pricing problem.
    // Anything else is a settlements-ops problem. Same verdict, same amount,
    // different owner — collapsing them would misdirect every exception.
    const explainedByFees = feeDelta !== null && difference - feeDelta === 0 && feeDelta !== 0
    const reason: ReasonCode = explainedByFees ? 'FEE_MISMATCH' : 'AMOUNT_MISMATCH'

    const { fee: pf, tax: pt } = calcFees(payments, policy)
    add(
      'arithmetic_reconciles',
      'verify',
      within ? 'pass' : 'fail',
      `expected ${expected}p = gross ${sum(payments, (e) => e.amount_paise)}p ` +
        `- refunds ${sum(refunds, (e) => e.amount_paise)}p ` +
        `- fees ${pf}p - tax ${pt}p ` +
        `(recomputed from ${policy.version} rate card at ${policy.fee_rate_bps}bps + ${policy.gst_rate_bps}bps GST) ` +
        `- holds ${sum(holds, (e) => e.amount_paise)}p; ` +
        `observed ${observed}p; difference ${difference}p; ` +
        `tolerance ${tolerance}p` +
        (within
          ? ''
          : explainedByFees
            ? `; the settlement declared ${feeDelta}p more in fees than the rate card allows`
            : `; the difference is not accounted for by the fee line`),
      reason,
    )

    // The check the rate card makes possible: the payment rows' own fee columns
    // disagreeing with policy. Reported separately, and it does not gate the
    // verdict on its own — a settlement whose bank credit reconciles exactly is
    // still correct money, even if a recorded fee column drifted.
    const recDelta = recordedFeeDelta ?? 0
    add(
      'recorded_fees_match_rate_card',
      'verify',
      recDelta === 0 ? 'pass' : 'fail',
      recDelta === 0
        ? `payment-level fee columns agree with the ${policy.version} rate card to the paisa`
        : `payment rows record ${recDelta}p ${recDelta > 0 ? 'more' : 'less'} in fees than the rate card derives; the recorded fee is not evidence of the correct fee`,
      'FEE_MISMATCH',
    )
  } else {
    add(
      'arithmetic_reconciles',
      'verify',
      'skipped',
      !canCompute
        ? 'cannot recompute without both payment-level and bank evidence'
        : 'no policy in force, so no tolerance to compare against',
    )
  }

  // -------------------------------------------------------------------------
  // Verdict: the highest-precedence finding, or VERIFIED.
  // -------------------------------------------------------------------------
  const reason_code = PRECEDENCE.find((r) => findings.has(r)) ?? null
  const verdict: Verdict = reason_code ? VERDICT_FOR[reason_code] : 'VERIFIED'

  return {
    settlement_id: claim.settlement_id,
    verdict,
    reason_code,
    expected_paise: expected,
    observed_paise: observed,
    difference_paise: difference,
    policy_fee_paise: policyFee,
    fee_delta_paise: feeDelta,
    recorded_fee_delta_paise: recordedFeeDelta,
    tolerance_paise: hasPolicy ? policy.fee_tolerance_paise : null,
    policy_version: policy.version,
    policy_effective_at: policy.effective_at,
    verifier_version: VERIFIER_VERSION,
    checks,
    evidence_ids_used: pack.evidence.map((e) => e.evidence_id),
    evaluated_as_of: as_of,
  }
}

// ---------------------------------------------------------------------------
// Local helpers. Kept in-file on purpose: importing them would break the
// zero-runtime-import property that `evals/isolation.ts` asserts.
// ---------------------------------------------------------------------------

function sum<T>(items: T[], pick: (t: T) => number): number {
  let total = 0
  for (const item of items) total += pick(item)
  return total
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

function maxAgeOf(evidence: EvidenceItem[]): number {
  let max = 0
  for (const e of evidence) {
    if (Number.isFinite(e.freshness_hours) && e.freshness_hours > max) max = e.freshness_hours
  }
  return Math.round(max * 100) / 100
}
