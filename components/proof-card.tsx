'use client'

import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Badge, Card, Mono, Separator } from '@/components/ui/primitives'
import { VerdictBadge, VERDICT_MEANING } from '@/components/verdict'
import { EvidenceInspector } from '@/components/evidence-inspector'
import { ReplayView } from '@/components/replay-view'
import { QaPanel } from '@/components/qa-panel'
import { formatDelta, formatPaise } from '@/lib/money'
import { cn, fmtTime } from '@/lib/utils'
import type { ExceptionNarration } from '@/lib/ai/classify'
import type { CheckResult, Decision, Pillar } from '@/lib/types'

export interface DecisionPayload {
  decision: Decision
  narration: ExceptionNarration
  injection: { found: boolean; rows: string[] }
}

interface PolicyPoint {
  label: string
  at: string
  tolerance_paise: number
}

const PILLAR_LABEL: Record<Pillar, string> = {
  guard: 'Guard — permissible under the policy in force?',
  prove: 'Prove — is the evidence complete and unchanged?',
  verify: 'Verify — does the money actually reconcile?',
}

const TABS = [
  ['proof', 'Proof'],
  ['evidence', 'Evidence'],
  ['replay', 'Replay'],
  ['ask', 'Ask'],
] as const

/**
 * The Proof Card.
 *
 * One card carries the whole argument: what an agent claimed and how sure it
 * said it was, what AVOS independently computed, the raw rows it computed from,
 * the dated policy it applied, and a control to prove the thing again under a
 * different epoch.
 *
 * The editorial choice worth naming is the left column. The agent's rationale
 * sits directly beside the verdict, struck through, next to a confidence score
 * that the eval shows separates nothing. It would be tidier to omit both.
 * Showing them is the product: a reviewer sees a fluent, specific, 0.94-confident
 * justification, and sees that the system reached its conclusion without reading
 * a word of it.
 */
