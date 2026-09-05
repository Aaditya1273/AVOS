/**
 * The Razorpay ingestion boundary.
 *
 * This module has exactly one job: turn a Razorpay API response into the same
 * `Ledger` that `lib/data/ledger.ts` builds from the committed CSVs. Nothing
 * downstream of this file knows or cares which of the two produced it.
 *
 * ---------------------------------------------------------------------------
 * WHY `Ledger` AND NOT `EvidenceItem`
 *
 * It would be easier to emit `EvidenceItem[]` directly. It would also prove
 * much less. `buildEvidencePack` is where content hashing, per-payment rate-card
 * stamping, UTR retrieval, duplicate detection and free-text quarantine happen —
 * so an adapter that emitted `EvidenceItem` would be re-implementing the parts
 * of AVOS most worth trusting, and the claim "the verifier cannot tell the
 * sources apart" would be true only because the adapter had done the verifier's
 * preparation itself.
 *
 * Converging at `Ledger` means the two paths join *before* any AVOS logic runs:
 *
 *     committed CSVs ──┐
 *                      ├─▶ Ledger ─▶ buildEvidencePack ─▶ verifyClaim ─▶ verdict
 *     Razorpay API ────┘
 *
 * Every stage after the join is literally the same code on the same types.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE MUST NEVER DO
 *
 * It does not decide anything. No verdict, no closure, no policy, no matching,
 * no model call. It maps wire fields to typed fields and rejects what it cannot
 * map. It never reads a CSV and never falls back to one: if Razorpay returns
 * nothing, the ledger it returns is empty, and that emptiness is the answer.
 * ---------------------------------------------------------------------------
 */

import type {
  BankRow,
  HoldRow,
  Ledger,
  PaymentRow,
  RefundRow,
  SettlementRow,
  WebhookRow,
} from '@/lib/data/ledger'
import type { EvidenceOrigin, EvidenceProvenance } from '@/lib/types'

// Credentials are read at module scope. If this file is ever pulled into a
// client bundle, that is a secret-exposure bug and not something to paper over
// at runtime — fail loudly, at import, in the browser only.
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/connectors/razorpay.ts is server-only: it reads RAZORPAY_KEY_SECRET. ' +
      'Import it from a route handler or server component, never a client component.',
  )
}

// ---------------------------------------------------------------------------
// Razorpay wire shapes
//
// Field names and types below are Razorpay's, not AVOS's, and are deliberately
// spelled exactly as the API returns them. The mapping to AVOS names is the
// point of this file; hiding it behind pre-renamed types would defeat that.
// Reference: https://razorpay.com/docs/api/settlements/
// ---------------------------------------------------------------------------

/** One row of the settlement recon (combined) report. */
export interface RazorpayReconItem {
  entity_id: string
  /** 'payment' | 'refund' | 'adjustment' | 'transfer' | … */
  type: string
  debit: number
  credit: number
  /** Integer paise. Razorpay is paise-native, which is why no scaling happens here. */
  amount: number
  currency: string
  fee: number
  tax: number
  on_hold: boolean
  settled: boolean
  /** Unix epoch SECONDS. */
  created_at: number
  /** Unix epoch SECONDS, or null while unsettled. */
  settled_at: number | null
  settlement_id: string | null
  posted_at: string | null
  description?: string | null
  /** Merchant-supplied free text. Never crosses this boundary — see dropNotes(). */
  notes?: Record<string, string> | null
  payment_id?: string | null
  settlement_utr?: string | null
  order_id?: string | null
  method?: string | null
}

/** The settlement entity, from GET /v1/settlements. */
export interface RazorpaySettlement {
  id: string
  entity: string
  /** Integer paise, net of fees. */
  amount: number
  status: string
  fees: number
  tax: number
  utr: string | null
  /** Unix epoch SECONDS. */
  created_at: number
}

/** The payment entity, from GET /v1/payments. Carries no settlement id. */
export interface RazorpayPayment {
  id: string
  entity: string
  amount: number
  currency: string
  status: string
  captured: boolean
  method?: string | null
  fee?: number | null
  tax?: number | null
  created_at: number
  order_id?: string | null
  notes?: Record<string, string> | null
}

