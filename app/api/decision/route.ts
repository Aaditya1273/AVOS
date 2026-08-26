/**
 * GET /api/decision?case_id=B092 — the full Proof Card payload.
 *
 * Rebuilt from the CSV ledger on every request rather than served from the
 * decision log. That costs a couple of milliseconds and buys the thing the
 * product is selling: what you see on screen was recomputed from source just
 * now, and if the source had drifted, the reproducibility check would say so.
 *
 * A cached verdict would look identical and mean nothing.
 */

import { NextResponse } from 'next/server'
import { findCase, materializeDecision } from '@/lib/decisions'
import { narrateException } from '@/lib/ai/classify'
import { detectInjection } from '@/lib/ai/qa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get('case_id')
  if (!caseId) {
    return NextResponse.json({ error: 'case_id is required' }, { status: 400 })
  }

  const found = findCase(caseId)
  if (!found) {
    return NextResponse.json({ error: `unknown case_id '${caseId}'` }, { status: 404 })
  }

  const decision = materializeDecision(found.c, found.suite)
  const narration = await narrateException(decision.result)
  const injection = detectInjection(decision.pack)

  return NextResponse.json({ decision, narration, injection })
}
