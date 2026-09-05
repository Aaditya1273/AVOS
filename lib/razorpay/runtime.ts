/**
 * The product path: Razorpay → Ledger → Evidence → Verifier → closure.
 *
 * This module is the runtime the console runs on. It is deliberately not
 * `lib/decisions.ts`: that file reads committed CSVs and replays a recorded
 * decision log, which is the right thing for an evaluation and the wrong thing
 * for a product that claims to be looking at Razorpay. The two share every
 * stage after the ledger — `buildEvidencePack`, `verifyClaim`, `closeRecord` —
 * and nothing before it.
 *
 * What this module does NOT import, and why it matters:
 *   - `loadLedger` / `loadCases` / `readFileSync` — there is no CSV here. If
 *     Razorpay returns nothing, `cases` is empty and the UI shows empty.
 *   - `loadDecisionLog` / `placeholderProposal` / `proposeClaim` — nothing here
 *     can produce a claim except a model. If there is no model, there is no
 *     claim, and the case is shown without a verdict rather than with a
 *     scripted one.
 *
 * `evals/razorpay-runtime.test.ts` asserts both absences against the source.
 */

import { buildEvidencePack } from '@/lib/evidence/pack'
import { verifyClaim, VERIFIER_VERSION } from '@/lib/verifier/deterministic'
import { closeRecord } from '@/lib/closure'
import { resolvePolicy } from '@/lib/policy/snapshots'
import { proposeClaimStrict } from '@/lib/ai/agent'
import { narrateExceptionStrict } from '@/lib/ai/classify'
import { detectInjection } from '@/lib/ai/qa'
import { ModelUnavailableError, modelAvailability } from '@/lib/ai/provider'
import {
  fetchRazorpaySnapshot,
  type RazorpayApiCall,
  type RazorpayConnection,
  type RazorpayMode,
  type RazorpayRejection,
  type RazorpaySnapshot,
  type SafePayment,
  type SafeRefund,
  type SnapshotOptions,
} from '@/lib/connectors/razorpay'
import type { Ledger } from '@/lib/data/ledger'
import type { ExceptionNarration } from '@/lib/ai/classify'
import type {
  AgentProposal,
  Closure,
  Decision,
  EvidencePack,
  SettlementCase,
  VerificationResult,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Ledger → cases
// ---------------------------------------------------------------------------

/**
 * One case per settlement Razorpay reported. Every figure is derived from the
 * ledger rows; nothing is typed in.
 *
 * `bank_credit_paise` is null on purpose. Razorpay has no endpoint that returns
 * your bank's statement, so there is genuinely no counterparty figure. The
 * verifier will see no bank evidence and say so — that is the correct outcome,
 * and it is a great deal more honest than a match rate computed against
 * nothing.
 */
export function casesFromLedger(ledger: Ledger, fetchedAt: string): SettlementCase[] {
  const cases: SettlementCase[] = []
  const policy = resolvePolicy(fetchedAt)
  for (const [settlementId, rows] of ledger.settlementsById) {
    const setl = rows[0]
    if (!setl) continue
    const pays = ledger.paymentsBySettlement.get(settlementId) ?? []
    const refunds = ledger.refundsBySettlement.get(settlementId) ?? []
    cases.push({
      case_id: `RZ-${settlementId}`,
      settlement_id: settlementId,
      merchant_id: setl.merchant_id,
      razorpay_payment_ids: pays.map((p) => p.payment_id),
      settlement_amount_paise: setl.net_amount_paise,
      bank_credit_paise: null,
      fee_paise: setl.fees_paise,
      refund_paise: refunds.reduce((a, r) => a + r.amount_paise, 0),
      utr: setl.utr,
      event_time: setl.settled_at,
      decision_time: fetchedAt,
      // Ingestion is happening now, so the stamped epoch is the one in force
      // now. `'none'` (no policy yet) is left for Guard to flag rather than
      // patched over.
      recorded_policy_version: policy?.version ?? 'none',
      // A summary-row field the CSV batches carry. The product path has no
      // batch summary; nothing on this path reads it, and no proposal is ever
      // built from it.
      agent_claim: 'NEEDS_REVIEW',
      memo: '',
      batch_value_paise: setl.net_amount_paise,
    })
  }
  cases.sort((a, b) => a.settlement_id.localeCompare(b.settlement_id))
  return cases
}

// ---------------------------------------------------------------------------
// Cases → decisions
// ---------------------------------------------------------------------------

export interface AgentAvailability {
  state: 'available' | 'unavailable'
  model: string | null
  detail: string
}

/**
 * One settlement, as far as the pipeline could take it.
 *
 * `proposal`, `result` and `closure` are null together when no model was
 * available to propose a claim. The evidence pack is still built and still
 * shown: the ledger is real whether or not there is an agent to read it.
 */
export interface RazorpayCaseResult {
  case_id: string
  settlement_id: string
  merchant_id: string
  value_paise: number
  pack: EvidencePack
  proposal: AgentProposal | null
  result: VerificationResult | null
  closure: Closure | null
  narration: ExceptionNarration | null
  injection: { found: boolean; rows: string[] }
  /** Set when the model was available but this one call failed. Never a stand-in. */
  agent_error: string | null
}

export type Proposer = (pack: EvidencePack) => Promise<AgentProposal>
export type Narrator = (result: VerificationResult) => Promise<ExceptionNarration | null>

/**
 * Run the pipeline over the cases a snapshot produced.
 *
 * The proposer and narrator are parameters so a test can substitute a stub
 * transport and prove the wiring, but the defaults are the strict ones and
 * there is no code path here that reaches for the evaluation stand-in.
 */
export async function decideCases(
  cases: SettlementCase[],
  ledger: Ledger,
  fetchedAt: string,
  deps: { propose?: Proposer; narrate?: Narrator } = {},
): Promise<{ cases: RazorpayCaseResult[]; agent: AgentAvailability }> {
  const propose = deps.propose ?? proposeClaimStrict
  const narrate = deps.narrate ?? narrateExceptionStrict

  // Configuration first, so an empty sync reports the agent as it is rather
  // than as "available" because nothing happened to fail. A caller-supplied
  // proposer (tests) is judged by whether its proposals succeed below.
  const configured = modelAvailability()
  let agent: AgentAvailability = deps.propose
    ? { state: 'available', model: null, detail: 'Proposer supplied by caller.' }
    : {
        state: configured.available ? 'available' : 'unavailable',
        model: configured.model,
        detail: configured.detail,
      }
  let modelGone = false
  let proposed = 0
  let modelSeen: string | null = null
  const out: RazorpayCaseResult[] = []

  for (const c of cases) {
    const pack = buildEvidencePack(c, { ledger, modelVersion: configured.model ?? 'unavailable' })
    const injection = detectInjection(pack)
    const base = {
      case_id: c.case_id,
      settlement_id: c.settlement_id,
      merchant_id: c.merchant_id,
      value_paise: c.batch_value_paise,
      pack,
      injection,
    }

    if (modelGone) {
      out.push({ ...base, proposal: null, result: null, closure: null, narration: null, agent_error: null })
      continue
    }

    let proposal: AgentProposal
    try {
      proposal = await propose(pack)
    } catch (e) {
      if (e instanceof ModelUnavailableError) {
        modelGone = true
        agent = { state: 'unavailable', model: null, detail: e.message }
        out.push({ ...base, proposal: null, result: null, closure: null, narration: null, agent_error: null })
        continue
      }
      out.push({
        ...base,
        proposal: null,
        result: null,
        closure: null,
        narration: null,
        agent_error: (e as Error).message,
      })
      continue
    }

    proposed++
    modelSeen = proposal.model_version

    // The boundary. Only `proposal.claim` crosses.
    const result = verifyClaim(proposal.claim, pack, pack.policy_snapshot, fetchedAt)

    const decision: Decision = {
      case_id: c.case_id,
      suite: 'razorpay',
      proposal,
      pack,
      result,
      batch_value_paise: c.batch_value_paise,
      closure: {
        status: 'FAILED',
        closed_at: null,
        value_paise: c.batch_value_paise,
        summary: '',
        required_evidence: [],
        priority: 0,
      },
    }
    decision.closure = closeRecord(decision, fetchedAt)

    let narration: ExceptionNarration | null = null
    try {
      narration = await narrate(result)
    } catch (e) {
      // Narration is description, not decision. Losing it costs a sentence.
      narration = null
      if (!(e instanceof ModelUnavailableError)) {
        out.push({ ...base, proposal, result, closure: decision.closure, narration, agent_error: (e as Error).message })
        continue
      }
    }

    out.push({ ...base, proposal, result, closure: decision.closure, narration, agent_error: null })
  }

  if (proposed > 0) {
    const verified = out.filter((x) => x.result).length
    agent = {
      state: 'available',
      model: modelSeen,
      detail: `${verified} of ${cases.length} settlements proposed on by ${modelSeen} and verified.`,
    }
  } else if (cases.length === 0 && agent.state === 'available') {
    agent = { ...agent, detail: `${agent.detail} No settlements to propose on.` }
  }

  return { cases: out, agent }
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

export type SyncOutcome = 'SUCCESS' | 'EMPTY' | 'ERROR'

/** What the sync route returns. JSON-safe: no Maps, no secrets, no headers. */
export interface RazorpaySyncPayload {
  fetched_at: string
  mode: RazorpayMode | null
  access: 'read-only'
  connection: RazorpayConnection
  outcome: SyncOutcome
  activity: RazorpayApiCall[]
  counts: RazorpaySnapshot['counts']
  ledger_counts: RazorpaySnapshot['ledger_counts']
  rejected: RazorpayRejection[]
  unsettled: { payments: SafePayment[]; refunds: SafeRefund[] }
  truncated: boolean
  agent: AgentAvailability
  verifier_version: string
  cases: RazorpayCaseResult[]
}

/** Snapshot → cases → decisions, with no network of its own. Testable offline. */
export async function syncFromSnapshot(
  snapshot: RazorpaySnapshot,
  deps: { propose?: Proposer; narrate?: Narrator } = {},
): Promise<RazorpaySyncPayload> {
  const cases = casesFromLedger(snapshot.ledger, snapshot.fetched_at)
  const decided =
    snapshot.connection.state === 'CONNECTED'
      ? await decideCases(cases, snapshot.ledger, snapshot.fetched_at, deps)
      : { cases: [] as RazorpayCaseResult[], agent: agentNotRun(snapshot.connection.state) }

  const outcome: SyncOutcome =
    snapshot.connection.state !== 'CONNECTED' ? 'ERROR' : decided.cases.length === 0 ? 'EMPTY' : 'SUCCESS'

  return {
    fetched_at: snapshot.fetched_at,
    mode: snapshot.mode,
    access: 'read-only',
    connection: snapshot.connection,
    outcome,
    activity: snapshot.activity,
    counts: snapshot.counts,
    ledger_counts: snapshot.ledger_counts,
    rejected: snapshot.rejected,
    unsettled: snapshot.unsettled,
    truncated: snapshot.truncated,
    agent: decided.agent,
    verifier_version: VERIFIER_VERSION,
    cases: decided.cases,
  }
}

function agentNotRun(state: RazorpayConnection['state']): AgentAvailability {
  return {
    state: 'unavailable',
    model: null,
    detail: `Not run: Razorpay connection is ${state.replace('_', ' ').toLowerCase()}.`,
  }
}

/** The whole thing: network, normalise, propose, verify, close. */
export async function syncRazorpay(opts: SnapshotOptions = {}): Promise<RazorpaySyncPayload> {
  const snapshot = await fetchRazorpaySnapshot(opts)
  return syncFromSnapshot(snapshot)
}
