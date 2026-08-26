/**
 * POST /api/replay — re-evaluate a recorded decision.
 *
 * Two independent questions, one endpoint:
 *
 *   `as_of`  — evaluate under the policy in force at a different instant.
 *              Same evidence, same arithmetic, possibly a different verdict,
 *              because the rules changed and that is written down and dated.
 *
 *   `tamper` — perturb one evidence row in memory before hashing, to show that
 *              a mutated source is caught rather than quietly re-verified.
 *              Nothing is written to disk; the CSVs are untouched.
 */

import { NextResponse } from 'next/server'
import { findCase } from '@/lib/decisions'
import { replayDecision, policyChangePoints } from '@/lib/replay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { case_id?: string; as_of?: string; tamper?: boolean | string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 })
  }

  if (!body.case_id) {
    return NextResponse.json({ error: 'case_id is required' }, { status: 400 })
  }

  if (body.as_of && !Number.isFinite(Date.parse(body.as_of))) {
    return NextResponse.json(
      { error: `as_of must be an ISO-8601 instant, got '${body.as_of}'` },
      { status: 400 },
    )
  }

  const found = findCase(body.case_id)
  if (!found) {
    return NextResponse.json({ error: `unknown case_id '${body.case_id}'` }, { status: 404 })
  }

  const replay = replayDecision(found.c, found.suite, {
    asOf: body.as_of,
    tamper: body.tamper,
  })

  return NextResponse.json({ replay, policy_points: policyChangePoints() })
}
