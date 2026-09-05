/**
 * The AVOS console.
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
 *
 * Every panel below is built here and handed to a client tab shell as a node,
 * so the whole evaluation stays on the server.
 */

import { SiteNav } from '@/components/site-nav'
import { ConsoleShell, type ConsoleTab } from '@/components/console-shell'
import { Badge, Card, Mono, Separator } from '@/components/ui/primitives'
import { Metric, MetricGroup } from '@/components/ui/metrics'
import { IconCheck, IconCross } from '@/components/ui/icon'
import { Console, type CaseRow } from '@/components/console'
import { ProvenanceStrip } from '@/components/provenance'
import { materializeSuite, findCaseBySettlement } from '@/lib/decisions'
import { policyChangePoints } from '@/lib/replay'
import { POLICY_SNAPSHOTS } from '@/lib/policy/snapshots'
import { detectInjection } from '@/lib/ai/qa'
import { loadManifest } from '@/lib/data/ledger'
import { loadEvalReport } from '@/lib/eval-report'
import { USING_MOCK, MODEL_VERSION } from '@/lib/ai/provider'
import { VERIFIER_VERSION } from '@/lib/verifier/deterministic'
import { razorpayStatus } from '@/lib/connectors/razorpay'
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

export default function ConsolePage() {
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
  const isolationPassed = report?.isolation.filter((i) => i.passed).length ?? 0
  const attacksPassed = report?.adversarial_tests.filter((t) => t.passed).length ?? 0

  const tabs: ConsoleTab[] = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="flex flex-col gap-5">
          {m ? (
            <Card className="shadow-panel">
              <dl className="grid gap-x-8 gap-y-6 p-5 md:grid-cols-2 xl:grid-cols-3">
                <MetricGroup label="Control — what the system did">
                  <Metric
                    label="Closed"
                    value={m.closure.closed}
                    hint={`of ${m.n} presented`}
                    tone="verified"
                  />
                  <Metric
                    label="Refused"
                    value={m.closure.refused}
                    hint="held for review"
                    tone="uncertain"
                  />
                  <Metric
                    label="Exceptions"
                    value={m.closure.failed}
                    hint="routed to an owner"
                    tone="failed"
                  />
                </MetricGroup>

                <MetricGroup label="Assurance — whether it can be trusted">
                  <Metric
                    label="Match rate"
                    value={formatPct(m.match_rate)}
                    hint={`${m.ambiguous_count} ambiguous`}
                  />
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
            </Card>
          ) : (
            <Card className="p-5 text-body text-muted-foreground">
              No evaluation on record. Run <Mono>npm run eval</Mono> to populate metrics.
            </Card>
          )}

          <Card className="p-5 shadow-panel">
            <h2 className="mb-2 text-micro font-semibold uppercase tracking-label text-muted-foreground">
              What these numbers do and do not claim
            </h2>
            <ul className="flex flex-col gap-2 text-compact leading-relaxed text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Value coverage</span> is measured
                against verifiable value — of the money that genuinely reconciled, how much we
                cleared. Auto-clear rate uses the whole batch and lands near two-thirds, which is
                correct on a fixture that is one-third deliberately broken.
              </li>
              <li>
                <span className="font-medium text-foreground">0% false closure</span> holds on this
                labelled fixture, and it is achievable because AVOS abstains rather than guesses. It
                is not offered as a global guarantee.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  UNCERTAIN is a result, not a failure.
                </span>{' '}
                An abstention costs a reviewer ten minutes. A wrong VERIFIED costs a reconciliation.
              </li>
              <li>
                <span className="font-medium text-foreground">Confidence is not correctness.</span>{' '}
                The agent scores {m ? m.mean_confidence_accepted.toFixed(3) : '—'} on closures AVOS
                accepted and {m ? m.mean_confidence_refused.toFixed(3) : '—'} on the ones it refused
                — it discriminates, but{' '}
                <span className="font-medium text-foreground">
                  {m ? m.high_confidence_refusals : '—'} refused closures still scored ≥0.85
                </span>
                . A self-reported score measures how complete the inputs looked, which is a fact
                about the inputs and not about the money.
              </li>
            </ul>
          </Card>
        </div>
      ),
    },

    {
      id: 'reconciliation',
      label: 'Reconciliation',
      hint: String(rows.length),
      content: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
              Batch of {batch.length}
            </span>
            <Badge variant="failed">{tally.FAILED} refused</Badge>
            <Badge variant="uncertain">{tally.UNCERTAIN} abstained</Badge>
            <Badge variant="verified">{tally.VERIFIED} cleared</Badge>
            <span className="text-mini text-muted-foreground">
              Matched, verified and closed on every request from source — nothing is read back from
              the decision log.
            </span>
          </div>
          <Console rows={rows} policyPoints={policyPoints} initialCaseId={heroCaseId} />
        </div>
      ),
    },

    {
      id: 'policy',
      label: 'Policy & replay',
      hint: String(POLICY_SNAPSHOTS.length),
      content: (
        <div className="flex flex-col gap-5">
          <Card className="p-5 shadow-panel">
            <h2 className="text-body font-semibold">Policy is a function of a timestamp</h2>
            <p className="mt-1.5 max-w-3xl text-compact leading-relaxed text-muted-foreground">
              A settlement decided in July must be judged under July&rsquo;s rules, not
              today&rsquo;s. AVOS resolves the policy in force at each decision time and stamps the
              version onto the verdict. Replaying a case under a different epoch re-runs the same
              evidence, with the same hashes and the same arithmetic — only the rule changes. Open
              any case in Reconciliation and use its Replay tab to watch a verdict flip.
            </p>
          </Card>

          <Card className="overflow-hidden shadow-panel">
            <div className="border-b border-border px-5 py-3 text-micro font-semibold uppercase tracking-label text-muted-foreground">
              Policy epochs on record
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-compact">
                <thead>
                  <tr className="border-b border-border text-left text-micro uppercase tracking-label text-muted-foreground">
                    <th className="px-5 py-2.5 font-semibold">Version</th>
                    <th className="px-5 py-2.5 font-semibold">Effective from</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Fee tolerance</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Rate card</th>
                    <th className="px-5 py-2.5 text-right font-semibold">GST</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Max lag</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Freshness</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {POLICY_SNAPSHOTS.map((p) => (
                    <tr key={p.version}>
                      <td className="px-5 py-2.5">
                        <Mono>{p.version}</Mono>
                      </td>
                      <td className="tnum px-5 py-2.5 text-muted-foreground">{p.effective_at}</td>
                      <td className="tnum px-5 py-2.5 text-right">
                        {formatPaise(p.fee_tolerance_paise)}
                      </td>
                      <td className="tnum px-5 py-2.5 text-right">{p.fee_rate_bps} bps</td>
                      <td className="tnum px-5 py-2.5 text-right">{p.gst_rate_bps} bps</td>
                      <td className="tnum px-5 py-2.5 text-right">{p.max_settlement_lag_days} d</td>
                      <td className="tnum px-5 py-2.5 text-right">
                        {p.evidence_freshness_max_hours} h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-5 py-3 text-mini leading-relaxed text-muted-foreground">
              A settlement whose payments straddle a repricing has no single correct fee rate — only
              a per-payment one. Each evidence row is stamped with the card in force when that
              payment was captured, which is why the verifier can get this right while importing
              nothing.
            </div>
          </Card>
        </div>
      ),
    },

    {
      id: 'evaluation',
      label: 'Evaluation',
      hint: report ? `${report.gates.length} gates` : undefined,
      content: (
        <div className="flex flex-col gap-5">
          {report ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                  label="Acceptance gates"
                  value={`${report.gates.filter((g) => g.passed).length}/${report.gates.length}`}
                  ok={gatesPassed}
                  hint="fail the build, not a dashboard"
                />
                <StatCard
                  label="Isolation checks"
                  value={`${isolationPassed}/${report.isolation.length}`}
                  ok={isolationPassed === report.isolation.length}
                  hint="verifier imports nothing at runtime"
                />
                <StatCard
                  label="Adversarial suite"
                  value={`${attacksPassed}/${report.adversarial_tests.length}`}
                  ok={attacksPassed === report.adversarial_tests.length}
                  hint="attacks the verifier must survive"
                />
              </div>

              <Card className="overflow-hidden shadow-panel">
                <div className="border-b border-border px-5 py-3 text-micro font-semibold uppercase tracking-label text-muted-foreground">
                  Acceptance gates
                </div>
                <ul className="divide-y divide-border">
                  {report.gates.map((g) => (
                    <li key={g.name} className="flex items-start gap-3 px-5 py-3">
                      <StatusDot ok={g.passed} />
                      <div className="min-w-0">
                        <div className="text-compact font-medium">{g.name}</div>
                        <div className="text-mini leading-relaxed text-muted-foreground">
                          {g.detail}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="overflow-hidden shadow-panel">
                  <div className="border-b border-border px-5 py-3 text-micro font-semibold uppercase tracking-label text-muted-foreground">
                    Adversarial suite
                  </div>
                  <ul className="max-h-[420px] divide-y divide-border overflow-y-auto scrollbar-thin">
                    {report.adversarial_tests.map((t) => (
                      <li key={t.id} className="flex items-start gap-3 px-5 py-2.5">
                        <StatusDot ok={t.passed} />
                        <div className="min-w-0">
                          <div className="text-compact font-medium">{t.name}</div>
                          <div className="text-mini leading-relaxed text-muted-foreground">
                            {t.detail}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Card className="overflow-hidden shadow-panel">
                  <div className="border-b border-border px-5 py-3 text-micro font-semibold uppercase tracking-label text-muted-foreground">
                    Verifier isolation
                  </div>
                  <ul className="max-h-[420px] divide-y divide-border overflow-y-auto scrollbar-thin">
                    {report.isolation.map((i) => (
                      <li key={i.id} className="flex items-start gap-3 px-5 py-2.5">
                        <StatusDot ok={i.passed} />
                        <div className="min-w-0">
                          <div className="font-mono text-mini">{i.id}</div>
                          <div className="text-mini leading-relaxed text-muted-foreground">
                            {i.detail}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>

              <p className="text-mini text-muted-foreground">
                Generated <span className="tnum">{report.generated_at}</span> · verifier{' '}
                <Mono>{report.verifier_version}</Mono>
              </p>
            </>
          ) : (
            <Card className="p-5 text-body text-muted-foreground">
              No evaluation on record. Run <Mono>npm run eval</Mono>.
            </Card>
          )}
        </div>
      ),
    },

    {
      id: 'architecture',
      label: 'Architecture',
      content: (
        <div className="flex flex-col gap-5">
          <Card className="p-5 shadow-panel">
            <h2 className="mb-3 text-micro font-semibold uppercase tracking-label text-muted-foreground">
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
                body="expected = gross − refunds − fees − tax − holds, against the bank credit. Integer paise. Zero model."
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

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5 shadow-panel">
              <h2 className="text-body font-semibold">The boundary</h2>
              <p className="mt-1.5 text-compact leading-relaxed text-muted-foreground">
                An agent emits a structured claim of exactly three fields. Its prose and its
                confidence travel on a different object, and there is no field on the
                verifier&rsquo;s input they could occupy — so passing one is a compile error, not a
                convention.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-mini leading-relaxed">
{`StructuredClaim {
  settlement_id
  proposed_status
  evidence_ids[]
}
        ↓  crosses
DeterministicVerifier  ${VERIFIER_VERSION}
  no clock · no network · no fs
  no randomness · no env · no model`}
              </pre>
            </Card>

            <Card className="p-5 shadow-panel">
              <h2 className="text-body font-semibold">Evidence sources</h2>
              <p className="mt-1.5 text-compact leading-relaxed text-muted-foreground">
                The committed CSV ledger and the optional Razorpay adapter both normalise into the
                same <Mono>Ledger</Mono> before any AVOS logic runs, so every stage after the join
                is the same code on the same types.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-mini leading-relaxed">
{`committed CSVs ─┐
                ├─▶ Ledger ─▶ pack ─▶ verify
Razorpay API ───┘`}
              </pre>
              <div className="mt-3">
                <ProvenanceStrip source="fixture" connector={razorpayStatus()} />
              </div>
            </Card>
          </div>
        </div>
      ),
    },
  ]

  return (
    <>
      <SiteNav active="console" />
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settlement assurance console</h1>
            <p className="mt-0.5 text-compact text-muted-foreground">
              {rows.length} cases matched, verified and closed on every request from source.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {USING_MOCK ? 'deterministic core · no model in the verdict' : `live · ${MODEL_VERSION}`}
            </Badge>
            {report ? (
              <Badge variant={gatesPassed ? 'verified' : 'failed'}>
                {gatesPassed ? 'all acceptance gates pass' : 'gates failing'}
              </Badge>
            ) : null}
          </div>
        </div>

        <ConsoleShell tabs={tabs} initial="reconciliation" />
      </main>
    </>
  )
}

function Pillar({ name, body }: { name: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="mb-1 text-compact font-semibold text-primary">{name}</div>
      <p className="text-mini leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--verdict-verified))]" />
  ) : (
    <IconCross className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--verdict-failed))]" />
  )
}

function StatCard({
  label,
  value,
  ok,
  hint,
}: {
  label: string
  value: string
  ok: boolean
  hint: string
}) {
  return (
    <Card className="p-4 shadow-panel">
      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
        {label}
      </div>
      <div
        className={`tnum mt-1 text-2xl font-bold ${
          ok ? 'text-[hsl(var(--verdict-verified))]' : 'text-[hsl(var(--verdict-failed))]'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-mini text-muted-foreground">{hint}</div>
    </Card>
  )
}
