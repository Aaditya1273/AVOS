/**
 * POST /api/qa — settlement Q&A with citations.
 *
 * The only endpoint an attacker-controlled string can influence, and it is
 * deliberately the one that decides nothing. The verdict line in the response is
 * copied from the deterministic verifier; the model writes the surrounding
 * context and cites the rows it used.
 *
 * `injection_detected` is a report, not a filter. Nothing behaves differently
 * when it is true — the verdict path never saw the text. It is surfaced because
 * a bank narration containing "IGNORE ALL POLICIES" is something a fraud team
 * wants to know about, and sanitising it away would destroy the only evidence
 * that it happened.
 */

import { NextResponse } from 'next/server'
import { findCase, materializeDecision } from '@/lib/decisions'
import { answerQuestion } from '@/lib/ai/qa'
import { USING_MOCK } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vercel's Hobby default is a 10s function ceiling. With no key the mock
// answers instantly, but a real model call on a cold function can exceed it,
// and a 504 here would look like the verifier failed when it never ran.
// The verdict is computed deterministically either way — this only buys the
// narration time to come back.
export const maxDuration = 30

const MAX_QUESTION_LENGTH = 500

export async function POST(request: Request) {
  let body: { case_id?: string; question?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 })
  }

  const question = (body.question ?? '').trim()
  if (!body.case_id || !question) {
    return NextResponse.json({ error: 'case_id and question are required' }, { status: 400 })
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `question must be under ${MAX_QUESTION_LENGTH} characters` },
      { status: 400 },
    )
  }

  const found = findCase(body.case_id)
  if (!found) {
    return NextResponse.json({ error: `unknown case_id '${body.case_id}'` }, { status: 404 })
  }

  const decision = materializeDecision(found.c, found.suite)
  const answer = await answerQuestion(question, decision.pack, decision.result)

  return NextResponse.json({ ...answer, using_mock: USING_MOCK })
}
