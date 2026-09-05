/**
 * The sync endpoint. Browser → here → Razorpay → normalise → ledger → agent →
 * verifier → closure → back to the browser.
 *
 * Read-only in both directions: it makes only GET requests to Razorpay and it
 * writes nothing anywhere. It is exposed as both GET and POST — POST is what
 * the Sync button sends, GET is so a reviewer can `curl` it — and the two run
 * the same code.
 *
 * Nothing in the response can carry a credential. The connector never puts a
 * header in the activity log, the secret is read only inside the connector,
 * and the client component that renders this response has no `process.env` in
 * it at all. `evals/razorpay-runtime.test.ts` checks the built client bundle
 * for the variable names and the API host.
 */

import { NextResponse } from 'next/server'
import { syncRazorpay } from '@/lib/razorpay/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Up to four Razorpay round-trips plus one model call per settlement. Hobby's
// 10s default would 504 on the first settlement with a real model attached.
export const maxDuration = 60

async function handle(): Promise<Response> {
  try {
    const payload = await syncRazorpay()
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    // A thrown error here is a bug in AVOS, not a Razorpay state — those are
    // all returned as a payload with a connection state. Say so, without the
    // stack, and without pretending the sync produced anything.
    return NextResponse.json(
      { error: 'sync failed inside AVOS', detail: (e as Error).message },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}

export async function GET(): Promise<Response> {
  return handle()
}

export async function POST(): Promise<Response> {
  return handle()
}
