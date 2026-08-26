/**
 * Reads the committed output of the last `npm run eval`.
 *
 * The dashboard displays measured results; it does not recompute them at render
 * time. That is not a shortcut — recomputing accuracy in the serving path would
 * mean loading ground-truth labels into the same process that produces verdicts,
 * and `evals/isolation.ts` fails the build if that ever happens.
 *
 * So the flow is one-directional and auditable: the harness measures, writes
 * `evals/raw/metrics.json`, and the UI reports what the harness found. If the
 * file is missing, the UI says the evaluation has not been run rather than
 * quietly showing zeroes that look like results.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SuiteMetrics } from '@/lib/metrics'

export interface AdversarialTestRecord {
  id: string
  name: string
  group: 'attack_suite' | 'verifier_unit'
  passed: boolean
  detail: string
}

export interface IsolationRecord {
  id: string
  passed: boolean
  detail: string
}

export interface GateRecord {
  name: string
  passed: boolean
  detail: string
}

export interface EvalReport {
  generated_at: string
  verifier_version: string
  model_version: string
  using_mock: boolean
  batch_120: SuiteMetrics
  adversarial_30: SuiteMetrics
  adversarial_tests: AdversarialTestRecord[]
  isolation: IsolationRecord[]
  gates: GateRecord[]
}

const METRICS_PATH = path.join(process.cwd(), 'evals', 'raw', 'metrics.json')

export function loadEvalReport(): EvalReport | null {
  if (!existsSync(METRICS_PATH)) return null
  try {
    return JSON.parse(readFileSync(METRICS_PATH, 'utf8')) as EvalReport
  } catch {
    return null
  }
}
