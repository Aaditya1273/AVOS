/**
 * The landing page.
 *
 * A judge arrives knowing nothing. This page makes the argument in about ten
 * seconds and hands them the console. Two things are on it, and they are kept
 * apart on purpose:
 *
 *   - What the product does at runtime: read Razorpay's API, normalise, build
 *     evidence, have a model propose, have the verifier decide.
 *   - What the evaluation proved: on 120 labelled synthetic settlements, the
 *     verifier refused every wrong closure. Those figures are labelled as
 *     evaluation figures and are read from `evals/raw/metrics.json`, not typed.
 *
 * Nothing here calls Razorpay. The console does; this page only describes it.
 */

import Link from 'next/link'
import { SiteNav } from '@/components/site-nav'
import { Badge, Card, Mono } from '@/components/ui/primitives'
import { IconArrowRight, IconCheck, IconCross, IconHold } from '@/components/ui/icon'
import { loadEvalReport } from '@/lib/eval-report'
import { loadManifest } from '@/lib/data/ledger'
import { findCaseBySettlement, materializeDecision } from '@/lib/decisions'
import { policyChangePoints } from '@/lib/replay'
import { formatCompact, formatPaise, formatPct } from '@/lib/money'
import { VERIFIER_VERSION } from '@/lib/verifier/deterministic'

export const dynamic = 'force-dynamic'

const HERO_SETTLEMENT = 'S-10092'

