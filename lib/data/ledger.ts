/**
 * The ledger loader. Server-only: reads the CSV evidence from disk and builds
 * the lookup indexes the Evidence Pack Builder retrieves against.
 *
 * Loaded once per process and memoised. The fixture is ~1,600 rows, so an
 * in-memory index is the correct amount of machinery — a database here would be
 * infrastructure with no reader.
 *
 * Two rules this module enforces:
 *
 *  - **Ground truth is loaded by a separate function that the agent path never
 *    calls.** `loadCases()` returns unlabelled cases; `loadGroundTruth()` is
 *    imported only by `evals/`. The separation is physical (different files,
 *    different functions), not a naming convention.
 *
 *  - **Retrieval is by key, not by scan.** Evidence is fetched by settlement_id
 *    and by UTR, because retrieving by UTR is exactly how a duplicate UTR on a
 *    *different* settlement becomes visible to the verifier. Retrieving only by
 *    settlement_id would hide the most common real-world settlement failure.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseCsv,
  paiseField,
  parsePaise,
  parsePaiseOptional,
  parseFlexibleDate,
  type CsvRow,
} from '@/lib/csv'
import { isDateOnly, type TimestampPrecision } from '@/lib/evidence/normalize'
import type { GroundTruth, SettlementCase, Verdict, ProposedStatus } from '@/lib/types'

const DATA_DIR = path.join(process.cwd(), 'data')

function readCsv(name: string): CsvRow[] {
  return parseCsv(readFileSync(path.join(DATA_DIR, name), 'utf8'))
}

// ---------------------------------------------------------------------------
// Row shapes, mirroring the generator's column contract exactly
// ---------------------------------------------------------------------------

export interface PaymentRow {
  row_id: string
  payment_id: string
  settlement_id: string
  amount_paise: number
  fee_paise: number
  tax_paise: number
  captured_at: string
  ingested_at: string
}

export interface SettlementRow {
  row_id: string
  settlement_id: string
  merchant_id: string
  utr: string
  net_amount_paise: number
  fees_paise: number
  tax_paise: number
  created_at: string
  settled_at: string
  status: string
  ingested_at: string
}

export interface BankRow {
  row_id: string
  utr: string
  /** Normalised from a formatted export string (`₹1,46,816.21`, `Rs. …`, plain). */
  credit_paise: number
  /** Normalised to ISO-8601 from ISO, SQL or MM/DD/YYYY. Date-only lands at end of day. */
  value_date: string
  /** `'date'` when the export carried no time component. Ordering checks drop to day granularity. */
  value_date_precision: TimestampPrecision
  /** Free text. The only attacker-controlled surface in the ledger. */
  memo: string
  ingested_at: string
}

export interface RefundRow {
  row_id: string
  refund_id: string
  settlement_id: string
  /** The payment this refund refunds. Without it, "is this refund too large" is unanswerable. */
  payment_id: string
  amount_paise: number
  processed_at: string
  ingested_at: string
}

export interface HoldRow {
  row_id: string
  hold_id: string
  settlement_id: string
  amount_paise: number
  reason: string
  placed_at: string
  ingested_at: string
}

export interface WebhookRow {
  row_id: string
  event_id: string
  settlement_id: string
  utr: string
  event_type: string
  amount_paise: number
  received_at: string
  ingested_at: string
}

export interface Ledger {
  paymentsBySettlement: Map<string, PaymentRow[]>
  settlementsById: Map<string, SettlementRow[]>
  settlementsByUtr: Map<string, SettlementRow[]>
  bankByUtr: Map<string, BankRow[]>
  refundsBySettlement: Map<string, RefundRow[]>
  holdsBySettlement: Map<string, HoldRow[]>
  webhooksBySettlement: Map<string, WebhookRow[]>
  counts: Record<string, number>
}

function push<T>(m: Map<string, T[]>, key: string, v: T): void {
  const list = m.get(key)
  if (list) list.push(v)
  else m.set(key, [v])
}

let cached: Ledger | null = null

