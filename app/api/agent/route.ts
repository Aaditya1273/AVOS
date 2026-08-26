/**
 * POST /api/agent — run the reconciliation agent live, then verify it.
 *
 * This route is the architecture in miniature, in the order the data actually
 * moves:
 *
 *   1. Build the evidence pack.
 *   2. Ask the agent for a proposal. It comes back as a `StructuredClaim` plus
 *      a prose rationale.
 *   3. Split them. `claim` goes to the verifier; `agent_reason` goes to the
 *      response for display and nowhere else.
 *   4. Verify. The result is a function of evidence and policy only.
 *
 * Step 3 is one line of code and it is the product. Note that the split is not
 * enforced here by care — `verify()` takes a `VerifierInput`, and that type has
 * no field the rationale could occupy. This route could not leak the prose into
 * the verdict if it tried.
 *
 * Runs on the Vercel AI SDK with structured output when a key is configured, and
 * on the deterministic offline mock when one is not. The verdict is identical
 * either way, which is the intended demonstration rather than a caveat.
 */

import { NextResponse } from 'next/server'
import { buildEvidencePack } from '@/lib/evidence/pack'
import { verify } from '@/lib/verifier/deterministic'
import { proposeClaim } from '@/lib/ai/agent'
import { narrateException } from '@/lib/ai/classify'
import { MODEL_VERSION, USING_MOCK } from '@/lib/ai/provider'
import { findCase } from '@/lib/decisions'
import { loadDecisionLog } from '@/lib/decisions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { case_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 })
  }

  const caseId = body.case_id
  if (!caseId) {
    return NextResponse.json({ error: 'case_id is required' }, { status: 400 })
  }

  const found = findCase(caseId)
  if (!found) {
    return NextResponse.json({ error: `unknown case_id '${caseId}'` }, { status: 404 })
  }

  const log = loadDecisionLog()
  const pack = buildEvidencePack(found.c, {
    recordedHashes: log?.entries[caseId]?.evidence_hashes,
    modelVersion: MODEL_VERSION,
  })

  // The agent proposes.
  const proposal = await proposeClaim(pack)

  // Deterministic code disposes. `proposal.agent_reason` is not in scope here —
  // only `proposal.claim` crosses the boundary.
  const result = verify({
    claim: proposal.claim,
    pack,
    as_of: pack.decision_time,
  })

  // AI is allowed back in only after the verdict exists, to describe it.
  const narration = await narrateException(result)

  return NextResponse.json({
    case_id: caseId,
    suite: found.suite,
    using_mock: USING_MOCK,
    model_version: MODEL_VERSION,
    /** What crossed into the verifier. */
    structured_claim: proposal.claim,
    /** What did not. Returned for display, clearly labelled. */
    quarantined: {
      agent_reason: proposal.agent_reason,
      note: 'Captured for audit and shown to the reviewer. Never an input to the verdict.',
    },
    verdict: result,
    narration,
    pack_hash: pack.pack_hash,
    evidence_count: pack.evidence.length,
  })
}
