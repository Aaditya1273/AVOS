/**
 * The console's view-model: what an operator sees, derived from what the
 * system computed. Nothing here decides anything — every field is read off a
 * `Decision`, a `RazorpayCaseResult` or a `DecisionPayload` and renamed into
 * the operator's vocabulary. No 'use client': the page builds evaluation rows
 * on the server with the same functions the client uses for live ones.
 */

import { formatCompact, formatPaise } from '@/lib/money'
import type { RazorpayCaseResult } from '@/lib/razorpay/runtime'
import type { ExceptionNarration } from '@/lib/ai/classify'
import type {
  AgentProposal,
  CheckResult,
  Closure,
  Decision,
  EvidencePack,
  VerificationResult,
} from '@/lib/types'

export type SourceKind = 'razorpay' | 'evaluation'
/** PENDING: a live settlement with no verdict because no model was available to propose. */
export type Status = 'VERIFIED' | 'UNCERTAIN' | 'FAILED' | 'PENDING'

export const SOURCE_LABEL: Record<SourceKind, string> = {
  razorpay: 'Razorpay Test API',
  evaluation: 'AVOS Evaluation Dataset',
}

export interface SettlementRecord {
  key: string
  case_id: string
  settlement_id: string
  source: SourceKind
  merchant: string
  amount_paise: number
  status: Status
  closure: Closure['status'] | null
  reason_code: string | null
  difference_paise: number | null
  decision_time: string
  event_time: string
  priority: number
  agent_claim: string | null
  confidence: number | null
  evidence_rows: number
}

