'use client'

import { Sheet } from '@/components/ui/sheet'
import { Mono } from '@/components/ui/primitives'
import { IconCheck, IconCross, IconHold } from '@/components/ui/icon'
import { formatDelta, formatPaise } from '@/lib/money'
import { fmtTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { SOURCE_LABEL, money, nextAction, reasonLabel, reasonLine, statusLabel, type DetailModel } from './model'

/**
 * "View why". Everything an operator needs to understand a decision, in the
 * order they need it: what AVOS decided and about how much money, what the
 * model had proposed, where the data came from, the arithmetic, the policy,
 * which check failed and what it means, what would make the record closeable —
 * and only then, collapsed, the identifiers and hashes an auditor will want.
 */
export function WhySheet({ detail, open, onClose }: { detail: DetailModel | null; open: boolean; onClose: () => void }) {
  const title = detail ? (detail.record.status === 'VERIFIED' ? 'Why this can close' : 'Why this was held') : 'Why'
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {detail ? <WhyBody d={detail} /> : null}
    </Sheet>
  )
}

function WhyBody({ d }: { d: DetailModel }) {
  const { record: r, result, proposal, pack, closure } = d
  const status = statusLabel(r.status)
  const tone = r.status === 'VERIFIED' ? 'verified' : r.status === 'UNCERTAIN' ? 'uncertain' : r.status === 'FAILED' ? 'failed' : 'muted'
  const Icon = r.status === 'VERIFIED' ? IconCheck : r.status === 'UNCERTAIN' ? IconHold : IconCross

  return (
    <div className="px-5 py-5">
      {/* Header: verdict, money, reason. */}
      <div className={cn('rounded-lg border p-4', toneBorder(tone))}>
        <div className={cn('inline-flex items-center gap-2 text-[15px] font-semibold', toneText(tone))}>
          <Icon className="h-4 w-4" strokeWidth={2.25} /> {status.title.toUpperCase()}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tnum text-[32px] font-bold leading-none tracking-tight">{money(r.amount_paise)}</span>
          <span className={cn('text-[15px] font-semibold', toneText(tone))}>{status.sub.toUpperCase()}</span>
        </div>
        {r.reason_code ? (
          <p className="mt-2 text-[14px] text-muted-foreground">
            Reason: <span className="tnum font-medium text-foreground">{reasonLine(r)}</span>
          </p>
        ) : r.status === 'VERIFIED' ? (
          <p className="mt-2 text-[14px] text-muted-foreground">Evidence matched under the policy in force at decision time.</p>
        ) : null}
      </div>

      {/* 1. Agent proposal */}
      <Section n={1} title="Agent proposal">
        {proposal ? (
          <>
            <div className="text-[15px] font-semibold">
              {proposal.claim.proposed_status} <span className="tnum font-normal text-muted-foreground">· {Math.round(proposal.confidence * 100)}%</span>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              The agent proposed {proposal.claim.proposed_status === 'RECONCILED' ? 'the closure' : 'this status'}. Its confidence is not used as proof.
            </p>
            {proposal.agent_reason ? (
              <p className="mt-2 border-l-2 border-border pl-3 text-[13px] italic text-muted-foreground line-through decoration-muted-foreground/50">
                {proposal.agent_reason}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">No proposal. No model was available, and AVOS does not substitute one.</p>
        )}
      </Section>

      {/* 2. Source */}
      <Section n={2} title="Source">
        <div className="text-[15px] font-medium">{SOURCE_LABEL[r.source]}</div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {pack.evidence.length} evidence rows · captured {fmtTime(pack.event_time)} · decided {fmtTime(pack.decision_time)}
        </p>
        {r.source === 'evaluation' ? (
          <p className="mt-1 text-[12px] text-muted-foreground">Synthetic, labelled evaluation data — not a Razorpay transaction.</p>
        ) : null}
      </Section>

      {/* 3. Financial proof */}
      {result ? (
        <Section n={3} title="Financial proof">
          <dl className="divide-y divide-border rounded-lg border border-border">
            <Row k="Expected" v={result.expected_paise != null ? formatPaise(result.expected_paise) : '—'} />
            <Row k="Observed" v={result.observed_paise != null ? formatPaise(result.observed_paise) : '—'} />
            <Row k="Difference" v={formatDelta(result.difference_paise)} strong tone={result.difference_paise ? 'failed' : undefined} />
            {result.policy_fee_paise != null ? <Row k="Policy fee" v={formatPaise(result.policy_fee_paise)} /> : null}
            {result.fee_delta_paise != null ? <Row k="Fee delta" v={formatDelta(result.fee_delta_paise)} tone={result.fee_delta_paise ? 'failed' : undefined} /> : null}
            {result.tolerance_paise != null ? <Row k="Tolerance" v={formatPaise(result.tolerance_paise)} /> : null}
          </dl>
        </Section>
      ) : null}

      {/* 4. Policy */}
      {result ? (
        <Section n={4} title="Policy">
          <div className="text-[15px] font-medium">Rate card and tolerances in force at decision time</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {result.policy_version} · effective {fmtTime(result.policy_effective_at)}
            {result.tolerance_paise != null ? ` · fee tolerance ${formatPaise(result.tolerance_paise)}` : ''}
          </p>
        </Section>
      ) : null}

      {/* 5. Verification */}
      {result ? (
        <Section n={5} title="Verification">
          {d.failedChecks.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              All {result.checks.length} checks passed. The recomputed amounts, fees and dates agree with the evidence.
            </p>
          ) : (
            <ul className="space-y-2">
              {d.failedChecks.map((c) => (
                <li key={c.id} className="rounded-md border border-[hsl(var(--verdict-failed)/0.3)] bg-[hsl(var(--verdict-failed)/0.05)] p-3">
                  <div className="text-[13px] font-semibold text-[hsl(var(--verdict-failed))]">{humanCheck(c.id)}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{c.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {d.narration ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {d.narration.summary} <span className="text-foreground/80">→ {d.narration.next_action}</span>
            </p>
          ) : null}
        </Section>
      ) : (
        <Section n={3} title="Verification">
          <p className="text-[13px] text-muted-foreground">Not run: there is no claim to verify until a model proposes one.</p>
        </Section>
      )}

      {/* 6. What would make it closeable */}
      {closure && closure.status !== 'CLOSED' ? (
        <Section n={6} title="What would make it closeable">
          <div className="text-[15px] font-medium">{nextAction(r)}</div>
          {closure.required_evidence.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
              {closure.required_evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">{closure.summary}</p>
          )}
        </Section>
      ) : null}

      {/* 7. Technical details, collapsed */}
      <details className="group mt-6 rounded-lg border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
          Technical details
          <span className="text-[12px] text-muted-foreground group-open:hidden">hashes, identifiers, versions</span>
        </summary>
        <dl className="divide-y divide-border border-t border-border text-[13px]">
          <Tech k="Settlement" v={r.settlement_id} />
          <Tech k="Case" v={r.case_id} />
          <Tech k="Evidence pack hash" v={pack.pack_hash} />
          <Tech k="Policy version" v={result?.policy_version ?? pack.policy_snapshot.version} />
          <Tech k="Verifier" v={result?.verifier_version ?? '—'} />
          <Tech k="Agent" v={proposal ? `${proposal.agent_version} · ${proposal.model_version}` : '—'} />
          <Tech k="Checks" v={result ? `${result.checks.length} run · ${d.failedChecks.length} failed` : '—'} />
          <Tech k="Reproducible" v={pack.reproducible ? 'every row hashes to its recorded baseline' : 'a row differs from its recorded baseline'} />
          <Tech k="Evidence" v={pack.evidence.map((e) => e.evidence_id).join(', ')} />
        </dl>
      </details>

      {r.reason_code ? <p className="sr-only">Reason code {r.reason_code}: {reasonLabel(r.reason_code)}.</p> : null}
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">
        {n}. {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: 'failed' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="text-[13px] text-muted-foreground">{k}</dt>
      <dd className={cn('tnum text-[14px]', strong && 'text-[16px] font-semibold', tone === 'failed' && 'text-[hsl(var(--verdict-failed))]')}>{v}</dd>
    </div>
  )
}

function Tech({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid gap-1 px-4 py-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all">
        <Mono>{v}</Mono>
      </dd>
    </div>
  )
}

/** Check ids are engineering names. Operators get a sentence. */
function humanCheck(id: string): string {
  const map: Record<string, string> = {
    arithmetic_reconciles: 'The recomputed settlement does not equal the bank credit',
    fee_within_tolerance: 'Declared fees differ from the rate card by more than the tolerance',
    bank_credit_present: 'No bank credit was found for this settlement',
    no_duplicate_utr: 'The bank reference appears on more than one settlement',
    evidence_fresh: 'Evidence is older than the policy allows',
    policy_in_force: 'The decision was stamped with a policy not in force at decision time',
    evidence_hashes_match: 'Evidence no longer matches what was recorded at decision time',
  }
  return map[id] ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function toneText(t: string): string {
  return t === 'verified' ? 'text-[hsl(var(--verdict-verified))]' : t === 'uncertain' ? 'text-[hsl(var(--verdict-uncertain))]' : t === 'failed' ? 'text-[hsl(var(--verdict-failed))]' : 'text-muted-foreground'
}
function toneBorder(t: string): string {
  return t === 'verified' ? 'border-[hsl(var(--verdict-verified)/0.35)]' : t === 'uncertain' ? 'border-[hsl(var(--verdict-uncertain)/0.35)]' : t === 'failed' ? 'border-[hsl(var(--verdict-failed)/0.35)]' : 'border-border'
}