/** The refund entity, from GET /v1/refunds. */
export interface RazorpayRefund {
  id: string
  entity: string
  amount: number
  currency: string
  payment_id: string
  status: string
  created_at: number
  notes?: Record<string, string> | null
}

export interface RazorpayCollection<T> {
  entity: string
  count: number
  items: T[]
}

export type RazorpayReconResponse = RazorpayCollection<RazorpayReconItem>
export type RazorpaySettlementsResponse = RazorpayCollection<RazorpaySettlement>

// ---------------------------------------------------------------------------
// Rejections
//
// Every normalisation failure is collected rather than thrown. A single
// malformed row in a 5,000-row recon report should quarantine that row and let
// the rest through — the alternative is that one bad record makes an entire
// settlement period unverifiable, which is exactly the operational failure AVOS
// exists to prevent.
// ---------------------------------------------------------------------------

export interface RazorpayRejection {
  entity_id: string
  reason: string
}

export interface NormalizeResult {
  ledger: Ledger
  rejected: RazorpayRejection[]
  /** Provenance, carried into the UI so fixture data is never shown as live. */
  source: 'razorpay_api'
  counts: { payments: number; refunds: number; holds: number; settlements: number }
}

export interface NormalizeOptions {
  /**
   * When AVOS received this data. Required, not defaulted to `Date.now()`:
   * freshness is measured from it, so defaulting to the wall clock would make
   * the adapter's output depend on when it ran. Determinism is not optional
   * here even though the source is live.
   */
  ingestedAt: string
  merchantId: string
  /** Which Razorpay environment the rows came from. Stamped onto provenance. */
  origin?: Exclude<EvidenceOrigin, 'avos_evaluation'>
}

// ---------------------------------------------------------------------------
// Field-level normalisation
// ---------------------------------------------------------------------------

/**
 * Razorpay sends Unix epoch SECONDS. This is the only place that conversion
 * happens; nothing downstream sees an epoch integer.
 *
 * The millisecond guard is not paranoia. Passing a millisecond timestamp where
 * seconds are expected does not throw — it silently yields a date ~50,000 years
 * out, which sails through a range check written as "is it a number" and lands
 * in the ledger as a freshness value nobody reads twice.
 */
export function epochSecondsToIso(v: unknown, field: string): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${field}: expected epoch seconds, got ${JSON.stringify(v)}`)
  }
  if (!Number.isInteger(v)) throw new Error(`${field}: epoch must be an integer, got ${v}`)
  if (v <= 0) throw new Error(`${field}: epoch must be positive, got ${v}`)
  // 2100-01-01. Anything beyond is a unit error, near-certainly milliseconds.
  if (v > 4102444800) {
    throw new Error(`${field}: ${v} is out of range for epoch seconds (milliseconds?)`)
  }
  return new Date(v * 1000).toISOString()
}

/**
 * Money stays an integer, always.
 *
 * Razorpay is already paise-native, so there is no conversion to do — which is
 * precisely why this function's job is to refuse rather than to convert. A
 * float arriving here means either a currency unit mistake upstream or a
 * JSON producer that stringified through a double; both must stop at the
 * boundary rather than become a rounding difference in a fee check.
 */
export function paiseField(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${field}: expected integer paise, got ${JSON.stringify(v)}`)
  }
  if (!Number.isInteger(v)) throw new Error(`${field}: money must be integer paise, got ${v}`)
  if (!Number.isSafeInteger(v)) throw new Error(`${field}: ${v} exceeds safe integer range`)
  return v
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`${field}: expected a non-empty string, got ${JSON.stringify(v)}`)
  }
  return v
}

function requireCurrency(v: unknown, field: string): void {
  if (v !== 'INR') {
    throw new Error(`${field}: AVOS reconciles INR only, got ${JSON.stringify(v)}`)
  }
}

// ---------------------------------------------------------------------------
// The `notes` decision
// ---------------------------------------------------------------------------

