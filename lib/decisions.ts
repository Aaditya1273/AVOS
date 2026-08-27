/**
 * Decision assembly and the decision log.
 *
 * A Decision is the unit a Proof Card renders: what the agent claimed, what
 * evidence was retrieved, and what the verifier concluded.
 *
 * ---------------------------------------------------------------------------
 * Why a committed decision log
 *
 * `npm run eval` writes `data/decision_log.json`, and the app reads it. It holds
 * two things that cannot be recomputed later:
 *
 *  1. **What the agent said.** A claim and its rationale are historical facts.
 *     Re-running the model would produce a different sentence and quietly
 *     rewrite the record — which is the opposite of an audit trail.
 *
 *  2. **The evidence hashes as recorded at decision time.** This is what makes
 *     replay meaningful. Without a stored baseline there is nothing for a
 *     recomputed hash to disagree with, and "reproducible" would be a claim
 *     rather than a check.
 *
 * Everything else — the pack, the verdict — is deliberately NOT trusted from the
 * log. It is recomputed from source on every page load. If the recomputation
 * ever disagrees with the log, that disagreement is the product working.
 * ---------------------------------------------------------------------------
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildEvidencePack, evidenceHashMap, AGENT_VERSION } from '@/lib/evidence/pack'
import { verifyClaim, VERIFIER_VERSION } from '@/lib/verifier/deterministic'
import { MODEL_VERSION } from '@/lib/ai/provider'
import { loadCases, type Suite } from '@/lib/data/ledger'
import type {
  AgentProposal,
  Decision,
  ProposedStatus,
  ReasonCode,
  SettlementCase,
  Verdict,
} from '@/lib/types'

const LOG_PATH = path.join(process.cwd(), 'data', 'decision_log.json')

export interface DecisionLogEntry {
  case_id: string
  suite: Suite
  settlement_id: string
  decision_time: string
  agent: {
    proposed_status: ProposedStatus
    evidence_ids: string[]
    agent_reason: string
    confidence: number
    agent_version: string
    model_version: string
    used_mock: boolean
  }
  pack_hash: string
  /** evidence_id -> hash, as it stood when the decision was taken. */
  evidence_hashes: Record<string, string>
  recorded_verdict: Verdict
  recorded_reason_code: ReasonCode | null
  policy_version: string
}

export interface DecisionLog {
  verifier_version: string
  generated_at: string
  entries: Record<string, DecisionLogEntry>
}

let logCache: DecisionLog | null | undefined

/** The eval harness writes the log mid-run and must re-read it. */
export function resetDecisionLogCache(): void {
  logCache = undefined
}

/** Null before the first `npm run eval`. Callers must degrade, not crash. */
export function loadDecisionLog(): DecisionLog | null {
  if (logCache !== undefined) return logCache
  logCache = existsSync(LOG_PATH)
    ? (JSON.parse(readFileSync(LOG_PATH, 'utf8')) as DecisionLog)
    : null
  return logCache
}

/**
 * The stand-in used when no decision has been logged for a case yet.
 *
 * It is labelled as a placeholder rather than quietly invented, because an
 * unlabelled fake claim in an audit UI is worse than an empty one.
 */
function placeholderProposal(c: SettlementCase, evidenceIds: string[]): AgentProposal {
  return {
    claim: {
      settlement_id: c.settlement_id,
      proposed_status: c.agent_claim,
      evidence_ids: evidenceIds,
    },
    agent_reason: '(no recorded agent rationale — run `npm run eval` to populate the decision log)',
    confidence: 0,
    agent_version: AGENT_VERSION,
    model_version: MODEL_VERSION,
    used_mock: true,
  }
}

/**
 * Rebuild one decision from source, verifying against the recorded baseline.
 *
 * Synchronous and model-free by design: rendering 150 Proof Cards must not fan
 * out 150 model calls, and more importantly, a page that needed a model to draw
 * a verdict would undermine the claim that the verdict has no model in it.
 */
export function materializeDecision(
  c: SettlementCase,
  suite: Suite,
  log: DecisionLog | null = loadDecisionLog(),
  opts: { asOf?: string; tamperEvidenceId?: string } = {},
): Decision {
  const entry = log?.entries[c.case_id]

  const pack = buildEvidencePack(c, {
    asOf: opts.asOf,
    recordedHashes: entry?.evidence_hashes,
    tamperEvidenceId: opts.tamperEvidenceId,
    agentVersion: entry?.agent.agent_version,
    modelVersion: entry?.agent.model_version ?? MODEL_VERSION,
  })

  const proposal: AgentProposal = entry
    ? {
        claim: {
          settlement_id: c.settlement_id,
          proposed_status: entry.agent.proposed_status,
          evidence_ids: entry.agent.evidence_ids,
        },
        agent_reason: entry.agent.agent_reason,
        confidence: entry.agent.confidence ?? 0,
        agent_version: entry.agent.agent_version,
        model_version: entry.agent.model_version,
        used_mock: entry.agent.used_mock,
      }
    : placeholderProposal(c, pack.evidence.map((e) => e.evidence_id))

  const result = verifyClaim(
    proposal.claim,
    pack,
    pack.policy_snapshot,
    opts.asOf ?? pack.decision_time,
  )

  return {
    case_id: c.case_id,
    suite,
    proposal,
    pack,
    result,
    batch_value_paise: c.batch_value_paise,
  }
}

export function materializeSuite(suite: Suite): Decision[] {
  const log = loadDecisionLog()
  return loadCases(suite).map((c) => materializeDecision(c, suite, log))
}

/** Case lookup by id across both suites. */
export function findCase(caseId: string): { c: SettlementCase; suite: Suite } | null {
  for (const suite of ['batch_120', 'adversarial_30', 'hard_slice_20'] as Suite[]) {
    const c = loadCases(suite).find((x) => x.case_id === caseId)
    if (c) return { c, suite }
  }
  return null
}

/** Same, by settlement id — what a human types into a search box. */
export function findCaseBySettlement(settlementId: string): { c: SettlementCase; suite: Suite } | null {
  for (const suite of ['batch_120', 'adversarial_30', 'hard_slice_20'] as Suite[]) {
    const c = loadCases(suite).find((x) => x.settlement_id === settlementId)
    if (c) return { c, suite }
  }
  return null
}

export { VERIFIER_VERSION, evidenceHashMap }
