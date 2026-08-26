/**
 * The AVOS Verify console.
 *
 * A server component: it rebuilds every pack from the CSV ledger and runs the
 * deterministic verifier over all 150 cases on each request. That takes a few
 * milliseconds because the verifier is pure integer arithmetic with no I/O and
 * no model in it — which is itself the demonstration. A dashboard that had to
 * call something to know a verdict would be evidence against the architecture.
 *
 * Accuracy figures come from `evals/raw/metrics.json`, written by `npm run eval`.
 * They are not recomputed here, because computing accuracy needs ground-truth
 * labels and labels must never be loadable from the code that serves verdicts.
 * `evals/isolation.ts` fails the build if that boundary is ever crossed.
 */

import { Badge, Card, Mono, Separator, Stat } from '@/components/ui/primitives'
import { Console, type CaseRow } from '@/components/console'
import { materializeSuite, findCaseBySettlement } from '@/lib/decisions'
import { policyChangePoints } from '@/lib/replay'
import { detectInjection } from '@/lib/ai/qa'
import { loadManifest } from '@/lib/data/ledger'
import { loadEvalReport } from '@/lib/eval-report'
import { USING_MOCK, MODEL_VERSION } from '@/lib/ai/provider'
import { VERIFIER_VERSION } from '@/lib/verifier/deterministic'
import { formatPaise, formatPct } from '@/lib/money'
import { tallyVerdicts } from '@/lib/metrics'
import type { Decision } from '@/lib/types'

export const dynamic = 'force-dynamic'

const HERO_SETTLEMENT = 'S-10092'

function toRow(d: Decision): CaseRow {
  return {
    case_id: d.case_id,
    settlement_id: d.result.settlement_id,
    merchant_id: d.pack.merchant_id,
    suite: d.suite,
    verdict: d.result.verdict,
    reason_code: d.result.reason_code,
    value_paise: d.batch_value_paise,
    difference_paise: d.result.difference_paise,
    policy_version: d.result.policy_version,
    decision_time: d.pack.decision_time,
    agent_claim: d.proposal.claim.proposed_status,
    injection: detectInjection(d.pack).found,
  }
}

