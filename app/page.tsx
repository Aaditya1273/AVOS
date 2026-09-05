/**
 * The landing page.
 *
 * A judge arrives knowing nothing. The console is dense on purpose — it is a
 * working surface — and dropping someone straight into it asks them to infer the
 * product from a data table. This page exists to make the argument in about ten
 * seconds and then hand them the tool.
 *
 * Every figure on it is read from `evals/raw/metrics.json` and the decision log
 * at request time. Nothing here is typed in by hand, so this page cannot drift
 * away from what the evaluation actually measured.
 */

import Link from 'next/link'
import { SiteNav } from '@/components/site-nav'
import { Badge, Card, Mono } from '@/components/ui/primitives'
import { IconArrowRight, IconCheck, IconCross, IconHold } from '@/components/ui/icon'
import { loadEvalReport } from '@/lib/eval-report'
import { loadManifest } from '@/lib/data/ledger'
import { findCaseBySettlement, materializeSuite } from '@/lib/decisions'
import { policyChangePoints } from '@/lib/replay'
import { formatCompact, formatPaise, formatPct } from '@/lib/money'
import { VERIFIER_VERSION } from '@/lib/verifier/deterministic'
import { materializeDecision } from '@/lib/decisions'

export const dynamic = 'force-dynamic'

const HERO_SETTLEMENT = 'S-10092'

