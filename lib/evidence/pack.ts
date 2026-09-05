/**
 * Evidence Pack Builder — the "Prove" pillar.
 *
 * Given a settlement and the instant a decision was taken, retrieve every raw
 * row that bears on it, stamp each with source, row locator, timestamp, content
 * hash and freshness, and resolve the policy that was actually in force.
 *
 * Three decisions here carry most of the product's weight:
 *
 * 1. **Retrieval is by settlement_id AND by UTR.** Fetching only by
 *    settlement_id would make the single most common settlement failure —
 *    another settlement claiming the same bank reference — structurally
 *    invisible. You cannot detect a collision you never retrieved.
 *
 * 2. **Free text is segregated into `display`.** Bank narration, hold reasons
 *    and event types are real evidence a human needs to see, and they are also
 *    the only attacker-controlled surface in the system. They go into a field
 *    the verifier is forbidden to touch, so injected instructions are not
 *    "filtered" — they are off the verdict path entirely.
 *
 * 3. **Policy is resolved from a timestamp, never passed in.** The caller says
 *    *when*; the pack answers *under what rules*. That inversion is what makes
 *    replay meaningful and what makes STALE_POLICY detectable at all.
 */

import { hashContent, hashPack } from '@/lib/evidence/hash'
import { NULL_POLICY, resolvePolicy } from '@/lib/policy/snapshots'
import { matchSettlement } from '@/lib/matching/engine'
import { loadLedger, type Ledger } from '@/lib/data/ledger'
import type {
  PackMatch,
  EvidenceItem,
  EvidenceProvenance,
  EvidenceKind,
  EvidencePack,
  EvidenceSource,
  SettlementCase,
} from '@/lib/types'

export const AGENT_VERSION = 'avos-agent-1.2.0'

/** File order, so `pack_hash` is stable across runs and machines. */
const SOURCE_ORDER: EvidenceSource[] = [
  'razorpay_payments',
  'razorpay_settlements',
  'bank_statement',
  'refunds',
  'holds',
  'webhook_events',
]

export interface BuildPackOptions {
  /**
   * Resolve policy as of this instant instead of `decision_time`.
   * Replay is the only legitimate caller.
   */
  asOf?: string
  /** evidence_id -> hash, as recorded in the decision log. Drives reproducibility. */
  recordedHashes?: Record<string, string>
  /**
   * Demo/test hook: perturb this evidence row's amount by one paisa before
   * hashing, to show that a mutated source is detected rather than silently
   * re-verified. Purely in-memory; the CSVs on disk are never written.
   */
  tamperEvidenceId?: string
  agentVersion?: string
  modelVersion?: string
  /**
   * Ingest a ledger from somewhere other than the committed CSVs — currently
   * only `lib/connectors/razorpay.ts`.
   *
   * This is the seam that makes "the verifier cannot tell the sources apart" a
   * checkable statement rather than a slogan. Everything below this line runs
   * identically whichever source filled the ledger; if the two produced
   * different verdicts from equivalent facts, the difference could only come
   * from the adapter, because there is no other code that differs.
   *
   * Defaults to the CSV ledger, so the benchmark is untouched and needs no
   * credentials, no network and no configuration.
   */
  ledger?: Ledger
}

function hoursBetween(later: string, earlier: string): number {
  const a = Date.parse(later)
  const b = Date.parse(earlier)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
  return Math.round(((a - b) / 3_600_000) * 100) / 100
}

interface Draft {
  source: EvidenceSource
  provenance?: EvidenceProvenance
  kind: EvidenceKind
  row_id: string
  timestamp: string
  ingested_at: string
  amount_paise: number
  content: Record<string, string | number>
  keys: EvidenceItem['keys']
  display: Record<string, string>
  fee_paise?: number
  tax_paise?: number
  status?: string
  created_at?: string
  fee_rate_bps?: number
  gst_rate_bps?: number
  timestamp_precision?: 'datetime' | 'date'
}

/**
 * Rows from the committed CSVs carry no provenance of their own, so they are
 * labelled here as what they are. This is the default precisely so that a row
 * can never reach the UI unlabelled: an adapter that forgets to stamp its rows
 * produces evidence marked "AVOS Evaluation Dataset", which is wrong in a way
 * a reviewer will notice, rather than "Razorpay" in a way they will not.
 */
