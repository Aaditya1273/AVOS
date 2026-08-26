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
import { parseCsv, paiseField, type CsvRow } from '@/lib/csv'
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
  credit_paise: number
  value_date: string
  narration: string
  ingested_at: string
}

export interface RefundRow {
  row_id: string
  refund_id: string
  settlement_id: string
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

  const bank = readCsv('bank_statement.csv').map<BankRow>((r) => ({
    row_id: r.row_id,
    utr: r.utr,
    credit_paise: paiseField(r, 'credit_paise'),
    value_date: r.value_date,
    narration: r.narration,
    ingested_at: r.ingested_at,
  }))

  const refunds = readCsv('refunds.csv').map<RefundRow>((r) => ({
    row_id: r.row_id,
    refund_id: r.refund_id,
    settlement_id: r.settlement_id,
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

export type Suite = 'batch_120' | 'adversarial_30'

const SUITE_FILE: Record<Suite, string> = {
  batch_120: 'settlement_batch_120.csv',
  adversarial_30: 'adversarial_suite_30.csv',
}

export function loadCases(suite: Suite): SettlementCase[] {
  return readCsv(SUITE_FILE[suite]).map<SettlementCase>((r) => ({
    case_id: r.case_id,
    settlement_id: r.settlement_id,
    merchant_id: r.merchant_id,
    event_time: r.event_time,
    decision_time: r.decision_time,
    batch_value_paise: paiseField(r, 'batch_value_paise'),
    recorded_policy_version: r.recorded_policy_version,
    agent_claim: r.agent_claim as ProposedStatus,
  }))
}

// ---------------------------------------------------------------------------
// Ground truth — EVAL ONLY.
// Nothing under app/ or lib/ai/ may import this. `evals/isolation.ts` enforces it.
// ---------------------------------------------------------------------------

const GT_FILE: Record<Suite, string> = {
  batch_120: 'ground_truth_batch_120.csv',
  adversarial_30: 'ground_truth_adversarial_30.csv',
}

export function loadGroundTruth(suite: Suite): Map<string, GroundTruth> {
  const out = new Map<string, GroundTruth>()
  for (const r of readCsv(GT_FILE[suite])) {
    out.set(r.case_id, {
      case_id: r.case_id,
      settlement_id: r.settlement_id,
      // batch labels the column `scenario`; the adversarial suite labels it `attack`.
      scenario: r.scenario ?? r.attack ?? '',
      expected_verdict: r.expected_verdict as Verdict,
      expected_reason: r.expected_reason,
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