/**
 * Razorpay `notes` are merchant-supplied key/value text: the one field in the
 * whole payload an outside party controls.
 *
 * AVOS's existing rule is that the only free text crossing into the ledger is
 * `BankRow.memo`, which `pack.ts` quarantines into `EvidenceItem.display`, which
 * `evals/isolation.ts` forbids the verifier from naming. There is no equivalent
 * channel on a payment or refund row.
 *
 * So `notes` are dropped here, entirely, rather than routed somewhere plausible.
 * Adding a free-text field to `PaymentRow` to hold them would widen the
 * attacker-controlled surface to keep data nothing reads — the wrong trade. The
 * adapter test asserts that an injection string placed in `notes` appears
 * nowhere in the serialised ledger.
 *
 * This function exists to make the drop explicit and greppable. Deleting a field
 * by not mentioning it is invisible in review; deleting it by name is not.
 */
function dropNotes(_notes: Record<string, string> | null | undefined): void {
  /* intentionally empty — notes do not cross this boundary */
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export const ENDPOINTS = {
  settlements: '/v1/settlements',
  recon: '/v1/settlements/recon/combined',
  payments: '/v1/payments',
  refunds: '/v1/refunds',
} as const

export function originLabel(origin: EvidenceOrigin): string {
  return origin === 'razorpay_live_api'
    ? 'Razorpay Live API'
    : origin === 'razorpay_test_api'
      ? 'Razorpay Test API'
      : 'AVOS Evaluation Dataset'
}

function stamp(
  origin: Exclude<EvidenceOrigin, 'avos_evaluation'>,
  endpoint: string,
  entityId: string,
  fetchedAt: string,
): EvidenceProvenance {
  return { origin, label: originLabel(origin), endpoint, entity_id: entityId, fetched_at: fetchedAt }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function emptyLedger(): Ledger {
  return {
    paymentsBySettlement: new Map<string, PaymentRow[]>(),
    settlementsById: new Map<string, SettlementRow[]>(),
    settlementsByUtr: new Map<string, SettlementRow[]>(),
    bankByUtr: new Map<string, BankRow[]>(),
    bankAll: [] as BankRow[],
    refundsBySettlement: new Map<string, RefundRow[]>(),
    holdsBySettlement: new Map<string, HoldRow[]>(),
    webhooksBySettlement: new Map<string, WebhookRow[]>(),
    counts: {
      razorpay_payments: 0,
      razorpay_settlements: 0,
      refunds: 0,
      holds: 0,
      bank_statement: 0,
      webhook_events: 0,
    },
  }
}

function push<T>(m: Map<string, T[]>, key: string, v: T): void {
  const list = m.get(key)
  if (list) list.push(v)
  else m.set(key, [v])
}

/**
 * Recon report + settlement entities -> `Ledger`.
 *
 * Note what is NOT produced: `bankAll` stays empty. Razorpay has no API that
 * returns your bank's statement — that is your bank's data, fetched from your
 * bank. AVOS's whole premise is comparing the processor's account of a
 * settlement against an independent one, so a Razorpay-only ledger can support
 * the internal-consistency checks and cannot support bank-side matching. Saying
 * so plainly is better than silently producing a pack whose match rate is
 * meaningless because there was nothing on the other side to match against.
 */
export function normalizeRazorpay(
  recon: RazorpayReconResponse,
  settlements: RazorpaySettlementsResponse,
  opts: NormalizeOptions,
): NormalizeResult {
  const origin = opts.origin ?? 'razorpay_test_api'
  const ledger = emptyLedger()
  const rejected: RazorpayRejection[] = []
  const counts = { payments: 0, refunds: 0, holds: 0, settlements: 0 }

  for (const s of settlements.items ?? []) {
    try {
      const id = requireString(s.id, 'settlement.id')
      const row: SettlementRow = {
        row_id: `rz:setl:${id}`,
        settlement_id: id,
        merchant_id: opts.merchantId,
        utr: typeof s.utr === 'string' ? s.utr : '',
        net_amount_paise: paiseField(s.amount, `settlement.${id}.amount`),
        fees_paise: paiseField(s.fees, `settlement.${id}.fees`),
        tax_paise: paiseField(s.tax, `settlement.${id}.tax`),
        created_at: epochSecondsToIso(s.created_at, `settlement.${id}.created_at`),
        // Razorpay's settlement entity carries no separate settled_at; the
        // recon rows do. Using created_at here rather than inventing a value
        // keeps the field honest, and the recon row is what temporal checks read.
        settled_at: epochSecondsToIso(s.created_at, `settlement.${id}.created_at`),
        status: typeof s.status === 'string' ? s.status : '',
        ingested_at: opts.ingestedAt,
        provenance: stamp(origin, ENDPOINTS.settlements, id, opts.ingestedAt),
      }
      push(ledger.settlementsById, row.settlement_id, row)
      if (row.utr) push(ledger.settlementsByUtr, row.utr, row)
      counts.settlements++
    } catch (e) {
      rejected.push({ entity_id: String(s?.id ?? '<no id>'), reason: (e as Error).message })
    }
  }

  for (const it of recon.items ?? []) {
    const id = typeof it?.entity_id === 'string' ? it.entity_id : '<no entity_id>'
    try {
      dropNotes(it.notes)
      requireCurrency(it.currency, `${id}.currency`)
      const settlementId = requireString(it.settlement_id, `${id}.settlement_id`)
      const occurredAt = epochSecondsToIso(it.created_at, `${id}.created_at`)
      const amount = paiseField(it.amount, `${id}.amount`)
      const provenance = stamp(origin, ENDPOINTS.recon, id, opts.ingestedAt)

      if (it.type === 'payment') {
        const row: PaymentRow = {
          row_id: `rz:pay:${id}`,
          payment_id: requireString(it.payment_id ?? it.entity_id, `${id}.payment_id`),
          settlement_id: settlementId,
          amount_paise: amount,
          fee_paise: paiseField(it.fee, `${id}.fee`),
          tax_paise: paiseField(it.tax, `${id}.tax`),
          captured_at: occurredAt,
          ingested_at: opts.ingestedAt,
          provenance,
        }
        push(ledger.paymentsBySettlement, settlementId, row)
        counts.payments++
      } else if (it.type === 'refund') {
        const row: RefundRow = {
          row_id: `rz:rfnd:${id}`,
          refund_id: id,
          settlement_id: settlementId,
          // Without the payment it refunds, "is this refund larger than what
          // came in" has no answer, so this is required rather than optional.
          payment_id: requireString(it.payment_id, `${id}.payment_id`),
          amount_paise: amount,
          processed_at: occurredAt,
          ingested_at: opts.ingestedAt,
          provenance,
        }
        push(ledger.refundsBySettlement, settlementId, row)
        counts.refunds++
      } else {
        rejected.push({ entity_id: id, reason: `unmapped recon type '${it.type}'` })
        continue
      }

      // on_hold is orthogonal to type: a held payment is both a payment row and
      // a hold row, exactly as the CSV ledger models it.
      if (it.on_hold === true) {
        const hold: HoldRow = {
          row_id: `rz:hold:${id}`,
          hold_id: `hold_${id}`,
          settlement_id: settlementId,
          amount_paise: amount,
          // `description` is Razorpay-generated, not merchant-supplied, and the
          // CSV ledger's HoldRow.reason is the same kind of value.
          reason: typeof it.description === 'string' ? it.description : 'on_hold',
          placed_at: occurredAt,
          ingested_at: opts.ingestedAt,
          provenance,
        }
        push(ledger.holdsBySettlement, settlementId, hold)
        counts.holds++
      }
    } catch (e) {
      rejected.push({ entity_id: id, reason: (e as Error).message })
    }
  }

  ledger.counts = {
    razorpay_payments: counts.payments,
    razorpay_settlements: counts.settlements,
    refunds: counts.refunds,
    holds: counts.holds,
    bank_statement: 0,
    webhook_events: 0,
  }

  return { ledger, rejected, source: 'razorpay_api', counts }
}

// ---------------------------------------------------------------------------
// Credentials and connection state
// ---------------------------------------------------------------------------

export type RazorpayMode = 'test' | 'live'

export interface RazorpayStatus {
  configured: boolean
  /** Key id only, never the secret, and only the public prefix of that. */
  keyIdPrefix: string | null
  mode: RazorpayMode | null
}

/**
 * Whether credentials are present. This is a statement about configuration and
 * nothing more — it does not mean a request has ever succeeded, and no UI may
 * render it as "connected". `classifyConnection` is the only source of that.
 */
export function razorpayStatus(): RazorpayStatus {
  const id = process.env.RAZORPAY_KEY_ID ?? ''
  const secret = process.env.RAZORPAY_KEY_SECRET ?? ''
  if (!id || !secret) return { configured: false, keyIdPrefix: null, mode: null }
  return {
    configured: true,
    // `rzp_test_` / `rzp_live_` is a non-secret prefix. The remainder is not
    // returned, so no caller can leak the key id in full by accident.
    keyIdPrefix: id.slice(0, 9),
    mode: id.startsWith('rzp_live') ? 'live' : 'test',
  }
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID ?? ''
  const secret = process.env.RAZORPAY_KEY_SECRET ?? ''
  if (!id || !secret) throw new Error('Razorpay credentials are not configured')
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
}

/**
 * One outbound request, as recorded for the activity log.
 *
 * Everything here is safe to ship to a browser. There is no header field: the
 * Authorization header is built inside `get()` and never leaves it.
 */
export interface RazorpayApiCall {
  endpoint: string
  method: 'GET'
  /** HTTP status, or null when the request never reached a server. */
  status: number | null
  ok: boolean
  /** The `count` the collection reported, or null on failure. */
  count: number | null
  elapsed_ms: number
  error: string | null
  at: string
  /** 1, or 2 for the single retry after a network-level failure. */
  attempt: 1 | 2
}

export type ConnectionState = 'CONNECTED' | 'AUTHENTICATION_FAILED' | 'NOT_CONFIGURED' | 'UNAVAILABLE'

export interface RazorpayConnection {
  state: ConnectionState
  detail: string
  mode: RazorpayMode | null
  key_id_prefix: string | null
  /** Set only when at least one request was actually made. */
  checked_at: string | null
}

/**
 * CONNECTED means every request made returned 2xx and at least one was made.
 * It is derived from the activity log and from nothing else. Credentials
 * being present is not a connection; a request that succeeded is.
 */
export function classifyConnection(configured: boolean, activity: RazorpayApiCall[]): ConnectionState {
  if (!configured) return 'NOT_CONFIGURED'
  if (activity.length === 0) return 'UNAVAILABLE'
  if (activity.some((a) => a.status === 401 || a.status === 403)) return 'AUTHENTICATION_FAILED'
  // A read is judged by its final attempt. A first attempt that never reached
  // a server and was followed by a successful retry of the same endpoint is a
  // recovered read; the failed attempt stays in the log for anyone to see.
  const unrecovered = activity.filter((a, i) => {
    if (a.ok) return false
    const next = activity[i + 1]
    const recovered =
      a.status === null && a.attempt === 1 && next !== undefined && next.endpoint === a.endpoint && next.attempt === 2 && next.ok
    return !recovered
  })
  return unrecovered.length === 0 ? 'CONNECTED' : 'UNAVAILABLE'
}

function describeConnection(state: ConnectionState, activity: RazorpayApiCall[]): string {
  switch (state) {
    case 'NOT_CONFIGURED':
      return 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set on the server. No request was made.'
    case 'AUTHENTICATION_FAILED': {
      const a = activity.find((x) => x.status === 401 || x.status === 403)
      return `Razorpay rejected the credentials (${a?.status} on ${a?.endpoint}).`
    }
    case 'UNAVAILABLE': {
      const a = activity.find((x) => !x.ok)
      return a
        ? `${a.endpoint} failed: ${a.error ?? `HTTP ${a.status}`}.`
        : 'No request was completed.'
    }
    case 'CONNECTED':
      return `${activity.length} read-only request(s) succeeded.`
  }
}

// ---------------------------------------------------------------------------
// Live fetch — read-only
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.razorpay.com'


/**
 * GET only.
 *
 * There is no POST/PUT/DELETE path anywhere in this module, and no parameter
 * that could introduce one — the method is a literal. AVOS reads evidence; it
 * has no business capturing a payment, issuing a refund or moving a settlement,
 * and a reconciliation tool that *can* do those things is a much harder thing to
 * be given production credentials for.
 *
 * Never throws. A network failure, a 401 and a 5xx are all recorded as a call
 * with `ok: false` so the activity log is complete and the caller can classify
 * the connection from it. Response bodies on failure are truncated and never
 * include the request headers.
 */
async function attempt<T>(path: string, params: Record<string, string>, n: 1 | 2): Promise<{ body: T | null; call: RazorpayApiCall }> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const started = performance.now()
  const at = new Date().toISOString()
  const base = { endpoint: path, method: 'GET' as const, at, attempt: n }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: authHeader(), accept: 'application/json' },
      cache: 'no-store',
    })
    const elapsed_ms = Math.round(performance.now() - started)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        body: null,
        call: {
          ...base,
          status: res.status,
          ok: false,
          count: null,
          elapsed_ms,
          error: `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`,
        },
      }
    }
    const body = (await res.json()) as T & { count?: unknown }
    const count = typeof body?.count === 'number' ? body.count : null
    return { body, call: { ...base, status: res.status, ok: true, count, elapsed_ms, error: null } }
  } catch (e) {
    const err = e as Error & { cause?: { message?: string; code?: string } }
    const cause = err.cause?.message ?? err.cause?.code ?? ''
    return {
      body: null,
      call: {
        ...base,
        status: null,
        ok: false,
        count: null,
        elapsed_ms: Math.round(performance.now() - started),
        error: `${err.message}${cause ? ` — ${cause}` : ''}`,
      },
    }
  }
}

