/**
 * The "Measure" pillar.
 *
 * Shared by the eval harness and the dashboard so a number can never mean one
 * thing in the README and another on screen.
 *
 * ---------------------------------------------------------------------------
 * On value coverage, and why there are two of them
 *
 * The brief defines coverage as `correctly verified value / total batch value`
 * and sets a target above 95%. On this fixture those two things cannot both be
 * true, and pretending otherwise would be the exact kind of hype the brief
 * itself rules out — so both numbers are reported, named for what they measure:
 *
 *   value_coverage_of_verifiable — correctly verified value / value that SHOULD
 *       verify. "Of the money that genuinely reconciled, how much did we clear?"
 *       This is the number the >95% gate applies to, and it is the honest test
 *       of the verifier: anything below 100% means we abstained on good money.
 *
 *   auto_clear_rate — correctly verified value / total batch value. "What share
 *       of the batch closed without a human?" On a fixture that is one-third
 *       deliberately broken this lands near 67%, and that is the correct answer,
 *       not a bad one. A batch containing 40 real exceptions SHOULD route 40
 *       cases to a human. A system reporting 95%+ against this denominator would
 *       be closing things it cannot prove.
 *
 * The denominator is the whole argument. Publishing one number without saying
 * which denominator it used is how verification products get sold and then fail
 * their first audit.
 * ---------------------------------------------------------------------------
 */

import type { Decision, GroundTruth, Paise, Verdict } from '@/lib/types'

export interface SuiteMetrics {
  suite: string
  n: number

  by_verdict: Record<Verdict, number>
  verdict_accuracy: number

  /** Of everything AVOS marked VERIFIED, how much was actually verifiable. */
  verification_precision: number
  /** VERIFIED on a case that was not. The number that must be zero. */
  false_closure_rate: number
  false_closure_cases: string[]

  /** Of the money that genuinely reconciled, how much we cleared. Gated at >95%. */
  value_coverage_of_verifiable: number
  /** Of the whole batch, how much closed without a human. Reported, not gated. */
  auto_clear_rate: number
  total_value_paise: Paise
  verifiable_value_paise: Paise
  verified_value_paise: Paise

  /** Injected exceptions that AVOS refused to close. */
  exception_detection_rate: number
  exceptions_injected: number
  exceptions_caught: number
  missed_exceptions: string[]

  /** When the truth is "you cannot know", did AVOS say UNCERTAIN. */
  abstention_accuracy: number
  abstention_n: number

  /** Right verdict AND right reason code. Routing depends on this, not just the verdict. */
  reason_code_accuracy: number
  reason_code_n: number

  /** Deterministic verification only. Model latency is reported separately. */
  throughput_records_per_sec: number
  verify_elapsed_ms: number

  /** truth -> predicted, for every disagreement. */
  confusion: Record<string, number>
  mismatches: {
    case_id: string
    settlement_id: string
    scenario: string
    expected: string
    got: string
  }[]
}

const ZERO_BY_VERDICT = (): Record<Verdict, number> => ({
  VERIFIED: 0,
  UNCERTAIN: 0,
  FAILED: 0,
})

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator
}

export function computeMetrics(
  suite: string,
  decisions: Decision[],
  truth: Map<string, GroundTruth>,
  verifyElapsedMs: number,
): SuiteMetrics {
  const by_verdict = ZERO_BY_VERDICT()
  const confusion: Record<string, number> = {}
  const mismatches: SuiteMetrics['mismatches'] = []
  const false_closure_cases: string[] = []
  const missed_exceptions: string[] = []

  let verdictCorrect = 0
  let verifiedPredicted = 0
  let verifiedCorrect = 0
  let totalValue = 0
  let verifiableValue = 0
  let verifiedValue = 0
  let exceptionsInjected = 0
  let exceptionsCaught = 0
  let abstentionN = 0
  let abstentionCorrect = 0
  let reasonN = 0
  let reasonCorrect = 0

  for (const d of decisions) {
    const gt = truth.get(d.case_id)
    if (!gt) continue

    const got = d.result.verdict
    const want = gt.expected_verdict
    by_verdict[got] += 1
    totalValue += d.batch_value_paise

    if (got === want) {
      verdictCorrect += 1
    } else {
      const key = `${want} -> ${got}`
      confusion[key] = (confusion[key] ?? 0) + 1
      mismatches.push({
        case_id: d.case_id,
        settlement_id: d.result.settlement_id,
        scenario: gt.scenario,
        expected: `${want}${gt.expected_reason ? ` / ${gt.expected_reason}` : ''}`,
        got: `${got}${d.result.reason_code ? ` / ${d.result.reason_code}` : ''}`,
      })
    }

    if (got === 'VERIFIED') {
      verifiedPredicted += 1
      if (want === 'VERIFIED') {
        verifiedCorrect += 1
        verifiedValue += d.batch_value_paise
      } else {
        // A close that should not have happened. This is the only failure mode
        // that moves money incorrectly; everything else costs a human review.
        false_closure_cases.push(`${d.case_id}/${d.result.settlement_id} (${gt.scenario})`)
      }
    }

    if (want === 'VERIFIED') {
      verifiableValue += d.batch_value_paise
    } else {
      exceptionsInjected += 1
      if (got !== 'VERIFIED') exceptionsCaught += 1
      else missed_exceptions.push(`${d.case_id}/${gt.scenario}`)
    }

    if (want === 'UNCERTAIN') {
      abstentionN += 1
      if (got === 'UNCERTAIN') abstentionCorrect += 1
    }

    if (gt.expected_reason) {
      reasonN += 1
      if (got === want && d.result.reason_code === gt.expected_reason) reasonCorrect += 1
    }
  }

  const n = decisions.length

  return {
    suite,
    n,
    by_verdict,
    verdict_accuracy: ratio(verdictCorrect, n),
    verification_precision: ratio(verifiedCorrect, verifiedPredicted),
    false_closure_rate: n === 0 ? 0 : false_closure_cases.length / n,
    false_closure_cases,
    value_coverage_of_verifiable: ratio(verifiedValue, verifiableValue),
    auto_clear_rate: totalValue === 0 ? 0 : verifiedValue / totalValue,
    total_value_paise: totalValue,
    verifiable_value_paise: verifiableValue,
    verified_value_paise: verifiedValue,
    exception_detection_rate: ratio(exceptionsCaught, exceptionsInjected),
    exceptions_injected: exceptionsInjected,
    exceptions_caught: exceptionsCaught,
    missed_exceptions,
    abstention_accuracy: ratio(abstentionCorrect, abstentionN),
    abstention_n: abstentionN,
    reason_code_accuracy: ratio(reasonCorrect, reasonN),
    reason_code_n: reasonN,
    throughput_records_per_sec:
      verifyElapsedMs > 0 ? Math.round((n / verifyElapsedMs) * 1000) : 0,
    verify_elapsed_ms: Math.round(verifyElapsedMs),
    confusion,
    mismatches,
  }
}

/** Verdict tallies for the dashboard, where there is no ground truth to compare to. */
export function tallyVerdicts(decisions: Decision[]): Record<Verdict, number> {
  const out = ZERO_BY_VERDICT()
  for (const d of decisions) out[d.result.verdict] += 1
  return out
}

export function tallyReasons(decisions: Decision[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of decisions) {
    if (!d.result.reason_code) continue
    out[d.result.reason_code] = (out[d.result.reason_code] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

export function sumValue(decisions: Decision[], predicate: (d: Decision) => boolean): Paise {
  let total = 0
  for (const d of decisions) if (predicate(d)) total += d.batch_value_paise
  return total
}