export function ProofCard({
  payload,
  policyPoints,
  className,
}: {
  payload: DecisionPayload
  policyPoints: PolicyPoint[]
  className?: string
}) {
  const { decision, narration, injection } = payload
  const { result, pack, proposal } = decision
  const [tab, setTab] = useState<string>('proof')

  const agentSaysReconciled = proposal.claim.proposed_status === 'RECONCILED'
  const avosDisagrees = agentSaysReconciled && result.verdict !== 'VERIFIED'
  const failedChecks = result.checks.filter((c) => c.status === 'fail').length

  const byPillar = (['guard', 'prove', 'verify'] as Pillar[]).map((p) => ({
    pillar: p,
    checks: result.checks.filter((c) => c.pillar === p),
  }))

  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* --- identity bar --------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-muted/60 to-transparent px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-lg font-bold tracking-tight">{result.settlement_id}</h2>
          <span className="text-compact text-muted-foreground">{pack.merchant_id}</span>
          <span className="tnum text-compact font-medium">
            {formatPaise(decision.batch_value_paise)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{decision.case_id}</Badge>
          <Badge variant="outline">
            {decision.suite === 'batch_120' ? 'batch 120' : 'adversarial 30'}
          </Badge>
          {injection.found ? <Badge variant="uncertain">⚑ injection in evidence</Badge> : null}
        </div>
      </div>

      {/* --- claim vs verdict ------------------------------------------------ */}
      <div className="grid gap-0 md:grid-cols-2">
        <div className="flex flex-col gap-2.5 border-b border-border p-5 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
              Agent claim
            </span>
            <Badge variant="outline">{proposal.used_mock ? 'offline mock' : 'live model'}</Badge>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xl font-bold">{proposal.claim.proposed_status}</span>
            <span className="tnum text-compact text-muted-foreground">
              confidence {proposal.confidence.toFixed(2)}
            </span>
          </div>

          {/* confidence bar — deliberately styled as inert */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-muted-foreground/40"
              style={{ width: `${Math.round(proposal.confidence * 100)}%` }}
            />
          </div>

          <div className="rounded-md border border-dashed border-border bg-muted/25 p-3">
            <div className="mb-1.5 text-micro font-semibold uppercase tracking-label text-muted-foreground">
              Severed at the boundary — not inputs to the verdict
            </div>
            <p className="text-compact italic leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">
              &ldquo;{proposal.agent_reason}&rdquo;
            </p>
            <p className="mt-1.5 text-mini leading-relaxed text-muted-foreground">
              The rationale and the confidence score both travel on the proposal.
              <code className="mx-1 font-mono">StructuredClaim</code> has three fields and neither
              is one of them.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-micro text-muted-foreground">
            <Mono>{proposal.agent_version}</Mono>
            <Mono>{proposal.model_version}</Mono>
            <span>{proposal.claim.evidence_ids.length} ids cited</span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
              AVOS verdict
            </span>
            <span className="text-micro text-muted-foreground">
              {failedChecks > 0
                ? `${failedChecks} of ${result.checks.length} checks failed`
                : `${result.checks.length} checks`}
            </span>
          </div>

          <VerdictBadge verdict={result.verdict} reason={result.reason_code} size="lg" />

          {/* What the system DID, as distinct from what it concluded. A verdict
              is an opinion about evidence; a closure is a state change to the
              books, and a finance operator needs the second one. */}
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-2',
              decision.closure.status === 'CLOSED' &&
                'border-[hsl(var(--verdict-verified)/0.4)] bg-[hsl(var(--verdict-verified)/0.10)]',
              decision.closure.status === 'REFUSED_TO_CLOSE' &&
                'border-[hsl(var(--verdict-uncertain)/0.45)] bg-[hsl(var(--verdict-uncertain)/0.10)]',
              decision.closure.status === 'FAILED' &&
                'border-[hsl(var(--verdict-failed)/0.45)] bg-[hsl(var(--verdict-failed)/0.10)]',
            )}
          >
            <span
              className={cn(
                'text-body font-bold tracking-tight',
                decision.closure.status === 'CLOSED' && 'text-[hsl(var(--verdict-verified))]',
                decision.closure.status === 'REFUSED_TO_CLOSE' &&
                  'text-[hsl(var(--verdict-uncertain))]',
                decision.closure.status === 'FAILED' && 'text-[hsl(var(--verdict-failed))]',
              )}
            >
              {/* Three states, not two. A refusal means AVOS could not tell; an
                  exception means it could, and the answer was no. Collapsing
                  them tells a finance operator the wrong thing about what to do
                  next — chase evidence, or chase the money. */}
              {decision.closure.status === 'CLOSED'
                ? '✓ CLOSED'
                : decision.closure.status === 'REFUSED_TO_CLOSE'
                  ? '⛔ REFUSED TO CLOSE'
                  : '✕ EXCEPTION — NOT CLOSED'}
            </span>
            <span className="tnum text-mini text-muted-foreground">
              {decision.closure.status === 'CLOSED'
                ? `${formatPaise(decision.closure.value_paise)} posted`
                : `${formatPaise(decision.closure.value_paise)} held back`}
            </span>
          </div>

          <p className="text-mini leading-relaxed text-muted-foreground">
            {decision.closure.summary}
          </p>

          {avosDisagrees ? (
            <div className="rounded-md border border-[hsl(var(--verdict-failed)/0.35)] bg-[hsl(var(--verdict-failed)/0.08)] px-3 py-2 text-compact font-medium text-[hsl(var(--verdict-failed))]">
              The agent proposed closure at {proposal.confidence.toFixed(2)} confidence. AVOS
              refused it.
            </div>
          ) : null}

          {decision.closure.required_evidence.length > 0 ? (
            <div className="rounded-md border border-dashed border-[hsl(var(--verdict-uncertain)/0.45)] bg-[hsl(var(--verdict-uncertain)/0.06)] p-3">
              <div className="mb-1.5 text-micro font-semibold uppercase tracking-label text-[hsl(var(--verdict-uncertain))]">
                What would make this closeable
              </div>
              <ul className="flex flex-col gap-1">
                {decision.closure.required_evidence.map((r) => (
                  <li key={r} className="flex gap-2 text-mini leading-relaxed text-foreground/85">
                    <span className="text-muted-foreground">→</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.reason_code ? (
            <div className="mt-auto rounded-md border border-border bg-muted/25 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                  Exception note
                </span>
                <Badge variant="outline">AI · describes, never decides</Badge>
                <Badge variant="default">{narration.suggested_owner.replace('_', ' ')}</Badge>
              </div>
              <p className="text-compact leading-relaxed text-foreground/90">{narration.summary}</p>
              <p className="mt-1 text-mini text-muted-foreground">→ {narration.next_action}</p>
            </div>
          ) : null}
        </div>
      </div>

      <Separator />

      {/* --- the arithmetic --------------------------------------------------- */}
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-5">
        <Figure label="Expected" value={formatPaise(result.expected_paise)} hint="recomputed" />
        <Figure label="Observed" value={formatPaise(result.observed_paise)} hint="bank credit" />
        <Figure
          label="Difference"
          value={formatDelta(result.difference_paise)}
          hint={`tolerance ${formatPaise(result.tolerance_paise)}`}
          tone={
            result.difference_paise === null
              ? undefined
              : result.tolerance_paise !== null &&
                  Math.abs(result.difference_paise) <= result.tolerance_paise
                ? 'ok'
                : 'bad'
          }
        />
        <Figure
          label="Policy fee"
          value={formatPaise(result.policy_fee_paise)}
          hint="from rate card"
        />
        <Figure
          label="Fee delta"
          value={formatDelta(result.fee_delta_paise)}
          hint="declared − rate card"
          tone={result.fee_delta_paise ? 'bad' : undefined}
        />
      </div>

      {/* The matching stage — how the bank credit in this pack was arrived at.
          Shown because "which credit belongs here" is a decision someone made,
          and a decision nobody wrote down is a decision nobody can audit. */}
      {pack.match ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-muted/20 px-5 py-2.5 text-mini">
          <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
            Match
          </span>
          <Badge
            variant={
              pack.match.status === 'MATCHED'
                ? 'verified'
                : pack.match.status === 'AMBIGUOUS'
                  ? 'uncertain'
                  : 'failed'
            }
          >
            {pack.match.status}
          </Badge>
          {pack.match.matched_row_ids.length > 0 ? (
            <span className="font-mono text-mini">{pack.match.matched_row_ids.join(', ')}</span>
          ) : null}
          <span className="tnum text-muted-foreground">
            score {pack.match.confidence.toFixed(2)}
          </span>
          <span className="font-mono text-micro text-muted-foreground">
            {pack.match.reasons.join(' · ')}
          </span>
          <span className="ml-auto font-mono text-micro text-muted-foreground">
            {pack.match.matcher_version} · {pack.match.candidates.length} candidates scored
          </span>
        </div>
      ) : null}

      {/* --- provenance ------------------------------------------------------- */}
      <div className="grid gap-x-6 gap-y-3 border-b border-border px-5 py-4 text-mini sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Policy applied">
          <Mono>{result.policy_version}</Mono>
          <span className="ml-1.5 text-muted-foreground">
            tolerance {formatPaise(result.tolerance_paise)}
          </span>
        </Field>
        <Field label="Stamped on pack">
          <Mono
            className={cn(
              pack.recorded_policy_version !== pack.decision_policy_version &&
                'text-[hsl(var(--verdict-uncertain))]',
            )}
          >
            {pack.recorded_policy_version}
          </Mono>
          {pack.recorded_policy_version !== pack.decision_policy_version ? (
            <span className="ml-1.5 text-[hsl(var(--verdict-uncertain))]">
              ≠ {pack.decision_policy_version} at decision
            </span>
          ) : (
            <span className="ml-1.5 text-muted-foreground">matches decision epoch</span>
          )}
        </Field>
        <Field label="Verifier">
          <Mono>{result.verifier_version}</Mono>
          <span className="ml-1.5 text-muted-foreground">zero LLM imports</span>
        </Field>
        <Field label="Event time">{fmtTime(pack.event_time)}</Field>
        <Field label="Decision time">{fmtTime(pack.decision_time)}</Field>
        <Field label="Pack hash">
          <Mono>{pack.pack_hash.slice(0, 20)}</Mono>
        </Field>
      </div>

      {/* --- tabs -------------------------------------------------------------- */}
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex border-b border-border bg-muted/20">
          {TABS.map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                'relative px-4 py-2.5 text-compact font-medium text-muted-foreground transition-colors hover:text-foreground',
                'data-[state=active]:text-foreground',
                'data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary',
              )}
            >
              {label}
              {value === 'evidence' ? (
                <span className="ml-1.5 text-micro text-muted-foreground">
                  {pack.evidence.length}
                </span>
              ) : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="proof" className="px-5 py-4 focus-visible:outline-none">
          <div className="flex flex-col gap-4">
            {byPillar.map(({ pillar, checks }) => (
              <div key={pillar}>
                <div className="mb-1.5 text-mini font-medium text-foreground/70">
                  {PILLAR_LABEL[pillar]}
                </div>
                <div className="flex flex-col gap-0.5">
                  {checks.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Tabs.Content>

        <Tabs.Content value="evidence" className="px-5 py-4 focus-visible:outline-none">
          <EvidenceInspector
            pack={pack}
            checks={result.checks}
            citedIds={proposal.claim.evidence_ids}
            injectionRows={injection.rows}
          />
        </Tabs.Content>

        <Tabs.Content value="replay" className="px-5 py-4 focus-visible:outline-none">
          <ReplayView
            caseId={decision.case_id}
            decisionTime={pack.decision_time}
            policyPoints={policyPoints}
            current={result}
          />
        </Tabs.Content>

        <Tabs.Content value="ask" className="px-5 py-4 focus-visible:outline-none">
          <QaPanel caseId={decision.case_id} />
        </Tabs.Content>
      </Tabs.Root>
    </Card>
  )
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'ok' | 'bad'
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-micro font-medium uppercase tracking-label text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'tnum mt-0.5 text-figure font-semibold leading-tight',
          tone === 'ok' && 'text-[hsl(var(--verdict-verified))]',
          tone === 'bad' && 'text-[hsl(var(--verdict-failed))]',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-micro text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-micro font-medium uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <span className="leading-snug">{children}</span>
    </div>
  )
}

function CheckRow({ check }: { check: CheckResult }) {
  const glyph = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✕' : '–'
  const tone =
    check.status === 'pass'
      ? 'text-[hsl(var(--verdict-verified))]'
      : check.status === 'fail'
        ? 'text-[hsl(var(--verdict-failed))]'
        : 'text-muted-foreground'
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded px-2 py-1.5 text-mini',
        check.status === 'fail' && 'bg-[hsl(var(--verdict-failed)/0.07)]',
        check.status === 'skipped' && 'opacity-70',
      )}
    >
      <span className={cn('mt-px w-3 shrink-0 text-center font-bold', tone)}>{glyph}</span>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-mini text-foreground/80">{check.id}</span>
        <p className="mt-0.5 break-words leading-relaxed text-muted-foreground">{check.detail}</p>
      </div>
    </div>
  )
}