export function loadLedger(): Ledger {
  if (cached) return cached

  const payments = readCsv('razorpay_payments.csv').map<PaymentRow>((r) => ({
    row_id: r.row_id,
    payment_id: r.payment_id,
    settlement_id: r.settlement_id,
    amount_paise: paiseField(r, 'amount_paise'),
    fee_paise: paiseField(r, 'fee_paise'),
    tax_paise: paiseField(r, 'tax_paise'),
    captured_at: r.captured_at,
    ingested_at: r.ingested_at,
  }))

  const settlements = readCsv('razorpay_settlements.csv').map<SettlementRow>((r) => ({
    row_id: r.row_id,
    settlement_id: r.settlement_id,
    merchant_id: r.merchant_id,
    utr: r.utr,
    net_amount_paise: paiseField(r, 'net_amount_paise'),
    fees_paise: paiseField(r, 'fees_paise'),
    tax_paise: paiseField(r, 'tax_paise'),
    created_at: r.created_at,
    settled_at: r.settled_at,
    status: r.status,
    ingested_at: r.ingested_at,
  }))

  // The dirtiest file in the ledger, and the only one whose every column needs
  // normalising: money as a formatted string, dates in three conventions, and a
  // free-text memo an attacker can write into.
  const bank = readCsv('bank_statement.csv').map<BankRow>((r) => ({
    row_id: r.row_id,
    utr: r.utr.trim(),
    credit_paise: parsePaise(r.credit, `bank credit on row ${r.row_id}`),
    value_date: parseFlexibleDate(r.value_date, `value_date on row ${r.row_id}`),
    value_date_precision: isDateOnly(r.value_date) ? 'date' : 'datetime',
    memo: r.memo ?? '',
    ingested_at: r.ingested_at,
  }))

  const refunds = readCsv('refunds.csv').map<RefundRow>((r) => ({
    row_id: r.row_id,
    refund_id: r.refund_id,
    settlement_id: r.settlement_id,
    payment_id: r.payment_id ?? '',
    amount_paise: paiseField(r, 'amount_paise'),
    processed_at: r.processed_at,
    ingested_at: r.ingested_at,
  }))

  const holds = readCsv('holds.csv').map<HoldRow>((r) => ({
    row_id: r.row_id,
    hold_id: r.hold_id,
    settlement_id: r.settlement_id,
    amount_paise: paiseField(r, 'amount_paise'),
    reason: r.reason,
    placed_at: r.placed_at,
    ingested_at: r.ingested_at,
  }))

  const webhooks = readCsv('webhook_events.csv').map<WebhookRow>((r) => ({
    row_id: r.row_id,
    event_id: r.event_id,
    settlement_id: r.settlement_id,
    utr: r.utr,
    event_type: r.event_type,
    amount_paise: paiseField(r, 'amount_paise'),
    received_at: r.received_at,
    ingested_at: r.ingested_at,
  }))

  const ledger: Ledger = {
    paymentsBySettlement: new Map(),
    settlementsById: new Map(),
    settlementsByUtr: new Map(),
    bankByUtr: new Map(),
    refundsBySettlement: new Map(),
    holdsBySettlement: new Map(),
    webhooksBySettlement: new Map(),
    counts: {
      razorpay_payments: payments.length,
      razorpay_settlements: settlements.length,
      bank_statement: bank.length,
      refunds: refunds.length,
      holds: holds.length,
      webhook_events: webhooks.length,
    },
  }

  for (const p of payments) push(ledger.paymentsBySettlement, p.settlement_id, p)
  for (const s of settlements) {
    push(ledger.settlementsById, s.settlement_id, s)
    push(ledger.settlementsByUtr, s.utr, s)
  }
  for (const b of bank) push(ledger.bankByUtr, b.utr, b)
  for (const r of refunds) push(ledger.refundsBySettlement, r.settlement_id, r)
  for (const h of holds) push(ledger.holdsBySettlement, h.settlement_id, h)
  for (const w of webhooks) push(ledger.webhooksBySettlement, w.settlement_id, w)

  cached = ledger
  return ledger
}

// ---------------------------------------------------------------------------
// Case indexes — agent-visible, deliberately unlabelled
// ---------------------------------------------------------------------------

