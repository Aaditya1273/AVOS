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
 * Every stage after the join is literally the same code on the same types. That
 * is the whole of the source-independence claim, and it is checked mechanically
 * in `evals/razorpay-adapter.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE MUST NEVER DO
 *
 * It does not decide anything. No verdict, no closure, no policy, no matching,
 * no model call. It maps wire fields to typed fields and rejects what it cannot
 * map. The verifier stays downstream, and stays importless.
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

export interface RazorpayReconResponse {
  entity: string
  count: number
  items: RazorpayReconItem[]
}

export interface RazorpaySettlementsResponse {
  entity: string
  count: number
  items: RazorpaySettlement[]
}

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
// Normalisation
// ---------------------------------------------------------------------------

function emptyLedger(): Ledger {
  return {
    paymentsBySettlement: new Map<string, PaymentRow[]>(),
    settlementsById: new Map<string, SettlementRow[]>(),
    settlementsByUtr: new Map<string, SettlementRow[]>(),
    bankByUtr: new Map<string, BankRow[]>(),
    bankAll: [] as BankRow[],
    refundsBySettlement: new Map<string, RefundRow[]>(),
    holdsBySettlement: new Map<string, HoldRow[]>(),
    webhooksBySettlement: new Map<string, WebhookRow[]>(),
    counts: {},
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
// Live fetch — read-only
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.razorpay.com/v1'

export interface RazorpayStatus {
  configured: boolean
  /** Key id only, never the secret, and only the public prefix of that. */
  keyIdPrefix: string | null
  mode: 'test' | 'live' | null
}

/**
 * Whether credentials are present. Absence is a configuration state, not an
 * error: the committed fixtures are the primary source and always available.
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
 * GET only.
 *
 * There is no POST/PUT/DELETE path anywhere in this module, and no parameter
 * that could introduce one — the method is a literal. AVOS reads evidence; it
 * has no business capturing a payment, issuing a refund or moving a settlement,
 * and a reconciliation tool that *can* do those things is a much harder thing to
 * be given production credentials for.
 */
async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, {
    method: 'GET',
    headers: { authorization: authHeader(), accept: 'application/json' },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // The Authorization header is never echoed. Razorpay error bodies do not
    // contain credentials, but they are truncated anyway: an error path is a
    // common way for a secret to reach a log by accident.
    throw new Error(`Razorpay ${path} -> ${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

export interface FetchOptions {
  year: number
  /** 1-12. */
  month: number
  merchantId?: string
  ingestedAt?: string
  count?: number
}

/**
 * Fetch one month of recon data and the settlements it refers to, and normalise.
 *
 * Deliberately not wired into the page or the benchmark. It is reachable from
 * `npm run test:razorpay` and from nothing else, so no request path and no gate
 * can acquire a network dependency by accident.
 */
export async function fetchRazorpayLedger(opts: FetchOptions): Promise<NormalizeResult> {
  const count = String(opts.count ?? 100)
  const recon = await get<RazorpayReconResponse>('/settlements/recon/combined', {
    year: String(opts.year),
    month: String(opts.month),
    count,
  })
  const settlements = await get<RazorpaySettlementsResponse>('/settlements', { count })

  return normalizeRazorpay(recon, settlements, {
    ingestedAt: opts.ingestedAt ?? new Date().toISOString(),
    merchantId: opts.merchantId ?? 'RZP_LIVE_MERCHANT',
  })
}