/**
 * One logical read: an attempt, and a single retry if — and only if — the
 * first attempt never reached a server (`status: null`). A 401 or a 503 is an
 * answer and is not retried; a connect timeout is not an answer. Both attempts
 * are appended to the activity log, so a retry is visible rather than hidden.
 */
async function get<T>(path: string, params: Record<string, string>, activity: RazorpayApiCall[]): Promise<T | null> {
  const first = await attempt<T>(path, params, 1)
  activity.push(first.call)
  if (first.call.ok || first.call.status !== null) return first.body
  const second = await attempt<T>(path, params, 2)
  activity.push(second.call)
  return second.body
}

/** A payment as it is safe to show: no notes, no free text, epoch normalised. */
export interface SafePayment {
  id: string
  amount_paise: number
  currency: string
  status: string
  captured: boolean
  method: string | null
  fee_paise: number | null
  tax_paise: number | null
  created_at: string
  order_id: string | null
}

export interface SafeRefund {
  id: string
  payment_id: string
  amount_paise: number
  currency: string
  status: string
  created_at: string
}

function safePayment(p: RazorpayPayment): SafePayment | null {
  try {
    dropNotes(p.notes)
    return {
      id: requireString(p.id, 'payment.id'),
      amount_paise: paiseField(p.amount, `payment.${p.id}.amount`),
      currency: typeof p.currency === 'string' ? p.currency : '',
      status: typeof p.status === 'string' ? p.status : '',
      captured: p.captured === true,
      method: typeof p.method === 'string' ? p.method : null,
      fee_paise: typeof p.fee === 'number' ? paiseField(p.fee, `payment.${p.id}.fee`) : null,
      tax_paise: typeof p.tax === 'number' ? paiseField(p.tax, `payment.${p.id}.tax`) : null,
      created_at: epochSecondsToIso(p.created_at, `payment.${p.id}.created_at`),
      order_id: typeof p.order_id === 'string' ? p.order_id : null,
    }
  } catch {
    return null
  }
}

