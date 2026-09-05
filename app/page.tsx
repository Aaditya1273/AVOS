/**
 * The landing page: one settlement, followed through AVOS.
 *
 * A single scrubbed, pinned story carries the settlement from Razorpay to the
 * close gate and stops it there; the sections after it are the argument, the
 * connection, the record, the proof and the conclusion — each keeping the
 * same object and the same grammar.
 *
 * Every figure is read at request time from evaluation case B092 via
 * `materializeDecision` and from `evals/raw/metrics.json`. Nothing is typed
 * in. The decision is labelled as evaluation data wherever it appears, and
 * the only block that mentions a connection earns it by making the request.
 */

import { SiteNav } from '@/components/site-nav'
import { Story, type StoryFacts } from '@/components/landing/story'
import { EvalNumbers, EvidenceSheets, Finale, RazorpayFlow, WhyAvos, type EvalStat, type Sheet } from '@/components/landing/sections'
import { RazorpayLive } from '@/components/landing/razorpay-live'
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

  if (!d) {
    // Without the evaluation dataset there is no decision to tell. Say so.
    return (
      <>
        <SiteNav active="home" />
        <main className="mx-auto max-w-[1100px] px-4 py-24">
          <h1 className="text-3xl font-bold">AVOS</h1>
          <p className="mt-3 text-muted-foreground">
            The evaluation dataset is not present, so there is no settlement to show here. Open the console.
          </p>
        </main>
      </>
    )
  }

  const r = d.result
  const pack = d.pack
  const failed = r.checks.filter((c) => c.status === 'fail')
  const sources = [...new Set(pack.evidence.map((e) => e.source))]
  const sourceLabel = pack.evidence[0]?.provenance.label ?? 'AVOS Evaluation Dataset'
  const reasonWord = r.reason_code === 'FEE_MISMATCH' ? 'fee mismatch' : (r.reason_code ?? '').toLowerCase().replace(/_/g, ' ')

  const facts: StoryFacts = {
    amount: formatPaise(d.batch_value_paise),
    difference: formatPaise(Math.abs(r.difference_paise ?? 0)),
    expected: r.expected_paise != null ? formatPaise(r.expected_paise) : '—',
    observed: r.observed_paise != null ? formatPaise(r.observed_paise) : '—',
    tolerance: formatPaise(r.tolerance_paise ?? 0),
    proposal: d.proposal.claim.proposed_status,
    confidence: d.proposal.confidence.toFixed(2),
    reasonWord,
    reasonCode: r.reason_code ?? '',
    evidenceRows: pack.evidence.length,
    policy: r.policy_version,
    settlementId: r.settlement_id,
    caseId: d.case_id,
    sourceLabel,
  }

  const sheets: Sheet[] = [
    {
      title: 'Source',
      rows: [
        ['Dataset', sourceLabel],
        ['Case', `${d.case_id} · ${pack.merchant_id}`],
        ['Rows', `${pack.evidence.length} across ${sources.length} sources`],
      ],
    },
    {
      title: 'Policy',
      rows: [
        ['Version', r.policy_version],
        ['In force from', fmtTime(r.policy_effective_at)],
        ['Fee tolerance', formatPaise(r.tolerance_paise ?? 0)],
      ],
    },
    {
      title: 'Captured',
      rows: [
        ['Event', fmtTime(pack.event_time)],
        ['Decision', fmtTime(pack.decision_time)],
        ['Agent claim', `${d.proposal.claim.proposed_status} · ${d.proposal.confidence.toFixed(2)}`],
      ],
    },
    {
      title: 'Recomputed',
      rows: [
        ['Expected', r.expected_paise != null ? formatPaise(r.expected_paise) : '—'],
        ['Observed', r.observed_paise != null ? formatPaise(r.observed_paise) : '—'],
        ['Difference', formatDelta(r.difference_paise)],
      ],
    },
    {
      title: 'Verifier',
      rows: [
        ['Version', `AVOS ${r.verifier_version}`],
        ['Checks', `${r.checks.length} run · ${failed.length} failed`],
        ['Failed', failed.map((c) => c.id).join(', ') || '—'],
      ],
    },
  ]

  const technical: [string, string][] = [
    ['Evidence pack hash', pack.pack_hash],
    ['Evidence rows', `${pack.evidence.length} · ${sources.join(' · ')}`],
    ['Policy fee', `${formatPaise(r.policy_fee_paise ?? 0)} from the rate card · declared fee ${formatDelta(r.fee_delta_paise)} against it`],
    ['Verifier', `${r.verifier_version} — zero runtime imports, asserted on every evaluation run`],
    ['Reproducible', pack.reproducible ? 'every row still hashes to what was recorded at decision time' : 'a row no longer hashes to its recorded baseline'],
    ['Resolution', d.closure.required_evidence[0] ?? d.closure.summary],
  ]

  const verifierGate = report?.gates.find((g) => /verifier unit tests/i.test(g.name))
  const stats: EvalStat[] = m && report
    ? [
        { value: formatPct(m.false_closure_rate, 0), label: 'false closure', hint: `${m.false_closure_cases.length} of ${m.n}`, tone: 'verified' },
        { value: formatPct(m.verification_precision, 0), label: 'verification precision', hint: 'every VERIFIED was correct', tone: 'verified' },
        { value: formatPct(m.exception_detection_rate, 0), label: 'injected exceptions caught', hint: `${m.exceptions_caught} of ${m.exceptions_injected}`, tone: 'verified' },
        { value: `${report.isolation.filter((i) => i.passed).length}/${report.isolation.length}`, label: 'isolation checks', hint: 'verifier imports nothing' },
        { value: verifierGate?.detail.match(/(\d+)\/(\d+)/)?.[0] ?? '—', label: 'verifier checks', hint: 'unit tests over verifyClaim' },
        { value: `${report.adversarial_tests.filter((t) => t.passed).length}/${report.adversarial_tests.length}`, label: 'adversarial coverage', hint: 'attacks it must survive' },
      ]
    : []

  return (
    <>
      <SiteNav active="home" />
      <main className="bg-background">
        <Story facts={facts} />
        <WhyAvos />
        <div id="how" className="scroll-mt-14">
          <RazorpayFlow>
            <RazorpayLive />
            <div className="mt-6 grid gap-3 text-compact sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-background px-4 py-3">
                <div className="font-semibold">Real Razorpay data</div>
                <p className="mt-1 text-muted-foreground">
                  Whatever the API returns above — settlements, recon rows, payments, refunds — is what the console verifies. A test
                  account with no transactions returns zero, and zero is what is shown.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-4 py-3">
                <div className="font-semibold">AVOS Evaluation Dataset</div>
                <p className="mt-1 text-muted-foreground">
                  {m ? `${m.n} synthetic, labelled settlements` : 'Synthetic, labelled settlements'} used to prove the verifier. The
                  settlement followed on this page is one of them, and is labelled as such everywhere it appears.
                </p>
              </div>
            </div>
          </RazorpayFlow>
        </div>
        <EvidenceSheets sheets={sheets} verdict={`${r.verdict} · not closed`} technical={technical} />
        {m && report ? (
          <EvalNumbers
            stats={stats}
            n={m.n}
            footer={
              <span>
                {report.gates.length} acceptance gates run in CI on every commit · match rate {formatPct(m.match_rate)} ·{' '}
                {m.ambiguous_count} ambiguous sent to review · full evaluation in the console.
              </span>
            }
          />
        ) : null}
        <Finale amount={facts.amount} difference={facts.difference} reasonWord={reasonWord} />
      </main>
    </>
  )
}