export interface DetailModel {
  record: SettlementRecord
  pack: EvidencePack
  result: VerificationResult | null
  proposal: AgentProposal | null
  closure: Closure | null
  narration: ExceptionNarration | null
  injection: { found: boolean; rows: string[] }
  failedChecks: CheckResult[]
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<string, string> = {
  FEE_MISMATCH: 'Fee mismatch',
  AMOUNT_MISMATCH: 'Amount mismatch',
  DUPLICATE_UTR: 'Duplicate UTR',
  DUPLICATE_FILE: 'Duplicate file',
  DUPLICATE_EVENT: 'Duplicate event',
  DUPLICATE_PAYMENT_ID_CONFLICT: 'Conflicting payment record',
  MISSING_EVIDENCE: 'Evidence incomplete',
  STALE_EVIDENCE: 'Evidence too old',
  STALE_POLICY: 'Policy out of date',
  POLICY_BREACH: 'Policy breach',
  CONTRADICTORY_SOURCE: 'Sources disagree',
  TEMPORAL_INCONSISTENCY: 'Dates out of order',
  NON_REPRODUCIBLE: 'Evidence changed since decision',
  MALFORMED_EVIDENCE: 'Malformed record',
  OVER_REFUND: 'Refund exceeds payment',
}

export function reasonLabel(code: string | null | undefined): string {
  if (!code) return ''
  return REASON_LABEL[code] ?? code.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Money-first phrasing of a reason: "₹120.00 fee mismatch" when there is a figure. */
export function reasonLine(rec: Pick<SettlementRecord, 'reason_code' | 'difference_paise'>): string {
  const label = reasonLabel(rec.reason_code)
  if (!label) return ''
  const moneyReasons = new Set(['FEE_MISMATCH', 'AMOUNT_MISMATCH', 'OVER_REFUND'])
  if (rec.reason_code && moneyReasons.has(rec.reason_code) && rec.difference_paise != null && rec.difference_paise !== 0) {
    return `${formatPaise(Math.abs(rec.difference_paise))} ${label.toLowerCase()}`
  }
  return label
}

export function statusLabel(status: Status): { title: string; sub: string } {
  switch (status) {
    case 'VERIFIED':
      return { title: 'Verified', sub: 'Safe to close' }
    case 'UNCERTAIN':
      return { title: 'Review required', sub: 'Not closed' }
    case 'FAILED':
      return { title: 'Failed', sub: 'Not closed' }
    case 'PENDING':
      return { title: 'Awaiting verdict', sub: 'No claim to verify yet' }
  }
}

/** What an operator does next. Derived from the reason, never invented per row. */
export function nextAction(rec: Pick<SettlementRecord, 'status' | 'reason_code'>): string {
  if (rec.status === 'VERIFIED') return 'Close'
  if (rec.status === 'PENDING') return 'Configure a model to propose'
  switch (rec.reason_code) {
    case 'FEE_MISMATCH':
      return 'Confirm rate card'
    case 'AMOUNT_MISMATCH':
      return 'Request correction'
    case 'DUPLICATE_UTR':
    case 'DUPLICATE_FILE':
    case 'DUPLICATE_EVENT':
    case 'DUPLICATE_PAYMENT_ID_CONFLICT':
      return 'Resolve duplicate'
    case 'MISSING_EVIDENCE':
    case 'STALE_EVIDENCE':
      return 'Obtain evidence'
    case 'STALE_POLICY':
    case 'POLICY_BREACH':
      return 'Review policy'
    case 'CONTRADICTORY_SOURCE':
      return 'Reconcile sources'
    case 'NON_REPRODUCIBLE':
      return 'Re-verify source'
    default:
      return 'Review'
  }
}

export function money(paise: number): string {
  return formatPaise(paise)
}

export function moneyShort(paise: number): string {
  return formatCompact(paise)
}

export function ageDays(iso: string, now: number): number {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function fromDecision(d: Decision): SettlementRecord {
  return {
    key: `evaluation:${d.case_id}`,
    case_id: d.case_id,
    settlement_id: d.result.settlement_id,
    source: 'evaluation',
    merchant: d.pack.merchant_id,
    amount_paise: d.batch_value_paise,
    status: d.result.verdict,
    closure: d.closure.status,
    reason_code: d.result.reason_code,
    difference_paise: d.result.difference_paise,
    decision_time: d.pack.decision_time,
    event_time: d.pack.event_time,
    priority: d.closure.priority,
    agent_claim: d.proposal.claim.proposed_status,
    confidence: d.proposal.confidence,
    evidence_rows: d.pack.evidence.length,
  }
}

export function fromRazorpayCase(c: RazorpayCaseResult): SettlementRecord {
  return {
    key: `razorpay:${c.case_id}`,
    case_id: c.case_id,
    settlement_id: c.settlement_id,
    source: 'razorpay',
    merchant: c.merchant_id,
    amount_paise: c.value_paise,
    status: c.result?.verdict ?? 'PENDING',
    closure: c.closure?.status ?? null,
    reason_code: c.result?.reason_code ?? null,
    difference_paise: c.result?.difference_paise ?? null,
    decision_time: c.pack.decision_time,
    event_time: c.pack.event_time,
    priority: c.closure?.priority ?? 0,
    agent_claim: c.proposal?.claim.proposed_status ?? null,
    confidence: c.proposal?.confidence ?? null,
    evidence_rows: c.pack.evidence.length,
  }
}

export function detailFromDecision(p: {
  decision: Decision
  narration: ExceptionNarration | null
  injection: { found: boolean; rows: string[] }
}): DetailModel {
  const d = p.decision
  return {
    record: fromDecision(d),
    pack: d.pack,
    result: d.result,
    proposal: d.proposal,
    closure: d.closure,
    narration: p.narration,
    injection: p.injection,
    failedChecks: d.result.checks.filter((c) => c.status === 'fail'),
  }
}

export function detailFromRazorpay(c: RazorpayCaseResult): DetailModel {
  return {
    record: fromRazorpayCase(c),
    pack: c.pack,
    result: c.result,
    proposal: c.proposal,
    closure: c.closure,
    narration: c.narration,
    injection: c.injection,
    failedChecks: c.result?.checks.filter((k) => k.status === 'fail') ?? [],
  }
}

// ---------------------------------------------------------------------------
// Aggregates, sorting, filtering
// ---------------------------------------------------------------------------

export interface Kpis {
  verifiedValue: number
  heldValue: number
  verified: number
  exceptions: number
  reviews: number
  pending: number
  total: number
}

export function kpis(rows: SettlementRecord[]): Kpis {
  const k: Kpis = { verifiedValue: 0, heldValue: 0, verified: 0, exceptions: 0, reviews: 0, pending: 0, total: rows.length }
  for (const r of rows) {
    if (r.status === 'VERIFIED') {
      k.verified++
      k.verifiedValue += r.amount_paise
    } else {
      k.heldValue += r.amount_paise
      if (r.status === 'FAILED') k.exceptions++
      else if (r.status === 'UNCERTAIN') k.reviews++
      else k.pending++
    }
  }
  return k
}

export type SortKey = 'value' | 'recent' | 'oldest' | 'severity'
export const SORT_LABEL: Record<SortKey, string> = {
  value: 'Highest value',
  recent: 'Most recent',
  oldest: 'Oldest',
  severity: 'Most severe',
}

const STATUS_RANK: Record<Status, number> = { FAILED: 0, UNCERTAIN: 1, PENDING: 2, VERIFIED: 3 }

export function sortRecords(rows: SettlementRecord[], key: SortKey): SettlementRecord[] {
  const out = [...rows]
  switch (key) {
    case 'value':
      return out.sort((a, b) => b.amount_paise - a.amount_paise)
    case 'recent':
      return out.sort((a, b) => Date.parse(b.decision_time) - Date.parse(a.decision_time))
    case 'oldest':
      return out.sort((a, b) => Date.parse(a.decision_time) - Date.parse(b.decision_time))
    case 'severity':
      return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.priority - a.priority || b.amount_paise - a.amount_paise)
  }
}

export interface Filters {
  q: string
  status: Status | 'ALL'
  reason: string | 'ALL'
}

export function filterRecords(rows: SettlementRecord[], f: Filters): SettlementRecord[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.status !== 'ALL' && r.status !== f.status) return false
    if (f.reason !== 'ALL' && r.reason_code !== f.reason) return false
    if (!q) return true
    return (
      r.settlement_id.toLowerCase().includes(q) ||
      r.case_id.toLowerCase().includes(q) ||
      r.merchant.toLowerCase().includes(q) ||
      reasonLabel(r.reason_code).toLowerCase().includes(q) ||
      (r.reason_code ?? '').toLowerCase().includes(q)
    )
  })
}

export function reasonsPresent(rows: SettlementRecord[]): string[] {
  return [...new Set(rows.map((r) => r.reason_code).filter((x): x is string => !!x))].sort()
}