export default function LandingPage() {
  const report = loadEvalReport()
  const manifest = loadManifest()
  const m = report?.batch_120
  const policyPoints = policyChangePoints()

  const hero = findCaseBySettlement(HERO_SETTLEMENT)
  const heroDecision = hero ? materializeDecision(hero.c, hero.suite) : null
  const gatesPassed = report?.gates.every((g) => g.passed) ?? false

  return (
    <>
      <SiteNav active="home" />

      <main>
        {/* --- hero ---------------------------------------------------------- */}
        <section className="border-b border-border bg-card">
          <div className="grid-lines">
            <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
              <Badge variant="outline">Razorpay Buildathon · Track 04 · AI Finance Controller</Badge>

              <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
                Settlement assurance
                <br />
                for AI-operated finance, on{' '}
                <span className="text-primary">Razorpay</span>.
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                AVOS reads your Razorpay settlements over the API, has a model propose whether each one
                reconciles, and then has a deterministic verifier — with no model in it — recompute the
                money and decide. A confident agent cannot talk its way past a number that does not add
                up.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/console"
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open the console
                  <IconArrowRight className="h-4 w-4" />
                </Link>
                <span className="text-mini text-muted-foreground">
                  Read-only · Razorpay Test API · syncs on open
                </span>
              </div>

              {/* The runtime path, as executed. */}
              <ol className="mt-12 grid max-w-4xl gap-2 text-compact sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ['Razorpay API', 'GET, read-only'],
                  ['AVOS Ledger', 'normalised, paise'],
                  ['AI agent', 'proposes a claim'],
                  ['Evidence pack', 'hashed, stamped'],
                  ['Verifier', 'no model inside'],
                  ['Close / hold', 'or exception'],
                ].map(([name, hint], i) => (
                  <li key={name} className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="tnum flex h-5 w-5 items-center justify-center rounded-full bg-primary text-micro font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <span className="font-semibold">{name}</span>
                    </div>
                    <div className="mt-0.5 pl-7 text-mini text-muted-foreground">{hint}</div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* --- evaluation results -------------------------------------------- */}
        {m ? (
          <section className="border-b border-border">
            <div className="mx-auto max-w-[1100px] px-4 py-12 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                  AVOS Evaluation — measured over {m.n} labelled synthetic settlements
                </h2>
                <span className="text-mini text-muted-foreground">
                  evaluation dataset, seed <Mono>{manifest.seed}</Mono> · not Razorpay data
                </span>
              </div>
              <dl className="mt-5 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <Headline label="Match rate" value={formatPct(m.match_rate)} hint={`${m.ambiguous_count} ambiguous, sent to review`} />
                <Headline label="False closure" value={formatPct(m.false_closure_rate)} hint="nothing wrong was ever closed" tone="verified" />
                <Headline label="Value withheld" value={formatCompact(m.closure.withheld_value_paise)} hint="stopped before it posted" tone="uncertain" />
                <Headline label="Verify throughput" value={`${(m.throughput_records_per_sec / 1000).toFixed(1)}k/s`} hint="no model on the verdict path" />
              </dl>

              {heroDecision ? (
                <div className="mt-10 max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-panel">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                    <span className="font-mono text-compact font-semibold">{HERO_SETTLEMENT}</span>
                    <Badge variant="outline">AVOS Evaluation Dataset · case {heroDecision.case_id}</Badge>
                  </div>
                  <div className="grid gap-px bg-border sm:grid-cols-2">
                    <div className="bg-card p-4">
                      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                        Scripted proposer claimed
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-lg font-semibold line-through decoration-muted-foreground/50">
                          {heroDecision.proposal.claim.proposed_status}
                        </span>
                        <span className="text-mini text-muted-foreground">
                          confidence {heroDecision.proposal.confidence.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="bg-card p-4">
                      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                        Verifier returned
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-lg font-semibold text-[hsl(var(--verdict-failed))]">
                          {heroDecision.result.verdict}
                        </span>
                        {heroDecision.result.reason_code ? <Mono>{heroDecision.result.reason_code}</Mono> : null}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border bg-[hsl(var(--verdict-failed)/0.06)] px-4 py-3 text-compact">
                    <span className="font-semibold text-[hsl(var(--verdict-failed))]">Not closed.</span>{' '}
                    <span className="text-muted-foreground">
                      {formatPaise(heroDecision.batch_value_paise)} held: the settlement declared more in
                      platform fees than its own payment rows account for.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* --- the boundary -------------------------------------------------- */}
        <section className="border-b border-border bg-card">
          <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">The model proposes. It never decides.</h2>
                <p className="mt-3 text-body leading-relaxed text-muted-foreground">
                  An agent submits a structured claim with exactly three fields: a settlement id, a proposed
                  status, and the evidence ids it cites. Its reasoning and its confidence score travel on a
                  different object and are severed at the boundary — there is no field on the verifier&rsquo;s
                  input they could occupy, so passing one is a compile error rather than a policy someone has
                  to remember.
                </p>
                <p className="mt-3 text-body leading-relaxed text-muted-foreground">
                  <Mono>{VERIFIER_VERSION}</Mono> has zero runtime imports: no clock, no network, no
                  filesystem, no randomness, no environment. That is asserted mechanically on every evaluation
                  run. And if no model is configured, the product says <em>AI agent unavailable</em> — it does
                  not substitute a scripted one.
                </p>
              </div>

              <Card className="overflow-hidden shadow-panel">
                <div className="border-b border-border px-4 py-2.5 text-micro font-semibold uppercase tracking-label text-muted-foreground">
                  What crosses the boundary
                </div>
                <div className="divide-y divide-border">
                  <BoundaryRow ok label="settlement_id" note="which settlement" />
                  <BoundaryRow ok label="proposed_status" note="what it thinks" />
                  <BoundaryRow ok label="evidence_ids[]" note="what it cites" />
                  <BoundaryRow label="agent_reason" note="prose — severed" />
                  <BoundaryRow label="confidence" note="measured, never an input" />
                  <BoundaryRow label="notes" note="merchant text — dropped at ingest" />
                </div>
              </Card>
            </div>
          </div>
        </section>

        <footer className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-mini text-muted-foreground">
            {report ? (
              <span className="inline-flex items-center gap-1.5">
                {gatesPassed ? (
                  <IconCheck className="h-3.5 w-3.5 text-[hsl(var(--verdict-verified))]" />
                ) : (
                  <IconCross className="h-3.5 w-3.5 text-[hsl(var(--verdict-failed))]" />
                )}
                {report.gates.length} evaluation gates {gatesPassed ? 'passing' : 'failing'}
              </span>
            ) : null}
            <span>Policies: {policyPoints.map((p) => p.label).join(' → ')}</span>
            <span>Razorpay access: read-only, server-side</span>
          </div>
        </footer>
      </main>
    </>
  )
}

function Headline({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'verified' | 'uncertain' }) {
  const toneClass =
    tone === 'verified'
      ? 'text-[hsl(var(--verdict-verified))]'
      : tone === 'uncertain'
        ? 'text-[hsl(var(--verdict-uncertain))]'
        : 'text-foreground'
  return (
    <div>
      <dt className="text-micro font-semibold uppercase tracking-label text-muted-foreground">{label}</dt>
      <dd className={`tnum mt-1 text-3xl font-bold tracking-tight ${toneClass}`}>{value}</dd>
      <dd className="mt-1 text-mini leading-snug text-muted-foreground">{hint}</dd>
    </div>
  )
}

function BoundaryRow({ ok, label, note }: { ok?: boolean; label: string; note: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {ok ? (
        <IconCheck className="h-4 w-4 shrink-0 text-[hsl(var(--verdict-verified))]" />
      ) : (
        <IconHold className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <code className={`font-mono text-mini ${ok ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{label}</code>
      <span className="ml-auto text-mini text-muted-foreground">{note}</span>
    </div>
  )
}