function evaluationProvenance(source: EvidenceSource, rowId: string, ingestedAt: string): EvidenceProvenance {
  return {
    origin: 'avos_evaluation',
    label: 'AVOS Evaluation Dataset',
    endpoint: `data/${source}.csv`,
    entity_id: rowId,
    fetched_at: ingestedAt,
  }
}

export function buildEvidencePack(
  c: SettlementCase,
  opts: BuildPackOptions = {},
): EvidencePack {
  const ledger = opts.ledger ?? loadLedger()
  const drafts: Draft[] = []

  // --- settlement rows, by id ------------------------------------------------
  const own = ledger.settlementsById.get(c.settlement_id) ?? []
  const seenSettlementRows = new Set<string>()

  const addSettlement = (s: (typeof own)[number]) => {
    if (seenSettlementRows.has(s.row_id)) return
    seenSettlementRows.add(s.row_id)
    drafts.push({
      source: 'razorpay_settlements',
      provenance: s.provenance,
      kind: 'settlement',
      row_id: s.row_id,
      timestamp: s.settled_at,
      ingested_at: s.ingested_at,
      amount_paise: s.net_amount_paise,
      fee_paise: s.fees_paise,
      tax_paise: s.tax_paise,
      status: s.status,
      content: {
        settlement_id: s.settlement_id,
        merchant_id: s.merchant_id,
        utr: s.utr,
        net_amount_paise: s.net_amount_paise,
        fees_paise: s.fees_paise,
        tax_paise: s.tax_paise,
        created_at: s.created_at,
        settled_at: s.settled_at,
        status: s.status,
      },
      created_at: s.created_at,
      keys: { settlement_id: s.settlement_id, utr: s.utr },
      // Nothing here is free text, so nothing belongs in `display`.
      display: {},
    })
  }

  own.forEach(addSettlement)

  // --- settlement rows sharing a UTR (this is how UTR reuse becomes visible) --
  const utrs = new Set(own.map((s) => s.utr))
  for (const utr of utrs) {
    for (const s of ledger.settlementsByUtr.get(utr) ?? []) addSettlement(s)
  }

  // --- payments --------------------------------------------------------------
  for (const p of ledger.paymentsBySettlement.get(c.settlement_id) ?? []) {
    // The rate card in force when this payment was captured — not when the
    // settlement was decided. For a settlement spanning a repricing these differ,
    // and using the decision-time rate for all of them manufactures a
    // discrepancy that does not exist.
    // Left UNDEFINED when the capture predates every snapshot, so the verifier
    // falls back to the decision-time rate card.
    //
    // The first cut used NULL_POLICY here, whose zero rate silently priced those
    // payments at nothing and manufactured a FEE_MISMATCH on clean settlements
    // whose oldest payment happened to land a few hours before the earliest
    // policy. A "safe" default that is silently wrong is worse than no default:
    // deferring to the decision-time card is at least a rate somebody chose.
    const rateCard = resolvePolicy(p.captured_at)
    drafts.push({
      fee_rate_bps: rateCard?.fee_rate_bps,
      gst_rate_bps: rateCard?.gst_rate_bps,
      source: 'razorpay_payments',
      provenance: p.provenance,
      kind: 'payment',
      row_id: p.row_id,
      timestamp: p.captured_at,
      ingested_at: p.ingested_at,
      amount_paise: p.amount_paise,
      fee_paise: p.fee_paise,
      tax_paise: p.tax_paise,
      content: {
        payment_id: p.payment_id,
        settlement_id: p.settlement_id,
        amount_paise: p.amount_paise,
        fee_paise: p.fee_paise,
        tax_paise: p.tax_paise,
        captured_at: p.captured_at,
      },
      keys: { settlement_id: p.settlement_id, payment_id: p.payment_id },
      display: {},
    })
  }

  // --- refunds ---------------------------------------------------------------
  for (const r of ledger.refundsBySettlement.get(c.settlement_id) ?? []) {
    drafts.push({
      source: 'refunds',
      provenance: r.provenance,
      kind: 'refund',
      row_id: r.row_id,
      timestamp: r.processed_at,
      ingested_at: r.ingested_at,
      amount_paise: r.amount_paise,
      content: {
        refund_id: r.refund_id,
        settlement_id: r.settlement_id,
        payment_id: r.payment_id,
        amount_paise: r.amount_paise,
        processed_at: r.processed_at,
      },
      keys: { settlement_id: r.settlement_id, payment_id: r.payment_id },
      display: {},
    })
  }

  // --- holds -----------------------------------------------------------------
  for (const h of ledger.holdsBySettlement.get(c.settlement_id) ?? []) {
    drafts.push({
      source: 'holds',
      provenance: h.provenance,
      kind: 'hold',
      row_id: h.row_id,
      timestamp: h.placed_at,
      ingested_at: h.ingested_at,
      amount_paise: h.amount_paise,
      content: {
        hold_id: h.hold_id,
        settlement_id: h.settlement_id,
        amount_paise: h.amount_paise,
        reason: h.reason,
        placed_at: h.placed_at,
      },
      keys: { settlement_id: h.settlement_id },
      // `reason` is free text, so it is display-only even though we control it today.
      display: { reason: h.reason },
    })
  }

  // --- bank credits, DERIVED BY MATCHING -------------------------------------
  //
  // This used to be an equality lookup on the UTR, which meant the pairing was
  // handed to us and only the arithmetic was ever checked. That is verification
  // of somebody else's reconciliation, not reconciliation.
  //
  // Now the engine scores every credit inside the settlement's window on
  // reference, amount and date, and only the credits it actually selects enter
  // the pack. When it cannot choose — two identical credits, no reference to
  // separate them — it says AMBIGUOUS and contributes no bank evidence at all,
  // so the verifier abstains rather than closing against a coin flip.
  const primary = own[0]
  let match: PackMatch | null = null
  if (primary) {
    const policyForMatch = resolvePolicy(c.decision_time) ?? NULL_POLICY
    const result = matchSettlement(
      {
        settlement_id: primary.settlement_id,
        utr: primary.utr,
        declared_net_paise: primary.net_amount_paise,
        settled_at: primary.settled_at,
      },
      ledger.bankAll.map((b) => ({
        row_id: b.row_id,
        utr: b.utr,
        credit_paise: b.credit_paise,
        value_date: b.value_date,
      })),
      policyForMatch,
    )
    match = {
      status: result.status,
      matched_row_ids: result.matched_row_ids,
      confidence: result.confidence,
      reasons: result.reasons,
      matcher_version: result.matcher_version,
      candidates: result.candidates.slice(0, 5).map((x) => ({
        row_id: x.row_id,
        score: x.score,
        amount_delta_paise: x.amount_delta_paise,
        date_delta_days: x.date_delta_days,
      })),
    }
  }

  // Only a decided match contributes bank evidence. An AMBIGUOUS result names
  // its tied rows for the operator but deliberately supplies none, because
  // picking one would launder a guess into a fact.
  const selected = new Set(match?.status === 'MATCHED' ? match.matched_row_ids : [])

  // A byte-identical re-ingest of the matched credit is the SAME credit, and it
  // belongs in the pack even though the matcher only needed one of them.
  //
  // Without this the matcher launders the exact failure the duplicate check
  // exists to catch: a settlements file ingested twice produces two identical
  // credits, the engine picks one, and DUPLICATE_FILE never fires. The pairing
  // step must not be able to make evidence disappear.
  //
  // Note this is identity, not similarity — same reference, same amount, same
  // value date. The ambiguous twins differ by a day and are deliberately NOT
  // pulled in; they stay an unresolved match rather than becoming a duplicate.
  const selectedRows = ledger.bankAll.filter((b) => selected.has(b.row_id))
  for (const b of ledger.bankAll) {
    if (selected.has(b.row_id)) continue
    const isSameCredit = selectedRows.some(
      (sel) =>
        sel.utr === b.utr &&
        sel.credit_paise === b.credit_paise &&
        sel.value_date === b.value_date,
    )
    if (isSameCredit) selected.add(b.row_id)
  }

  for (const b of ledger.bankAll) {
    if (!selected.has(b.row_id)) continue
    drafts.push({
      source: 'bank_statement',
      provenance: b.provenance,
      kind: 'bank_credit',
      row_id: b.row_id,
      timestamp: b.value_date,
      ingested_at: b.ingested_at,
      amount_paise: b.credit_paise,
      // Hashed over NORMALISED values, not the raw export string. A bank that
      // reformats `1,46,816.21` as `₹1,46,816.21` has not changed the fact,
      // and a reproducibility check that fired on that would cry wolf until
      // someone switched it off. Value changes are caught; formatting is not.
      content: {
        utr: b.utr,
        credit_paise: b.credit_paise,
        value_date: b.value_date,
        memo: b.memo,
      },
      keys: { utr: b.utr },
      timestamp_precision: b.value_date_precision,
      // Attacker-controlled. Off the verdict path by construction.
      display: { memo: b.memo },
    })
  }

  // --- webhook events --------------------------------------------------------
  for (const w of ledger.webhooksBySettlement.get(c.settlement_id) ?? []) {
    drafts.push({
      source: 'webhook_events',
      provenance: w.provenance,
      kind: 'webhook_event',
      row_id: w.row_id,
      timestamp: w.received_at,
      ingested_at: w.ingested_at,
      amount_paise: w.amount_paise,
      content: {
        event_id: w.event_id,
        settlement_id: w.settlement_id,
        utr: w.utr,
        event_type: w.event_type,
        amount_paise: w.amount_paise,
        received_at: w.received_at,
      },
      keys: { settlement_id: w.settlement_id, utr: w.utr, event_id: w.event_id },
      display: { event_type: w.event_type },
    })
  }

  // --- deterministic ordering ------------------------------------------------
  drafts.sort((a, b) => {
    const s = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)
    return s !== 0 ? s : a.row_id.localeCompare(b.row_id)
  })

  // --- stamp: id, hash, freshness, reproducibility ---------------------------
  const recorded = opts.recordedHashes
  const evidence: EvidenceItem[] = drafts.map((d) => {
    const evidence_id = `${d.source}:${d.row_id}`
    const content =
      opts.tamperEvidenceId === evidence_id
        ? { ...d.content, ...tamperAmount(d) }
        : d.content
    const hash = hashContent(content)
    return {
      evidence_id,
      source: d.source,
      kind: d.kind,
      row_id: d.row_id,
      timestamp: d.timestamp,
      ingested_at: d.ingested_at,
      freshness_hours: hoursBetween(c.decision_time, d.ingested_at),
      amount_paise:
        opts.tamperEvidenceId === evidence_id ? d.amount_paise + 1 : d.amount_paise,
      hash,
      // Absent a decision log there is nothing to contradict, so the row stands.
      hash_matches_recorded: recorded ? recorded[evidence_id] === hash : true,
      keys: d.keys,
      provenance: d.provenance ?? evaluationProvenance(d.source, d.row_id, d.ingested_at),
      fee_paise: d.fee_paise,
      tax_paise: d.tax_paise,
      status: d.status,
      created_at: d.created_at,
      fee_rate_bps: d.fee_rate_bps,
      gst_rate_bps: d.gst_rate_bps,
      timestamp_precision: d.timestamp_precision ?? 'datetime',
      display: d.display,
    }
  })

  const evidence_hashes = evidence.map((e) => e.hash)
  const asOf = opts.asOf ?? c.decision_time
  const policy = resolvePolicy(asOf) ?? NULL_POLICY
  // Resolved from decision_time regardless of replay, so Guard's staleness check
  // compares like with like. Without this, every replay would look "stale".
  const decisionPolicy = resolvePolicy(c.decision_time) ?? NULL_POLICY

  return {
    match,
    decision_id: `dec_${c.case_id}_${c.settlement_id}`,
    settlement_id: c.settlement_id,
    merchant_id: c.merchant_id,
    event_time: c.event_time,
    decision_time: c.decision_time,
    evidence,
    policy_snapshot: policy,
    decision_policy_version: decisionPolicy.version,
    recorded_policy_version: c.recorded_policy_version,
    agent_version: opts.agentVersion ?? AGENT_VERSION,
    model_version: opts.modelVersion ?? 'unset',
    evidence_hashes,
    pack_hash: hashPack(evidence_hashes),
    reproducible: evidence.every((e) => e.hash_matches_recorded),
  }
}

/** One paisa. Enough to change the hash; small enough to be invisible to a human. */
function tamperAmount(d: Draft): Record<string, number> {
  const amountKey = (
    ['credit_paise', 'amount_paise', 'net_amount_paise'] as const
  ).find((k) => k in d.content)
  if (!amountKey) return {}
  return { [amountKey]: (d.content[amountKey] as number) + 1 }
}

/** The evidence_id map a decision log stores, and replay compares against. */
export function evidenceHashMap(pack: EvidencePack): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of pack.evidence) out[e.evidence_id] = e.hash
  return out
}