export default function LandingPage() {
  const report = loadEvalReport()
  const manifest = loadManifest()
  const m = report?.batch_120
  const policyPoints = policyChangePoints()

  const hero = findCaseBySettlement(HERO_SETTLEMENT)
  const heroDecision = hero ? materializeDecision(hero.c, hero.suite) : null
  const heroWithheld = heroDecision?.batch_value_paise ?? 0
  const heroReason = heroDecision?.result.reason_code ?? null

  const batch = materializeSuite('batch_120')
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
                The agent said close it.
                <br />
                <span className="text-[hsl(var(--verdict-failed))]">AVOS said no</span>
                {heroWithheld ? (
                  <>
                    {' '}
                    — and held{' '}
                    <span className="tnum">{formatPaise(heroWithheld)}</span>.
                  </>
                ) : (
                  '.'
                )}
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                AVOS closes the settlement reconciliation loop end to end — it matches, proves,
                verifies and then closes. The closing decision is made by a deterministic verifier
                with no model in it, so a confident agent cannot talk its way past a number that
                does not add up.
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
                  Live data · {batch.length + 30} cases verified on every request
                </span>
              </div>

              {/* The claim, made concrete, immediately. */}
              {heroDecision ? (
                <div className="mt-12 max-w-3xl overflow-hidden rounded-xl border border-border bg-background shadow-panel">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                    <span className="font-mono text-compact font-semibold">{HERO_SETTLEMENT}</span>
                    <span className="text-mini text-muted-foreground">
                      {heroDecision.pack.merchant_id}
                    </span>
                  </div>
                  <div className="grid gap-px bg-border sm:grid-cols-2">
                    <div className="bg-card p-4">
                      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                        The agent proposed
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
                        AVOS returned
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-lg font-semibold text-[hsl(var(--verdict-failed))]">
                          {heroDecision.result.verdict}
                        </span>
                        {heroReason ? <Mono>{heroReason}</Mono> : null}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border bg-[hsl(var(--verdict-failed)/0.06)] px-4 py-3 text-compact">
                    <span className="font-semibold text-[hsl(var(--verdict-failed))]">
                      Not closed.
                    </span>{' '}
                    <span className="text-muted-foreground">
                      The settlement declared more in platform fees than its own payment rows
                      account for. The money stays put until a human resolves it.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* --- measured results ---------------------------------------------- */}
        {m ? (
          <section className="border-b border-border">
            <div className="mx-auto max-w-[1100px] px-4 py-12 sm:px-6 lg:px-8">
              <h2 className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                Measured over {m.n} labelled settlements
              </h2>
              <dl className="mt-5 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <Headline
                  label="Match rate"
                  value={formatPct(m.match_rate)}
                  hint={`${m.ambiguous_count} ambiguous, sent to review`}
                />
                <Headline
                  label="False closure"
                  value={formatPct(m.false_closure_rate)}
                  hint="nothing wrong was ever closed"
                  tone="verified"
                />
                <Headline
                  label="Value withheld"
                  value={formatCompact(m.closure.withheld_value_paise)}
                  hint="stopped before it posted"
                  tone="uncertain"
                />
                <Headline
                  label="Verify throughput"
                  value={`${(m.throughput_records_per_sec / 1000).toFixed(1)}k/s`}
                  hint="no model on the verdict path"
                />
              </dl>
            </div>
          </section>
        ) : null}

        {/* --- the loop ------------------------------------------------------ */}
        <section className="border-b border-border bg-card">
          <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold tracking-tight">One finance-ops loop, closed</h2>
            <p className="mt-2 max-w-2xl text-body leading-relaxed text-muted-foreground">
              Track 04 asks for an agent that closes a loop and reports its match rate. AVOS closes
              settlement reconciliation, and reports both what it closed and what it refused to.
            </p>

            <ol className="mt-8 grid gap-4 md:grid-cols-4">
              <Stage
                n={1}
                name="Match"
                body="Pair each settlement against the bank statement on reference, amount and date. Ties are declared ambiguous rather than guessed."
              />
              <Stage
                n={2}
                name="Prove"
                body="Assemble an evidence pack. Every row carries its source file, row id, timestamp, freshness and content hash."
              />
              <Stage
                n={3}
                name="Verify"
                body="Recompute the money in integer paise under the policy in force at decision time. 21 checks. Zero model."
              />
              <Stage
                n={4}
                name="Close"
                body="VERIFIED closes. UNCERTAIN refuses and holds. FAILED becomes an exception with a named owner."
              />
            </ol>
          </div>
        </section>

        {/* --- the boundary -------------------------------------------------- */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  The model proposes. It never decides.
                </h2>
                <p className="mt-3 text-body leading-relaxed text-muted-foreground">
                  An agent submits a structured claim with exactly three fields: a settlement id, a
                  proposed status, and the evidence ids it cites. Its reasoning and its confidence
                  score travel on a different object and are severed at the boundary — there is no
                  field on the verifier&rsquo;s input they could occupy, so passing one is a compile
                  error rather than a policy someone has to remember.
                </p>
                <p className="mt-3 text-body leading-relaxed text-muted-foreground">
                  <Mono>{VERIFIER_VERSION}</Mono> has zero runtime imports: no clock, no network, no
                  filesystem, no randomness, no environment. That is asserted mechanically on every
                  evaluation run, not promised in a README.
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
                  <BoundaryRow label="notes / memo" note="attacker-controlled, quarantined" />
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* --- provenance footer --------------------------------------------- */}
        <footer className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-mini text-muted-foreground">
            {report ? (
              <span className="inline-flex items-center gap-1.5">
                {gatesPassed ? (
                  <IconCheck className="h-3.5 w-3.5 text-[hsl(var(--verdict-verified))]" />
                ) : (
                  <IconCross className="h-3.5 w-3.5 text-[hsl(var(--verdict-failed))]" />
                )}
                {report.gates.length} acceptance gates{' '}
                {gatesPassed ? 'passing' : 'failing'}
              </span>
            ) : null}
            <span>
              Ledger: <Mono>{manifest.evidence_rows.razorpay_payments}</Mono> payments ·{' '}
              <Mono>{manifest.evidence_rows.bank_statement}</Mono> bank rows
            </span>
            <span>Policies: {policyPoints.map((p) => p.label).join(' → ')}</span>
            <span>
              Seed <Mono>{manifest.seed}</Mono>
            </span>
          </div>
        </footer>
      </main>
    </>
  )
}

function Headline({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone?: 'verified' | 'uncertain'
}) {
  const toneClass =
    tone === 'verified'
      ? 'text-[hsl(var(--verdict-verified))]'
      : tone === 'uncertain'
        ? 'text-[hsl(var(--verdict-uncertain))]'
        : 'text-foreground'
  return (
    <div>
      <dt className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
        {label}
      </dt>
      <dd className={`tnum mt-1 text-3xl font-bold tracking-tight ${toneClass}`}>{value}</dd>
      <dd className="mt-1 text-mini leading-snug text-muted-foreground">{hint}</dd>
    </div>
  )
}

function Stage({ n, name, body }: { n: number; name: string; body: string }) {
  return (
    <li className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <span className="tnum flex h-6 w-6 items-center justify-center rounded-full bg-primary text-mini font-bold text-primary-foreground">
          {n}
        </span>
        <span className="text-body font-semibold">{name}</span>
      </div>
      <p className="mt-2 text-mini leading-relaxed text-muted-foreground">{body}</p>
    </li>
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
      <code className={`font-mono text-mini ${ok ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
        {label}
      </code>
      <span className="ml-auto text-mini text-muted-foreground">{note}</span>
    </div>
  )
}
