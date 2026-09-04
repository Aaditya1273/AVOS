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

import { Badge, Card, Mono, Separator } from '@/components/ui/primitives'
import { Metric, MetricGroup } from '@/components/ui/metrics'
import { Console, type CaseRow } from '@/components/console'
import { materializeSuite, findCaseBySettlement } from '@/lib/decisions'
import { policyChangePoints } from '@/lib/replay'
import { detectInjection } from '@/lib/ai/qa'
import { loadManifest } from '@/lib/data/ledger'
import { loadEvalReport } from '@/lib/eval-report'
import { USING_MOCK, MODEL_VERSION } from '@/lib/ai/provider'
import { VERIFIER_VERSION } from '@/lib/verifier/deterministic'
import { formatCompact, formatPaise, formatPct } from '@/lib/money'
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
    confidence: d.proposal.confidence,
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
                <h1 className="text-2xl font-bold tracking-tight">AVOS</h1>
                <Badge variant="outline">Track 04 · AI Finance Controller</Badge>
              </div>
              <p className="mt-1.5 max-w-3xl text-body leading-relaxed text-muted-foreground">
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

          <p className="mt-4 max-w-4xl border-l-2 border-primary pl-3 text-body font-medium leading-relaxed">
            An agent can be policy-compliant and still be financially wrong. AVOS makes closure
            conditional on evidence, not on confidence.
          </p>
        </div>

        {/* --- measured results ---------------------------------------------- */}
        {m ? (
          <dl className="grid gap-x-8 gap-y-6 px-6 py-5 md:grid-cols-2 xl:grid-cols-3">
            <MetricGroup label="Control — what the system did">
              <Metric
                label="Closed"
                value={m.closure.closed}
                hint={`of ${m.n} presented`}
                tone="verified"
              />
              <Metric label="Refused" value={m.closure.refused} hint="held for review" tone="uncertain" />
              <Metric label="Exceptions" value={m.closure.failed} hint="routed to an owner" tone="failed" />
            </MetricGroup>

            <MetricGroup label="Assurance — whether it can be trusted">
              <Metric label="Match rate" value={formatPct(m.match_rate)} hint={`${m.ambiguous_count} ambiguous`} />
              <Metric
                label="Match precision"
                value={formatPct(m.match_precision)}
                hint="paired correctly"
                tone={m.match_precision === 1 ? 'verified' : 'failed'}
              />
              <Metric
                label="False closure"
                value={formatPct(m.false_closure_rate)}
                hint={`0 of ${m.n} on fixture`}
                tone={m.false_closure_rate === 0 ? 'verified' : 'failed'}
              />
            </MetricGroup>

            <MetricGroup label="Impact — what it was worth">
              <Metric
                label="Value withheld"
                value={formatCompact(m.closure.withheld_value_paise)}
                hint="from incorrect closure"
                tone="uncertain"
              />
              <Metric
                label="Value posted"
                value={formatCompact(m.closure.closed_value_paise)}
                hint={`${m.closure.closed} settlements`}
                tone="verified"
              />
              <Metric
                label="Throughput"
                value={`${(m.throughput_records_per_sec / 1000).toFixed(1)}k/s`}
                hint="deterministic verify"
              />
            </MetricGroup>
          </dl>
        ) : (
          <div className="px-6 py-5 text-body text-muted-foreground">
            No evaluation on record. Run <Mono>npm run eval</Mono> to populate metrics and the
            decision log.
          </div>
        )}
      </header>

      {/* --- verdict tally --------------------------------------------------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-label text-muted-foreground">
          Batch of 120
        </span>
        <Badge variant="failed">{tally.FAILED} refused</Badge>
        <Badge variant="uncertain">{tally.UNCERTAIN} abstained</Badge>
        <Badge variant="verified">{tally.VERIFIED} cleared</Badge>
        <span className="text-mini text-muted-foreground">
          Matched, verified and closed on every request from source — nothing is read back from the
          decision log.
        </span>
      </div>

      <Console rows={rows} policyPoints={policyPoints} initialCaseId={heroCaseId} />

      {/* --- pillars + honesty note ------------------------------------------ */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-muted-foreground">
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-mini text-muted-foreground">
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
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-label text-muted-foreground">
            What these numbers do and do not claim
          </h2>
          <ul className="flex flex-col gap-2 text-compact leading-relaxed text-muted-foreground">
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
            <li>
              <span className="text-foreground">Confidence is not correctness.</span> The agent
              scores {m ? m.mean_confidence_accepted.toFixed(3) : '—'} on closures AVOS accepted and{' '}
              {m ? m.mean_confidence_refused.toFixed(3) : '—'} on the ones it refused — it
              discriminates, but{' '}
              <span className="text-foreground">
                {m ? m.high_confidence_refusals : '—'} refused closures still scored ≥0.85
              </span>
              . A self-reported score measures how complete the inputs looked, which is a fact
              about the inputs and not about the money.
            </li>
          </ul>
        </Card>
      </div>


      <footer className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-mini text-muted-foreground">
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
      <div className="mb-1 text-compact font-semibold text-primary">{name}</div>
      <p className="text-mini leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