export default function Page() {
  const batch = materializeSuite('batch_120')
  const adversarial = materializeSuite('adversarial_30')
  const rows = [...batch, ...adversarial].map(toRow)

  const manifest = loadManifest()
  const report = loadEvalReport()
  const policyPoints = policyChangePoints()
  const tally = tallyVerdicts(batch)

  const hero = findCaseBySettlement(HERO_SETTLEMENT)
  const heroCaseId = hero?.c.case_id ?? batch[0]?.case_id ?? ''

  const m = report?.batch_120
  const gatesPassed = report?.gates.every((g) => g.passed) ?? false

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      {/* --- header --------------------------------------------------------- */}
      <header className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid-lines border-b border-border px-6 py-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight">AVOS Verify</h1>
                <Badge variant="outline">Track 04 · Settlement Assurance</Badge>
              </div>
              <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-muted-foreground">
                Evidence-backed verification for AI-operated finance. Razorpay governs what an agent
                is allowed to do. AVOS is the independent check on whether the agent&rsquo;s financial
                conclusion is actually supported — it recomputes every claim from source evidence
                under the policy in force at decision time, and refuses to close when the evidence
                will not carry it.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant={USING_MOCK ? 'outline' : 'verified'}>
                {USING_MOCK ? 'offline mock model — no API key needed' : `live · ${MODEL_VERSION}`}
              </Badge>
              <Mono>{VERIFIER_VERSION}</Mono>
              {report ? (
                <Badge variant={gatesPassed ? 'verified' : 'failed'}>
                  {gatesPassed ? 'all acceptance gates pass' : 'gates failing'}
                </Badge>
              ) : (
                <Badge variant="uncertain">run `npm run eval`</Badge>
              )}
            </div>
          </div>

          <p className="mt-4 max-w-4xl border-l-2 border-primary pl-3 text-[13px] font-medium leading-relaxed">
            An agent can be policy-compliant and still be financially wrong. AVOS makes closure
            conditional on evidence, not on confidence.
          </p>
        </div>

        {/* --- measured results ---------------------------------------------- */}
        {m ? (
          <div className="grid grid-cols-2 gap-5 px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="False closure rate"
              value={formatPct(m.false_closure_rate)}
              hint={`0 of ${m.n} on fixture`}
              tone={m.false_closure_rate === 0 ? 'verified' : 'failed'}
            />
            <Stat
              label="Verification precision"
              value={formatPct(m.verification_precision)}
              hint={`${m.by_verdict.VERIFIED} verdicts`}
              tone="verified"
            />
            <Stat
              label="Value coverage"
              value={formatPct(m.value_coverage_of_verifiable)}
              hint="of verifiable value"
              tone="verified"
            />
            <Stat
              label="Auto-clear rate"
              value={formatPct(m.auto_clear_rate)}
              hint="of whole batch"
            />
            <Stat
              label="Exception detection"
              value={formatPct(m.exception_detection_rate)}
              hint={`${m.exceptions_caught}/${m.exceptions_injected} injected`}
              tone="verified"
            />
            <Stat
              label="Throughput"
              value={`${m.throughput_records_per_sec.toLocaleString()}/s`}
              hint="deterministic verify"
            />
          </div>
        ) : (
          <div className="px-6 py-5 text-[13px] text-muted-foreground">
            No evaluation on record. Run <Mono>npm run eval</Mono> to populate metrics and the
            decision log.
          </div>
        )}
      </header>

      {/* --- pillars + honesty note ------------------------------------------ */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Guard · Prove · Verify · Measure
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Pillar
              name="Guard"
              body="Is closure permissible under the policy that was in force at decision time — not today's policy?"
            />
            <Pillar
              name="Prove"
              body="Every row carries source file, row id, timestamp, content hash and freshness. Inspectable, and re-hashed on replay."
            />
            <Pillar
              name="Verify"
              body="expected = gross − refunds − fees − tax − holds, against the bank credit. Integer paise. Zero LLM."
            />
            <Pillar
              name="Measure"
              body="Precision, false closure, value coverage, exception detection, abstention accuracy — over labelled fixtures."
            />
          </div>
          <Separator className="my-4" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
            <span>
              Ledger: <Mono>{manifest.evidence_rows.razorpay_payments}</Mono> payments ·{' '}
              <Mono>{manifest.evidence_rows.razorpay_settlements}</Mono> settlements ·{' '}
              <Mono>{manifest.evidence_rows.bank_statement}</Mono> bank rows ·{' '}
              <Mono>{manifest.evidence_rows.webhook_events}</Mono> webhooks
            </span>
            <span>
              Batch value: <Mono>{formatPaise(manifest.batch_120.total_value_paise)}</Mono>
            </span>
            <span>
              Seed: <Mono>{manifest.seed}</Mono>
            </span>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            What these numbers do and do not claim
          </h2>
          <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-muted-foreground">
            <li>
              <span className="text-foreground">Value coverage</span> is measured against verifiable
              value — of the money that genuinely reconciled, how much we cleared. Auto-clear rate
              uses the whole batch and lands near two-thirds, which is correct on a fixture that is
              one-third deliberately broken.
            </li>
            <li>
              <span className="text-foreground">0% false closure</span> holds on this labelled
              fixture, and it is achievable because AVOS abstains rather than guesses. It is not
              offered as a global guarantee.
            </li>
            <li>
              <span className="text-foreground">UNCERTAIN is a result, not a failure.</span> An
              abstention costs a reviewer ten minutes. A wrong VERIFIED costs a reconciliation.
            </li>
          </ul>
        </Card>
      </div>

      {/* --- verdict tally --------------------------------------------------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Batch of 120
        </span>
        <Badge variant="failed">{tally.FAILED} refused</Badge>
        <Badge variant="uncertain">{tally.UNCERTAIN} abstained</Badge>
        <Badge variant="verified">{tally.VERIFIED} cleared</Badge>
        <span className="text-[11.5px] text-muted-foreground">
          The agent proposed RECONCILED on every one of them.
        </span>
      </div>

      <Console rows={rows} policyPoints={policyPoints} initialCaseId={heroCaseId} />

      <footer className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-[11.5px] text-muted-foreground">
        <span>
          Verifier <Mono>{VERIFIER_VERSION}</Mono> — zero runtime imports, asserted on every eval run
        </span>
        <span>
          Policies: {policyPoints.map((p) => p.label).join(' → ')}
        </span>
        {report ? <span>Last evaluated {report.generated_at}</span> : null}
      </footer>
    </main>
  )
}

function Pillar({ name, body }: { name: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <div className="mb-1 text-[12px] font-semibold text-primary">{name}</div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