function safeRefund(r: RazorpayRefund): SafeRefund | null {
  try {
    dropNotes(r.notes)
    return {
      id: requireString(r.id, 'refund.id'),
      payment_id: requireString(r.payment_id, `refund.${r.id}.payment_id`),
      amount_paise: paiseField(r.amount, `refund.${r.id}.amount`),
      currency: typeof r.currency === 'string' ? r.currency : '',
      status: typeof r.status === 'string' ? r.status : '',
      created_at: epochSecondsToIso(r.created_at, `refund.${r.id}.created_at`),
    }
  } catch {
    return null
  }
}

export interface SnapshotOptions {
  /** Which recon months to read. Defaults to the current and previous month. */
  months?: { year: number; month: number }[]
  count?: number
  ingestedAt?: string
  merchantId?: string
}

/**
 * Everything one sync reads from Razorpay, plus the record of reading it.
 *
 * `ledger` is the AVOS ledger the evidence builder consumes. `unsettled` is the
 * safe projection of payments and refunds that Razorpay has not yet put into a
 * settlement: they are real, they are shown, and they cannot be verified yet
 * because there is no settlement to verify them against.
 */
export interface RazorpaySnapshot {
  fetched_at: string
  mode: RazorpayMode | null
  connection: RazorpayConnection
  activity: RazorpayApiCall[]
  counts: { settlements: number; recon_rows: number; payments: number; refunds: number }
  ledger: Ledger
  ledger_counts: NormalizeResult['counts']
  rejected: RazorpayRejection[]
  unsettled: { payments: SafePayment[]; refunds: SafeRefund[] }
}