export type Suite = 'batch_120' | 'adversarial_30' | 'hard_slice_20'

const SUITE_FILE: Record<Suite, string> = {
  batch_120: 'settlement_batch_120.csv',
  adversarial_30: 'adversarial_suite_30.csv',
  hard_slice_20: 'hard_slice_28.csv',
}

export function loadCases(suite: Suite): SettlementCase[] {
  return readCsv(SUITE_FILE[suite]).map<SettlementCase>((r) => {
    const settlementAmount = parsePaise(
      r.settlement_amount,
      `settlement_amount on case ${r.case_id}`,
    )
    return {
      case_id: r.case_id,
      settlement_id: r.settlement_id,
      merchant_id: r.merchant_id,
      razorpay_payment_ids: (r.razorpay_payment_ids ?? '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean),
      settlement_amount_paise: settlementAmount,
      // An empty cell is a missing bank leg, not a zero credit. Coercing it to 0
      // would turn "we have no evidence" into "the bank sent nothing", which is
      // a different — and closeable — claim.
      bank_credit_paise: parsePaiseOptional(r.bank_credit, `bank_credit on ${r.case_id}`),
      fee_paise: parsePaise(r.fee, `fee on case ${r.case_id}`),
      refund_paise: parsePaise(r.refund, `refund on case ${r.case_id}`),
      utr: r.utr.trim(),
      event_time: parseFlexibleDate(r.event_time, `event_time on case ${r.case_id}`),
      decision_time: parseFlexibleDate(r.decision_time, `decision_time on case ${r.case_id}`),
      recorded_policy_version: r.policy_version,
      agent_claim: r.agent_claim as ProposedStatus,
      memo: r.memo ?? '',
      batch_value_paise: Math.max(settlementAmount, 0),
    }
  })
}

// ---------------------------------------------------------------------------
// Ground truth — EVAL ONLY.
// Nothing under app/ or lib/ai/ may import this. `evals/isolation.ts` enforces it.
// ---------------------------------------------------------------------------

interface GroundTruthEntry {
  settlement_id: string
  scenario?: string
  attack?: string
  expected_status: string
  expected_reason: string
}

interface GroundTruthEntryHard extends GroundTruthEntry {
  family?: string
  note?: string
}

type GroundTruthFile = Record<string, Record<string, GroundTruthEntryHard>>

/**
 * The hard slice keeps its labels in a separate file for a reason that is not
 * filing tidiness: those labels were hand-reasoned per case, before the cases
 * were run, rather than looked up from the fault that was injected. Mixing them
 * into ground_truth.json would blur the distinction between a benchmark that can
 * only score 100% and one that can actually fail.
 */
const GT_FILE: Record<Suite, string> = {
  batch_120: 'ground_truth.json',
  adversarial_30: 'ground_truth.json',
  hard_slice_20: 'ground_truth_hard.json',
}

export function loadGroundTruth(suite: Suite): Map<string, GroundTruth> {
  const file = JSON.parse(
    readFileSync(path.join(DATA_DIR, GT_FILE[suite]), 'utf8'),
  ) as GroundTruthFile

  const out = new Map<string, GroundTruth>()
  for (const [case_id, e] of Object.entries(file[suite])) {
    out.set(case_id, {
      case_id,
      settlement_id: e.settlement_id,
      // The batch calls it `scenario`; the adversarial suite calls it `attack`.
      scenario: e.scenario ?? e.attack ?? e.family ?? '',
      expected_verdict: e.expected_status as Verdict,
      expected_reason: e.expected_reason,
    })
  }
  return out
}

export interface DatasetManifest {
  seed: number
  money_unit: string
  batch_120: {
    cases: number
    composition: Record<string, number>
    expected_verdicts: Record<string, number>
    total_value_paise: number
  }
  adversarial_30: {
    cases: number
    composition: Record<string, number>
    expected_verdicts: Record<string, number>
  }
  evidence_rows: Record<string, number>
  policies: string[]
  injection_string: string
}

export function loadManifest(): DatasetManifest {
  return JSON.parse(readFileSync(path.join(DATA_DIR, 'dataset_manifest.json'), 'utf8'))
}
