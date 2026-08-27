/**
 * Exception narration — AI turning a deterministic finding into something an
 * operator can act on before their first coffee.
 *
 * The verdict and the reason code are already decided by the time this runs.
 * What is left is genuinely a language problem: `FEE_MISMATCH, difference
 * 12000p, fee_delta 12000p` is correct and useless at 9am on a Monday. Someone
 * has to say "the settlement declared ₹120 more in platform fees than its
 * payments account for; this is pricing's, not settlements'."
 *
 * Look at the output schema: `summary`, `suggested_owner`, `next_action`. There
 * is no verdict field, no reason-code field, no amount field. The model cannot
 * overturn, re-label, or restate a number, because the schema gives it nowhere
 * to put one. Constraining the output shape is how you use a language model on
 * financial data without letting it near the finances.
 */

import { z } from 'zod'
import { generateStructured } from '@/lib/ai/provider'
import type { ReasonCode, VerificationResult } from '@/lib/types'

const NarrationSchema = z.object({
  summary: z
    .string()
    .describe('One or two sentences a finance operator can act on. No new numbers.'),
  suggested_owner: z
    .enum(['settlements_ops', 'pricing', 'data_engineering', 'risk', 'none'])
    .describe('Which team should pick this up.'),
  next_action: z.string().describe('The single next step, imperative, one line.'),
})

export type ExceptionNarration = z.infer<typeof NarrationSchema>

/**
 * Default routing per reason code.
 *
 * This table is the mock, and it is also the safety net: when the model is
 * unavailable, unreachable, or returns nonsense, the operator still gets correct
 * routing. The AI improves the sentence; it is not what makes the exception
 * actionable. Getting that dependency the right way round is most of what
 * separates a demo from something you would page someone with.
 */
const ROUTING: Record<ReasonCode, Omit<ExceptionNarration, 'summary'> & { blurb: string }> = {
  FEE_MISMATCH: {
    suggested_owner: 'pricing',
    next_action: 'Compare the settlement fee line against the contracted rate card for this merchant.',
    blurb: 'The settlement declared more in platform fees than its own payment rows account for.',
  },
  AMOUNT_MISMATCH: {
    suggested_owner: 'settlements_ops',
    next_action: 'Trace the missing amount through captures, refunds and holds for this settlement.',
    blurb: 'The credited amount does not match the recomputed net, and the fee line does not explain the gap.',
  },
  DUPLICATE_UTR: {
    suggested_owner: 'settlements_ops',
    next_action: 'Identify which settlement legitimately owns this bank reference before closing either.',
    blurb: 'Two settlements claim the same bank reference, so one of them would reconcile against the other’s money.',
  },
  DUPLICATE_FILE: {
    suggested_owner: 'data_engineering',
    next_action: 'De-duplicate the source ingestion and re-run the pack; do not close until row counts settle.',
    blurb: 'Identical source content was ingested more than once, which double-counts the credit.',
  },
  DUPLICATE_EVENT: {
    suggested_owner: 'data_engineering',
    next_action: 'Add idempotency on event_id at the webhook consumer and replay the affected window.',
    blurb: 'A webhook redelivery was processed more than once.',
  },
  MISSING_EVIDENCE: {
    suggested_owner: 'data_engineering',
    next_action: 'Backfill the missing source rows, then re-verify. Do not close on partial evidence.',
    blurb: 'Part of the evidence needed to recompute this settlement was never retrieved.',
  },
  CONTRADICTORY_SOURCE: {
    suggested_owner: 'data_engineering',
    next_action: 'Establish which restatement supersedes the other and add a supersession marker.',
    blurb: 'Two versions of this settlement disagree and nothing marks one as superseding the other.',
  },
  STALE_POLICY: {
    suggested_owner: 'risk',
    next_action: 'Re-run this decision under the policy version that was in force at decision time.',
    blurb: 'This decision was stamped with a policy that was not the one in force when it was taken.',
  },
  STALE_EVIDENCE: {
    suggested_owner: 'data_engineering',
    next_action: 'Refresh the ingestion for this source and re-verify.',
    blurb: 'Evidence was older at decision time than the policy allows.',
  },
  TEMPORAL_INCONSISTENCY: {
    suggested_owner: 'settlements_ops',
    next_action: 'Check the settlement lifecycle timestamps against the bank value date.',
    blurb: 'The settlement lifecycle is out of order or breaches the settlement-lag limit.',
  },
  NON_REPRODUCIBLE: {
    suggested_owner: 'risk',
    next_action: 'Treat as an integrity incident: source rows changed after the decision was recorded.',
    blurb: 'Evidence no longer hashes to the values recorded when the decision was taken.',
  },
  MALFORMED_EVIDENCE: {
    suggested_owner: 'data_engineering',
    next_action: 'Fix the malformed source rows at ingest, then re-verify. Do not close on unparsed data.',
    blurb: 'An amount or timestamp reached the verifier malformed, so nothing could be recomputed from it.',
  },
  DUPLICATE_PAYMENT_ID_CONFLICT: {
    suggested_owner: 'data_engineering',
    next_action: 'Establish which row supersedes the other and mark it, then re-verify.',
    blurb: 'The same payment appears twice at different amounts, so its gross is not a settled fact.',
  },
  OVER_REFUND: {
    suggested_owner: 'risk',
    next_action: 'Investigate how a refund exceeded its original payment before releasing anything.',
    blurb: 'A refund is larger than the payment it refunds, which should not be constructible.',
  },
  POLICY_BREACH: {
    suggested_owner: 'risk',
    next_action: 'Confirm whether this settlement status may be closed under the active policy.',
    blurb: 'The settlement is in a state the active policy does not permit closing.',
  },
}

export const CLEAN_NARRATION: ExceptionNarration = {
  summary: 'Recomputed net matches the bank credit within policy tolerance. No exception.',
  suggested_owner: 'none',
  next_action: 'No action required.',
}

const SYSTEM = [
  'You write one-line exception notes for a payments finance operations team.',
  'You are given a verification result that has ALREADY been decided by a',
  'deterministic verifier. Your job is to explain it, not to re-decide it.',
  '',
  'Hard rules:',
  '- Never state or imply a verdict other than the one given.',
  '- Never introduce a number that is not in the input.',
  '- Be specific and short. No hedging, no restating the reason code verbatim.',
].join('\n')

export async function narrateException(
  result: VerificationResult,
): Promise<ExceptionNarration> {
  if (!result.reason_code) return CLEAN_NARRATION

  const route = ROUTING[result.reason_code]
  const failing = result.checks.filter((c) => c.status === 'fail')

  const prompt = [
    `verdict: ${result.verdict}`,
    `reason_code: ${result.reason_code}`,
    `settlement_id: ${result.settlement_id}`,
    `policy: ${result.policy_version} (fee tolerance ${result.tolerance_paise} paise)`,
    result.expected_paise !== null ? `expected_paise: ${result.expected_paise}` : '',
    result.observed_paise !== null ? `observed_paise: ${result.observed_paise}` : '',
    result.difference_paise !== null ? `difference_paise: ${result.difference_paise}` : '',
    result.fee_delta_paise !== null ? `fee_delta_paise: ${result.fee_delta_paise}` : '',
    '',
    'failing checks:',
    ...failing.map((c) => `  - ${c.id}: ${c.detail}`),
  ]
    .filter(Boolean)
    .join('\n')

  const { value } = await generateStructured({
    system: SYSTEM,
    prompt,
    schema: NarrationSchema,
    mock: () => ({
      summary: route.blurb,
      suggested_owner: route.suggested_owner,
      next_action: route.next_action,
    }),
  })

  return value
}
