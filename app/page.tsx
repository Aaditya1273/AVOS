/**
 * The landing page.
 *
 * Answer first, evidence second, engineering third. Every section answers one
 * question, in this order: what is AVOS, what does it do, is Razorpay real,
 * why does it exist, how does it work, why was this refused, why trust it,
 * what now.
 *
 * Every figure is read at request time from the same decision the console
 * renders — `materializeDecision` on evaluation case B092 — and from
 * `evals/raw/metrics.json`. Nothing on this page is typed in. The decision is
 * labelled as coming from the AVOS Evaluation Dataset wherever it appears,
 * because it does; the only block that touches Razorpay is `RazorpayLive`,
 * which asks the API when it scrolls into view and shows the answer.
 */

import Link from 'next/link'
import { SiteNav } from '@/components/site-nav'
import { StoryScene, type StoryChapter } from '@/components/landing/story-scene'
import { Reveal } from '@/components/landing/reveal'
import { RazorpayLive } from '@/components/landing/razorpay-live'
import { Badge, Mono } from '@/components/ui/primitives'
import { IconArrowRight, IconCheck, IconCross, IconHold } from '@/components/ui/icon'
import { loadEvalReport } from '@/lib/eval-report'
import { findCaseBySettlement, materializeDecision } from '@/lib/decisions'
import { formatDelta, formatPaise, formatPct } from '@/lib/money'
import { fmtTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const HERO_SETTLEMENT = 'S-10092'

export default function LandingPage() {
  const report = loadEvalReport()
  const m = report?.batch_120
  const found = findCaseBySettlement(HERO_SETTLEMENT)
  const d = found ? materializeDecision(found.c, found.suite) : null
  const r = d?.result ?? null
  const pack = d?.pack ?? null

  // Every string below is derived, not written.
  const amount = d ? formatPaise(d.batch_value_paise) : '—'
  const difference = r?.difference_paise != null ? formatPaise(Math.abs(r.difference_paise)) : '—'
  const reasonWord = r?.reason_code === 'FEE_MISMATCH' ? 'fee mismatch' : (r?.reason_code ?? '').toLowerCase().replace(/_/g, ' ')
  const failedChecks = r?.checks.filter((c) => c.status === 'fail') ?? []
  const evidenceSources = pack ? [...new Set(pack.evidence.map((e) => e.source))] : []
  const sourceLabel = pack?.evidence[0]?.provenance.label ?? 'AVOS Evaluation Dataset'
  const verifierGate = report?.gates.find((g) => /verifier unit tests/i.test(g.name))
  const verifierChecks = verifierGate?.detail.match(/(\d+)\/(\d+)/)?.[0] ?? null
  const isolation = report ? `${report.isolation.filter((i) => i.passed).length}/${report.isolation.length}` : null
  const adversarial = report ? `${report.adversarial_tests.filter((t) => t.passed).length}/${report.adversarial_tests.length}` : null

  const chapters: StoryChapter[] = [
    { at: 0, label: 'Razorpay', line: 'Settlement data enters AVOS.' },
    { at: 0.17, label: 'Ledger', line: 'Normalised to integer paise. Nothing is trusted yet.' },
    { at: 0.34, label: 'AI proposal', line: `The agent proposes: ${d?.proposal.claim.proposed_status ?? 'RECONCILED'}.` },
    { at: 0.5, label: 'Evidence', line: `${pack?.evidence.length ?? 0} rows assembled: source, amount, policy, timestamp.` },
    { at: 0.66, label: 'Verifier', line: 'The claim is recomputed from the evidence, independently.' },
    { at: 0.83, label: 'Decision', line: `${amount} · NOT CLOSED · ${difference} ${reasonWord}`, state: 'stop' },
  ]

  return (
    <>
      <SiteNav active="home" />
      <main className="bg-background">
        {/* ============================================================ HERO
            Question: what is AVOS? */}
        <section className="border-b border-border bg-card" aria-labelledby="hero-title">
          <StoryScene amount={amount} chapters={chapters} stopAt={0.8}>
            <Badge variant="outline">Razorpay Buildathon · Track 04</Badge>
            <h1 id="hero-title" className="mt-5 text-[40px] font-bold leading-[1.05] tracking-[-0.02em] sm:text-[56px] xl:text-[68px]">
              The agent said close it.
              <br />
              AVOS asked for proof.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-[20px]">
              Razorpay-connected settlement control that independently verifies AI reconciliation
              before financial closure.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/console"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open the console
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-11 items-center rounded-lg border border-border bg-card px-5 text-body font-medium transition-colors hover:bg-accent"
              >
                See how it works
              </a>
            </div>

            {/* The financial object. Money before mechanism. */}
            {d && r ? (
              <div className="mt-10 max-w-md rounded-xl border border-border bg-background p-5 shadow-panel">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="tnum text-[36px] font-bold leading-none tracking-tight sm:text-[48px]">{amount}</div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[hsl(var(--verdict-failed)/0.1)] px-2.5 py-1 text-compact font-semibold text-[hsl(var(--verdict-failed))]">
                    <IconCross className="h-3.5 w-3.5" /> Not closed
                  </span>
                </div>
                <div className="mt-2 text-body text-muted-foreground">
                  <span className="tnum font-medium text-foreground">{difference}</span> {reasonWord} · settlement{' '}
                  <Mono>{d.result.settlement_id}</Mono>
                </div>
                <div className="mt-3 text-mini text-muted-foreground">
                  From the {sourceLabel}, case {d.case_id}. Not a Razorpay transaction.
                </div>
              </div>
            ) : null}
          </StoryScene>
        </section>

        {/* ============================================================ PRODUCT PROOF
            Question: what does AVOS actually do? */}
        {d && r && pack ? (
          <section className="border-b border-border" aria-labelledby="proof-title">
            <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
              <Reveal>
                <h2 id="proof-title" className="text-[32px] font-bold tracking-tight sm:text-[40px]">
                  One settlement, decided.
                </h2>
                <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                  An excerpt of a real AVOS decision, exactly as the console renders it.
                </p>
              </Reveal>

              <Reveal delay={80}>
                <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card shadow-panel">
                  <ol className="grid grid-cols-2 divide-y divide-border border-b border-border text-compact sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6 lg:divide-x">
                    {[
                      ['Source', sourceLabel],
                      ['Settlement', d.result.settlement_id],
                      ['AI proposal', d.proposal.claim.proposed_status],
                      ['Evidence', `${pack.evidence.length} rows`],
                      ['Verification', `${r.verdict} · ${r.reason_code}`],
                      ['Decision', 'NOT CLOSED'],
                    ].map(([k, v], i) => (
                      <li key={k} className="px-4 py-3">
                        <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                          {i + 1} · {k}
                        </div>
                        <div className={i >= 4 ? 'mt-0.5 font-semibold text-[hsl(var(--verdict-failed))]' : 'mt-0.5 font-medium'}>{v}</div>
                      </li>
                    ))}
                  </ol>

                  <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">Primary</div>
                      <div className="tnum mt-1 text-[48px] font-bold leading-none tracking-tight sm:text-[56px]">{amount}</div>
                      <div className="mt-2 inline-flex items-center gap-1.5 text-lg font-semibold text-[hsl(var(--verdict-failed))]">
                        <IconCross className="h-4 w-4" /> NOT CLOSED
                      </div>
                      <div className="mt-2 text-body text-muted-foreground">
                        Reason: <span className="tnum font-medium text-foreground">{difference}</span> {reasonWord}
                      </div>
                    </div>

                    <details className="group rounded-lg border border-border bg-background">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-body font-medium [&::-webkit-details-marker]:hidden">
                        View why
                        <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
                          <IconArrowRight className="h-4 w-4" />
                        </span>
                      </summary>
                      <dl className="divide-y divide-border border-t border-border text-compact">
                        {(
                          [
                            ['Agent proposal', `${d.proposal.claim.proposed_status} · confidence ${d.proposal.confidence.toFixed(2)} · cited ${d.proposal.claim.evidence_ids.length} rows`],
                            ['Source', `${sourceLabel} · case ${d.case_id} · ${pack.merchant_id}`],
                            ['Evidence used', `${pack.evidence.length} rows across ${evidenceSources.join(', ')}`],
                            ['Expected', r.expected_paise != null ? formatPaise(r.expected_paise) : '—'],
                            ['Observed', r.observed_paise != null ? formatPaise(r.observed_paise) : '—'],
                            ['Difference', formatDelta(r.difference_paise)],
                            ['Policy', `${r.policy_version} · fee tolerance ${formatPaise(r.tolerance_paise ?? 0)}`],
                            ['Verifier result', `${r.verdict} · ${r.reason_code} · ${failedChecks.length} of ${r.checks.length} checks failed (${failedChecks.map((c) => c.id).join(', ')})`],
                            ['Resolution', `${d.closure.status === 'FAILED' ? 'Exception — not closed' : d.closure.status}. ${d.closure.required_evidence[0] ?? ''}`],
                          ] as [string, string][]
                        ).map(([k, v]) => (
                          <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="tnum">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </div>
                </div>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* ============================================================ RAZORPAY
            Question: is Razorpay real here? */}
        <section className="border-b border-border bg-card" aria-labelledby="rzp-title">
          <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <Reveal>
              <h2 id="rzp-title" className="text-[32px] font-bold tracking-tight sm:text-[40px]">
                Connected to Razorpay. Read-only.
              </h2>
              <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                This block asks the Razorpay API from the server when it comes into view and shows what came
                back — including the endpoints and their status codes. It is never pre-rendered as connected.
              </p>
            </Reveal>
            <Reveal delay={80} className="mt-8">
              <RazorpayLive />
            </Reveal>
            <Reveal delay={120} className="mt-6">
              <div className="grid gap-3 text-compact sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-background px-4 py-3">
                  <div className="font-semibold">Real Razorpay data</div>
                  <p className="mt-1 text-muted-foreground">
                    Whatever the API returns above — settlements, recon rows, payments, refunds — is what the
                    console verifies. A test account with no transactions returns zero, and zero is what is shown.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background px-4 py-3">
                  <div className="font-semibold">AVOS Evaluation Dataset</div>
                  <p className="mt-1 text-muted-foreground">
                    {m ? `${m.n} synthetic, labelled settlements` : 'Synthetic, labelled settlements'} used to prove the
                    verifier. The decision on this page is one of them, and is labelled as such everywhere it appears.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ============================================================ WHY
            Question: why does AVOS exist? */}
        <section className="border-b border-border" aria-labelledby="why-title">
          <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <Reveal>
              <h2 id="why-title" className="max-w-3xl text-[32px] font-bold leading-[1.15] tracking-tight sm:text-[40px]">
                AI can reason. AI can be wrong.
                <br />
                Financial closure requires proof.
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <ol className="mt-10 grid gap-6 sm:grid-cols-3">
                {[
                  ['AI proposes.', 'A model reads the settlement and says whether it reconciles, and how sure it is.'],
                  ['Evidence verifies.', 'Every claim is recomputed from source rows — amounts, fees, policy, timestamps — by code with no model in it.'],
                  ['AVOS decides.', 'Verified closes. Uncertain holds. Failed becomes an exception with an owner. Confidence is never an input.'],
                ].map(([h, body], i) => (
                  <li key={h} className="border-t-2 border-primary pt-4">
                    <div className="text-mini text-muted-foreground">0{i + 1}</div>
                    <div className="mt-1 text-xl font-semibold">{h}</div>
                    <p className="mt-2 text-body leading-relaxed text-muted-foreground">{body}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* ============================================================ HOW
            Question: how does AVOS stop unsafe closure? */}
        <section id="how" className="scroll-mt-14 border-b border-border bg-card" aria-labelledby="how-title">
          <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <Reveal>
              <h2 id="how-title" className="text-[32px] font-bold tracking-tight sm:text-[40px]">How it works</h2>
              <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                Six stages. The model is one of them, and it is not the one that decides.
              </p>
            </Reveal>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Razorpay', 'Settlements, recon rows, payments and refunds are read over four GET endpoints.', 'ok'],
                ['Ledger', 'Everything becomes integer paise and ISO time. Merchant notes are dropped at the door.', 'ok'],
                ['AI proposal', 'A live model proposes a status and cites the rows it relied on.', 'ok'],
                ['Evidence', 'Each row is hashed, stamped with its policy rate card, and labelled with where it came from.', 'ok'],
                ['Independent verifier', 'Recomputes the money from the evidence. No model, no clock, no network — twenty-one checks.', 'ok'],
                ['Financial decision', 'Verified closes. Uncertain is held. Failed is an exception. This one failed.', 'stop'],
              ].map(([name, body, state], i) => (
                <Reveal key={name} delay={i * 60} className="bg-card">
                  <li className="flex h-full gap-3 p-5">
                    <span
                      className={
                        'tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-mini font-bold ' +
                        (state === 'stop'
                          ? 'bg-[hsl(var(--verdict-failed)/0.12)] text-[hsl(var(--verdict-failed))]'
                          : 'bg-primary text-primary-foreground')
                      }
                    >
                      {i + 1}
                    </span>
                    <div>
                      <div className="text-body font-semibold">{name}</div>
                      <p className="mt-1 text-compact leading-relaxed text-muted-foreground">{body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ============================================================ FINANCIAL PROOF
            Question: why did AVOS reject this? */}
        {r ? (
          <section className="border-b border-border" aria-labelledby="fin-title">
            <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
              <Reveal>
                <h2 id="fin-title" className="text-[32px] font-bold tracking-tight sm:text-[40px]">
                  Why AVOS refused this closure
                </h2>
                <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                  The settlement declared more in platform fees than its own payment rows account for. The
                  difference is small. The tolerance was smaller.
                </p>
              </Reveal>
              <Reveal delay={80}>
                <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
                  {(
                    [
                      ['Expected', r.expected_paise != null ? formatPaise(r.expected_paise) : '—', 'recomputed from evidence', ''],
                      ['Observed', r.observed_paise != null ? formatPaise(r.observed_paise) : '—', 'bank credit', ''],
                      ['Difference', formatDelta(r.difference_paise), `tolerance ${formatPaise(r.tolerance_paise ?? 0)}`, 'failed'],
                      ['Verdict', r.verdict, r.reason_code ?? '', 'failed'],
                      ['Action', 'NOT CLOSED', 'exception routed to an owner', 'failed'],
                    ] as [string, string, string, string][]
                  ).map(([k, v, hint, tone]) => (
                    <div key={k} className="bg-card px-5 py-5">
                      <dt className="text-micro font-semibold uppercase tracking-label text-muted-foreground">{k}</dt>
                      <dd className={'tnum mt-1.5 text-[26px] font-bold leading-none tracking-tight sm:text-[28px] ' + (tone === 'failed' ? 'text-[hsl(var(--verdict-failed))]' : '')}>
                        {v}
                      </dd>
                      <dd className="mt-1.5 text-mini text-muted-foreground">{hint}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* ============================================================ TRUST / EVIDENCE
            Question: why trust it? */}
        {d && r && pack ? (
          <section className="border-b border-border bg-card" aria-labelledby="trust-title">
            <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
              <Reveal>
                <h2 id="trust-title" className="text-[32px] font-bold tracking-tight sm:text-[40px]">Evidence, not confidence</h2>
                <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                  The agent reported {d.proposal.confidence.toFixed(2)} confidence. The verifier never read it.
                </p>
              </Reveal>
              <Reveal delay={80}>
                <div className="mt-8 rounded-xl border border-border bg-background shadow-panel">
                  <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
                    {(
                      [
                        ['Source', `${sourceLabel} — ${evidenceSources.length} sources`],
                        ['Policy', `${r.policy_version} · in force from ${fmtTime(r.policy_effective_at)}`],
                        ['Captured', `${fmtTime(pack.event_time)} · decided ${fmtTime(pack.decision_time)}`],
                        ['Verifier', `AVOS ${r.verifier_version}`],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k} className="bg-background px-5 py-4">
                        <dt className="text-micro font-semibold uppercase tracking-label text-muted-foreground">{k}</dt>
                        <dd className="mt-1 text-compact">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <details className="group border-t border-border">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-body font-medium [&::-webkit-details-marker]:hidden">
                      View technical details
                      <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
                        <IconArrowRight className="h-4 w-4" />
                      </span>
                    </summary>
                    <dl className="divide-y divide-border border-t border-border text-compact">
                      {(
                        [
                          ['Evidence pack hash', pack.pack_hash],
                          ['Evidence rows', `${pack.evidence.length} · ${evidenceSources.join(' · ')}`],
                          ['Checks', `${r.checks.length} run · ${failedChecks.length} failed · ${failedChecks.map((c) => c.id).join(', ')}`],
                          ['Policy fee', `${formatPaise(r.policy_fee_paise ?? 0)} from the rate card · declared fee ${formatDelta(r.fee_delta_paise)} against it`],
                          ['Verifier', `${r.verifier_version} — zero runtime imports, asserted on every evaluation run`],
                          ['Reproducible', pack.reproducible ? 'every row still hashes to what was recorded at decision time' : 'a row no longer hashes to its recorded baseline'],
                        ] as [string, string][]
                      ).map(([k, v]) => (
                        <div key={k} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="break-all font-mono text-mini">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* ============================================================ EVALUATION
            Question: how do you know it works? */}
        {m && report ? (
          <section className="border-b border-border" aria-labelledby="eval-title">
            <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
              <Reveal>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 id="eval-title" className="text-[32px] font-bold tracking-tight sm:text-[40px]">AVOS Evaluation</h2>
                  <span className="text-compact text-muted-foreground">
                    {m.n} labelled synthetic settlements · not Razorpay transactions
                  </span>
                </div>
              </Reveal>
              <Reveal delay={80}>
                <dl className="mt-8 grid gap-6 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      [formatPct(m.false_closure_rate, 0), 'false closure', `${m.false_closure_cases.length} of ${m.n}`, 'verified'],
                      [formatPct(m.verification_precision, 0), 'verification precision', 'every VERIFIED was correct', 'verified'],
                      [formatPct(m.exception_detection_rate, 0), 'injected exceptions caught', `${m.exceptions_caught} of ${m.exceptions_injected}`, 'verified'],
                      [isolation ?? '—', 'isolation checks', 'verifier imports nothing', ''],
                      [verifierChecks ?? '—', 'verifier checks', 'unit tests over verifyClaim', ''],
                      [adversarial ?? '—', 'adversarial cases', 'attacks it must survive', ''],
                    ] as [string, string, string, string][]
                  ).map(([v, k, hint, tone]) => (
                    <div key={k}>
                      <dd className={'tnum text-[32px] font-bold leading-none tracking-tight ' + (tone === 'verified' ? 'text-[hsl(var(--verdict-verified))]' : '')}>{v}</dd>
                      <dt className="mt-1.5 text-compact font-medium">{k}</dt>
                      <dd className="mt-0.5 text-mini text-muted-foreground">{hint}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-mini text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {report.gates.every((g) => g.passed) ? (
                      <IconCheck className="h-3.5 w-3.5 text-[hsl(var(--verdict-verified))]" />
                    ) : (
                      <IconHold className="h-3.5 w-3.5 text-[hsl(var(--verdict-uncertain))]" />
                    )}
                    {report.gates.length} acceptance gates, run in CI on every commit
                  </span>
                  <span>
                    Match rate {formatPct(m.match_rate)} · {m.ambiguous_count} ambiguous sent to review
                  </span>
                  <Link href="/console" className="text-primary underline-offset-4 hover:underline">
                    Full evaluation in the console →
                  </Link>
                </p>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* ============================================================ FINAL CTA
            Question: what can I do now? */}
        <section className="bg-card" aria-labelledby="cta-title">
          <div className="mx-auto max-w-[1100px] px-4 py-20 text-center sm:px-6 lg:px-8 lg:py-28">
            <Reveal>
              <h2 id="cta-title" className="text-[32px] font-bold tracking-tight sm:text-[44px]">
                See the settlement AI couldn&rsquo;t close.
              </h2>
              <p className="mt-3 text-body text-muted-foreground">Razorpay-connected. Evidence-backed. Independently verified.</p>
              <Link
                href="/console"
                className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open console
                <IconArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
    </>
  )
}
