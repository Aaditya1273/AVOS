/**
 * The AVOS console.
 *
 * A server component that gathers what the shell needs and hands it over as
 * plain data. Two sources feed the shell and are never mixed:
 *
 *  - Razorpay, read live by the client through `/api/razorpay/sync` — the
 *    product path. Nothing on this page is pre-rendered as Razorpay data.
 *  - The evaluation dataset: 150 committed, seeded, labelled synthetic
 *    settlements, rebuilt from the CSV ledger and re-verified on every request
 *    here, then mapped into the operator's vocabulary by `fromDecision`. They
 *    are labelled as evaluation data wherever they appear.
 *
 * Accuracy figures come from `evals/raw/metrics.json`, written by
 * `npm run eval`; they are never recomputed here, because that needs labels
 * and labels must not be loadable from the code that serves verdicts.
 */

import { ConsoleShell } from '@/components/console/shell'
import { fromDecision } from '@/components/console/model'
import { materializeSuite, findCaseBySettlement } from '@/lib/decisions'
import { policyChangePoints } from '@/lib/replay'
import { POLICY_SNAPSHOTS } from '@/lib/policy/snapshots'
import { loadManifest } from '@/lib/data/ledger'
import { loadEvalReport } from '@/lib/eval-report'
import { VERIFIER_VERSION } from '@/lib/verifier/deterministic'

export const dynamic = 'force-dynamic'

const HERO_SETTLEMENT = 'S-10092'

export default function ConsolePage() {
  const evaluation = [...materializeSuite('batch_120'), ...materializeSuite('adversarial_30')].map(fromDecision)
  const manifest = loadManifest()
  const report = loadEvalReport()
  const hero = findCaseBySettlement(HERO_SETTLEMENT)

  return (
    <ConsoleShell
      evaluation={evaluation}
      policies={POLICY_SNAPSHOTS}
      policyPoints={policyChangePoints()}
      report={report}
      verifierVersion={VERIFIER_VERSION}
      manifest={{
        seed: manifest.seed,
        payments: manifest.evidence_rows.razorpay_payments,
        settlements: manifest.evidence_rows.razorpay_settlements,
        bank: manifest.evidence_rows.bank_statement,
      }}
      initialSelected={hero?.c.case_id ?? null}
    />
  )
}