function defaultMonths(now: Date): { year: number; month: number }[] {
  const cur = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const prev = { year: prevDate.getUTCFullYear(), month: prevDate.getUTCMonth() + 1 }
  return [cur, prev]
}

/**
 * Read one sync's worth of data. Four resources, all GET, every call logged.
 *
 * With no credentials this returns immediately with `NOT_CONFIGURED` and an
 * empty ledger. It does not, under any condition, read a CSV: there is no
 * import of the file-backed loaders in this module, and `evals/razorpay-runtime
 * .test.ts` asserts that mechanically.
 */
export async function fetchRazorpaySnapshot(opts: SnapshotOptions = {}): Promise<RazorpaySnapshot> {
  const fetched_at = opts.ingestedAt ?? new Date().toISOString()
  const status = razorpayStatus()
  const merchantId = opts.merchantId ?? `RZP-${(status.mode ?? 'none').toUpperCase()}`
  const empty = normalizeRazorpay(
    { entity: 'collection', count: 0, items: [] },
    { entity: 'collection', count: 0, items: [] },
    { ingestedAt: fetched_at, merchantId },
  )

  if (!status.configured) {
    return {
      fetched_at,
      mode: null,
      connection: {
        state: 'NOT_CONFIGURED',
        detail: describeConnection('NOT_CONFIGURED', []),
        mode: null,
        key_id_prefix: null,
        checked_at: null,
      },
      activity: [],
      counts: { settlements: 0, recon_rows: 0, payments: 0, refunds: 0 },
      ledger: empty.ledger,
      ledger_counts: empty.counts,
      rejected: [],
      unsettled: { payments: [], refunds: [] },
    }
  }

  const count = String(opts.count ?? 100)
  const months = opts.months ?? defaultMonths(new Date(fetched_at))
  const activity: RazorpayApiCall[] = []

  const settlements = await get<RazorpaySettlementsResponse>(ENDPOINTS.settlements, { count }, activity)

  const reconItems: RazorpayReconItem[] = []
  for (const m of months) {
    const r = await get<RazorpayReconResponse>(
      ENDPOINTS.recon,
      { year: String(m.year), month: String(m.month), count },
      activity,
    )
    if (r?.items) reconItems.push(...r.items)
  }

  const payments = await get<RazorpayCollection<RazorpayPayment>>(ENDPOINTS.payments, { count }, activity)
  const refunds = await get<RazorpayCollection<RazorpayRefund>>(ENDPOINTS.refunds, { count }, activity)

  const state = classifyConnection(true, activity)
  const origin: Exclude<EvidenceOrigin, 'avos_evaluation'> =
    status.mode === 'live' ? 'razorpay_live_api' : 'razorpay_test_api'

  const normalized = normalizeRazorpay(
    { entity: 'collection', count: reconItems.length, items: reconItems },
    settlements ?? { entity: 'collection', count: 0, items: [] },
    { ingestedAt: fetched_at, merchantId, origin },
  )

  const safePayments = (payments?.items ?? []).map(safePayment).filter((p): p is SafePayment => p !== null)
  const safeRefunds = (refunds?.items ?? []).map(safeRefund).filter((r): r is SafeRefund => r !== null)

  return {
    fetched_at,
    mode: status.mode,
    connection: {
      state,
      detail: describeConnection(state, activity),
      mode: status.mode,
      key_id_prefix: status.keyIdPrefix,
      checked_at: fetched_at,
    },
    activity,
    counts: {
      settlements: settlements?.items?.length ?? 0,
      recon_rows: reconItems.length,
      payments: safePayments.length,
      refunds: safeRefunds.length,
    },
    ledger: normalized.ledger,
    ledger_counts: normalized.counts,
    rejected: normalized.rejected,
    unsettled: { payments: safePayments, refunds: safeRefunds },
  }
}
