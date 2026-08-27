/**
 * The hard slice — the only benchmark here that can actually fail.
 *
 * The 120-case batch has a structural weakness that no amount of polish fixes:
 * every scenario in it maps 1:1 onto exactly one detector, and the script that
 * injects each fault also authored the label. A benchmark where the label is a
 * lookup keyed on the injected fault can only ever score 100%. That number
 * measures construction, not capability, and reporting it alone is the kind of
 * overstatement a verification product cannot afford.
 *
 * These twenty are different in one specific way: **the expected verdicts were
 * reasoned by hand, per case, before the cases were run, from what a competent
 * finance reviewer would conclude** — not read off the verifier's output. They
 * live in `data/ground_truth_hard.json`, separate from `ground_truth.json`, so
 * the distinction stays visible.
 *
 * Five families, four cases each, each targeting a place where a plausible
 * implementation gets it wrong:
 *
 *   boundary  — is the tolerance inclusive? both signs?
 *   compound  — two faults, one settlement: which reason code owns it?
 *   epoch     — payments captured across a rate-card change
 *   stale     — freshness limit, including the boundary itself
 *   negative  — refunds and holds driving expected to or below zero
 *
 * The target is NOT 100%. A hard slice that scores 100% on its first run was not
 * hard, and the correct response is to make it harder rather than to celebrate.
 * Whatever this reports is published as-is.
 */

import { materializeSuite } from '@/lib/decisions'
import { loadGroundTruth } from '@/lib/data/ledger'
import type { Decision, Verdict } from '@/lib/types'

export interface HardCaseResult {
  case_id: string
  settlement_id: string
  family: string
  note: string
  expected: string
  got: string
  correct: boolean
  /** Right verdict but wrong reason code — routed to the wrong owner. */
  verdict_only: boolean
  difference_paise: number | null
  tolerance_paise: number | null
}

export interface HardSliceMetrics {
  n: number
  verdict_accuracy_hard_slice: number
  reason_accuracy_hard_slice: number
  by_family: Record<string, { n: number; correct: number }>
  by_verdict: Record<Verdict, number>
  failures: HardCaseResult[]
  results: HardCaseResult[]
  elapsed_ms: number
}

export function runHardSlice(): HardSliceMetrics {
  const started = performance.now()
  const decisions: Decision[] = materializeSuite('hard_slice_20')
  const elapsed = performance.now() - started
  const truth = loadGroundTruth('hard_slice_20')

  const results: HardCaseResult[] = []
  const by_family: HardSliceMetrics['by_family'] = {}
  const by_verdict: Record<Verdict, number> = { VERIFIED: 0, UNCERTAIN: 0, FAILED: 0 }

  let verdictCorrect = 0
  let reasonCorrect = 0

  for (const d of decisions) {
    const gt = truth.get(d.case_id)
    if (!gt) continue

    const family = gt.scenario || 'unknown'
    const expected = `${gt.expected_verdict}${gt.expected_reason ? `/${gt.expected_reason}` : ''}`
    const got = `${d.result.verdict}${d.result.reason_code ? `/${d.result.reason_code}` : ''}`

    const verdictOk = d.result.verdict === gt.expected_verdict
    const reasonOk = verdictOk && (d.result.reason_code ?? '') === gt.expected_reason

    if (verdictOk) verdictCorrect += 1
    if (reasonOk) reasonCorrect += 1
    by_verdict[d.result.verdict] += 1

    const slot = by_family[family] ?? { n: 0, correct: 0 }
    slot.n += 1
    if (reasonOk) slot.correct += 1
    by_family[family] = slot

    results.push({
      case_id: d.case_id,
      settlement_id: d.result.settlement_id,
      family,
      // `note` rides on the ground-truth file; loadGroundTruth flattens it into
      // `scenario`, so re-read it here for the report.
      note: (truth.get(d.case_id) as unknown as { note?: string })?.note ?? '',
      expected,
      got,
      correct: reasonOk,
      verdict_only: verdictOk && !reasonOk,
      difference_paise: d.result.difference_paise,
      tolerance_paise: d.result.tolerance_paise,
    })
  }

  const n = results.length
  return {
    n,
    verdict_accuracy_hard_slice: n === 0 ? 0 : verdictCorrect / n,
    reason_accuracy_hard_slice: n === 0 ? 0 : reasonCorrect / n,
    by_family,
    by_verdict,
    failures: results.filter((r) => !r.correct),
    results,
    elapsed_ms: Math.round(elapsed),
  }
}

// --- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].includes('hard_slice')
if (isMain) {
  const m = runHardSlice()
  const W = 92
  console.log('\nHARD SLICE — 20 cases the verifier can plausibly get wrong')
  console.log('='.repeat(W))
  let family = ''
  for (const r of m.results) {
    if (r.family !== family) {
      family = r.family
      console.log(`\n  ${family.toUpperCase()}`)
    }
    const mark = r.correct ? 'PASS' : r.verdict_only ? 'CODE' : 'FAIL'
    console.log(`  ${mark}  ${r.case_id}  ${r.note}`)
    if (!r.correct) console.log(`         expected ${r.expected}   got ${r.got}`)
  }
  console.log('\n' + '='.repeat(W))
  console.log(`  verdict accuracy      ${(m.verdict_accuracy_hard_slice * 100).toFixed(1)}%`)
  console.log(`  verdict+reason        ${(m.reason_accuracy_hard_slice * 100).toFixed(1)}%`)
  for (const [f, s] of Object.entries(m.by_family)) {
    console.log(`    ${f.padEnd(12)} ${s.correct}/${s.n}`)
  }
  console.log('='.repeat(W))
  console.log(
    m.failures.length === 0
      ? '\n  20/20. This slice was not hard enough — add harder cases.\n'
      : `\n  ${m.failures.length} case(s) disagree. That is the signal; publish it.\n`,
  )
  // Deliberately exits 0 regardless. This measures capability; it is not a gate
  // to be tuned green, and wiring it as one would recreate the problem it exists
  // to expose.
  process.exit(0)
}
