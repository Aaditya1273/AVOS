'use client'

import { Badge, Card, Mono, Separator, Stat } from '@/components/ui/primitives'
import { VerdictBadge, VERDICT_MEANING } from '@/components/verdict'
import { EvidenceInspector } from '@/components/evidence-inspector'
import { ReplayPanel } from '@/components/replay-panel'
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

/**
 * The Proof Card.
 *
 * One card carries the entire argument: what an agent claimed, what AVOS
 * independently computed, the raw rows it computed from, the dated policy it
 * applied, and a button to prove the whole thing again.
 *
 * The layout makes one editorial choice worth naming. The agent's rationale sits
 * directly beside the verdict, struck through and labelled as excluded. It would
 * be tidier to omit it. Showing it is the point: a reviewer sees a fluent,
 * confident, entirely plausible sentence — and sees that the system reached its
 * conclusion without reading it.
 */
export function ProofCard({
  payload,
  policyPoints,
  className,
  compact = false,
}: {
  payload: DecisionPayload
  policyPoints: PolicyPoint[]
  className?: string
  compact?: boolean
}) {
  const { decision, narration, injection } = payload
  const { result, pack, proposal } = decision

  const agentSaysReconciled = proposal.claim.proposed_status === 'RECONCILED'
  const avosDisagrees = agentSaysReconciled && result.verdict !== 'VERIFIED'

  const byPillar = (['guard', 'prove', 'verify'] as Pillar[]).map((p) => ({
    pillar: p,
    checks: result.checks.filter((c) => c.pillar === p),
  }))

  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* --- header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg font-bold tracking-tight">
            {result.settlement_id}
          </span>
          <span className="text-[12px] text-muted-foreground">{pack.merchant_id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{decision.case_id}</Badge>
          <Badge variant="outline">
            {decision.suite === 'batch_120' ? 'batch 120' : 'adversarial 30'}
          </Badge>
          <Badge variant="outline">{formatPaise(decision.batch_value_paise)}</Badge>
          {injection.found ? <Badge variant="uncertain">injection in evidence</Badge> : null}
        </div>
      </div>

      {/* --- claim vs verdict --------------------------------------------- */}
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
            Agent claim
          </span>
          <span className="font-mono text-base font-semibold">
            {proposal.claim.proposed_status}
          </span>
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-2.5">
            <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Not an input to the verdict
            </div>
            <p className="text-[12px] italic leading-relaxed text-muted-foreground line-through decoration-muted-foreground/50">
              &ldquo;{proposal.agent_reason}&rdquo;
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <Mono>{proposal.agent_version}</Mono>
            <Mono>{proposal.model_version}</Mono>
            <span className="self-center">{proposal.claim.evidence_ids.length} ids cited</span>
          </div>
        </div>

        <div className="hidden items-center justify-center md:flex">
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <div className="h-full w-px bg-border" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
            AVOS verdict
          </span>
          <VerdictBadge verdict={result.verdict} reason={result.reason_code} size="lg" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {VERDICT_MEANING[result.verdict]}
          </p>
          {avosDisagrees ? (
            <div className="rounded-md border border-[hsl(var(--verdict-failed)/0.35)] bg-[hsl(var(--verdict-failed)/0.08)] px-2.5 py-1.5 text-[11.5px] font-medium text-[hsl(var(--verdict-failed))]">
              The agent proposed closure. AVOS refused it.
            </div>
          ) : null}
        </div>
      </div>

      <Separator />

      {/* --- the arithmetic ----------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
        <Stat
          label="Expected"
          value={formatPaise(result.expected_paise)}
          hint="gross − refunds − fees − tax − holds"
        />
        <Stat label="Observed" value={formatPaise(result.observed_paise)} hint="bank credit" />
        <Stat
          label="Difference"
          value={formatDelta(result.difference_paise)}
          hint={`tolerance ${formatPaise(result.tolerance_paise)}`}
          tone={
            result.difference_paise === null
              ? 'neutral'
              : result.tolerance_paise !== null &&
                  Math.abs(result.difference_paise) <= result.tolerance_paise
                ? 'verified'
                : 'failed'
          }
        />
        <Stat
          label="Fee delta"
          value={formatDelta(result.fee_delta_paise)}
          hint="declared − payment-level"
          tone={result.fee_delta_paise ? 'failed' : 'neutral'}
        />
      </div>

      <Separator />

      {/* --- provenance ---------------------------------------------------- */}
      <div className="grid gap-x-6 gap-y-3 px-5 py-4 text-[11.5px] sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Policy applied">
          <Mono>{result.policy_version}</Mono>
          <span className="ml-1.5 text-muted-foreground">
            effective {fmtTime(result.policy_effective_at)}
          </span>
        </Field>
        <Field label="Policy stamped on pack">
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
              ≠ {pack.decision_policy_version} in force at decision
            </span>
          ) : (
            <span className="ml-1.5 text-muted-foreground">matches decision epoch</span>
          )}
        </Field>
        <Field label="Verifier">
          <Mono>{result.verifier_version}</Mono>
          <span className="ml-1.5 text-muted-foreground">no LLM on this path</span>
        </Field>
        <Field label="Event time">{fmtTime(pack.event_time)}</Field>
        <Field label="Decision time">{fmtTime(pack.decision_time)}</Field>
        <Field label="Pack hash">
          <Mono>{pack.pack_hash.slice(0, 20)}</Mono>
        </Field>
      </div>

      {/* --- what to do about it ------------------------------------------- */}
      {result.reason_code ? (
        <>
          <Separator />
          <div className="px-5 py-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                Exception note
              </span>
              <Badge variant="outline">AI · describes, never decides</Badge>
              <Badge variant="default">{narration.suggested_owner.replace('_', ' ')}</Badge>
            </div>
            <p className="text-[12.5px] leading-relaxed text-foreground/90">{narration.summary}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">→ {narration.next_action}</p>
          </div>
        </>
      ) : null}

      {!compact ? (
        <>
          <Separator />

          {/* --- the full check ledger -------------------------------------- */}
          <div className="px-5 py-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Check ledger
            </h4>
            <div className="flex flex-col gap-4">
              {byPillar.map(({ pillar, checks }) => (
                <div key={pillar}>
                  <div className="mb-1.5 text-[11px] font-medium text-foreground/70">
                    {PILLAR_LABEL[pillar]}
                  </div>
                  <div className="flex flex-col gap-1">
                    {checks.map((c) => (
                      <CheckRow key={c.id} check={c} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          <div className="px-5 py-4">
            <EvidenceInspector
              pack={pack}
              citedIds={proposal.claim.evidence_ids}
              injectionRows={injection.rows}
            />
          </div>

          <Separator />

          <div className="px-5 py-4">
            <ReplayPanel
              caseId={decision.case_id}
              decisionTime={pack.decision_time}
              policyPoints={policyPoints}
            />
          </div>

          <Separator />

          <div className="px-5 py-4">
            <QaPanel caseId={decision.case_id} />
          </div>
        </>
      ) : null}
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
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
        'flex gap-2.5 rounded px-2 py-1.5 text-[11.5px]',
        check.status === 'fail' && 'bg-[hsl(var(--verdict-failed)/0.07)]',
      )}
    >
      <span className={cn('mt-px w-3 shrink-0 text-center font-bold', tone)}>{glyph}</span>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[11px] text-foreground/80">{check.id}</span>
        <p className="mt-0.5 break-words leading-relaxed text-muted-foreground">{check.detail}</p>
      </div>
    </div>
  )
}
