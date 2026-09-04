'use client'

import { useState } from 'react'
import { Badge, Button, Mono, Separator } from '@/components/ui/primitives'
import { VerdictBadge } from '@/components/verdict'
import { formatDelta, formatPaise } from '@/lib/money'
import { cn, fmtTime } from '@/lib/utils'
import type { ReplayResult, VerificationResult } from '@/lib/types'

interface PolicyPoint {
  label: string
  at: string
  tolerance_paise: number
}

/**
 * Replay.
 *
 * The control is a policy toggle rather than a date picker, because the date is
 * not the interesting variable — the policy epoch is. Picking "12 August" means
 * nothing to a reviewer; picking "the ₹150 tolerance that was in force before
 * the merchant tightened it" means everything, and it is the same click.
 *
 * The evidence column between the two verdicts is deliberately static. Nothing
 * about the settlement changes: same rows, same hashes, same arithmetic, same
 * difference. Only the rule changed, and it changed on a date that is written
 * down. That is the entire argument for versioned policy, and showing the
 * unchanged column next to the changed verdict is the clearest way to make it.
 */
export function ReplayView({
  caseId,
  decisionTime,
  policyPoints,
  current,
}: {
  caseId: string
  decisionTime: string
  policyPoints: PolicyPoint[]
  current: VerificationResult
}) {
  const [result, setResult] = useState<ReplayResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, payload: Record<string, unknown>) {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, ...payload }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'replay failed')
      setResult(json.replay as ReplayResult)
      setActive(key)
    } catch (e) {
      setError((e as Error).message)
      setResult(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* --- the control ---------------------------------------------------- */}
      <div className="rounded-lg border border-border bg-muted/25 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h4 className="text-mini font-semibold uppercase tracking-label text-muted-foreground">
            Evaluate under policy
          </h4>
          <span className="text-mini text-muted-foreground">
            decided {fmtTime(decisionTime)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {policyPoints.map((p) => {
            const isActive = active === p.at
            return (
              <button
                key={p.at}
                type="button"
                disabled={busy !== null}
                onClick={() => run(p.at, { as_of: p.at })}
                className={cn(
                  'group flex min-w-[172px] flex-1 flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                  isActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-accent',
                )}
              >
                <span className="font-mono text-compact font-semibold">{p.label}</span>
                <span className="tnum text-mini text-muted-foreground">
                  fee tolerance {formatPaise(p.tolerance_paise)}
                </span>
                <span className="text-micro text-muted-foreground">
                  effective {fmtTime(p.at)}
                </span>
                {busy === p.at ? (
                  <span className="text-micro text-primary">evaluating…</span>
                ) : null}
              </button>
            )
          })}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('tamper', { tamper: true })}
            className={cn(
              'flex min-w-[172px] flex-1 flex-col items-start gap-0.5 rounded-md border border-dashed px-3 py-2.5 text-left transition-colors disabled:opacity-60',
              active === 'tamper'
                ? 'border-[hsl(var(--verdict-failed))] bg-[hsl(var(--verdict-failed)/0.10)]'
                : 'border-border hover:border-[hsl(var(--verdict-failed)/0.6)] hover:bg-accent',
            )}
          >
            <span className="text-compact font-semibold text-[hsl(var(--verdict-failed))]">
              Modify a source row
            </span>
            <span className="text-mini text-muted-foreground">
              perturb one credit by ₹0.01
            </span>
            <span className="text-micro text-muted-foreground">in memory; CSVs untouched</span>
            {busy === 'tamper' ? (
              <span className="text-micro text-primary">evaluating…</span>
            ) : null}
          </button>
        </div>

        <p className="mt-3 border-l-2 border-primary/60 pl-2.5 text-mini leading-relaxed text-muted-foreground">
          Historical decisions are evaluated using the policy that existed when the decision
          occurred. Replaying under a later policy answers a different question — &ldquo;would we
          take this today?&rdquo; — and AVOS keeps the two apart rather than quietly conflating them.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-[hsl(var(--verdict-failed)/0.4)] bg-[hsl(var(--verdict-failed)/0.08)] px-3 py-2 text-compact text-[hsl(var(--verdict-failed))]">
          {error}
        </div>
      ) : null}

      {/* --- the transition -------------------------------------------------- */}
      {result ? (
        // Replaying flips a verdict with no visual transition a screen reader can
        // follow, so the region announces itself. `polite` rather than
        // `assertive`: the result is important, not urgent, and interrupting
        // someone mid-sentence to say so is worse than waiting a beat.
        <div
          role="status"
          aria-live="polite"
          className="overflow-hidden rounded-lg border border-border"
        >
          <div className="grid gap-px bg-border md:grid-cols-[1fr_auto_1fr]">
            <VerdictColumn
              label="As recorded"
              sublabel={fmtTime(result.original.evaluated_as_of)}
              result={result.original}
            />

            <div className="flex items-center justify-center bg-card px-4 py-3">
              <div className="flex flex-col items-center gap-1">
                <span className="text-2xl leading-none text-muted-foreground">→</span>
                {result.verdict_changed ? (
                  <span className="text-micro font-semibold uppercase tracking-wide text-[hsl(var(--verdict-uncertain))]">
                    verdict changed
                  </span>
                ) : (
                  <span className="text-micro uppercase tracking-wide text-muted-foreground">
                    unchanged
                  </span>
                )}
              </div>
            </div>

            <VerdictColumn
              label="Replayed"
              sublabel={fmtTime(result.as_of)}
              result={result.replayed}
              highlight={result.verdict_changed}
            />
          </div>

          {/* the column that did NOT change */}
          <div className="border-t border-border bg-muted/30 px-4 py-3">
            <div className="mb-2 text-micro font-semibold uppercase tracking-label text-muted-foreground">
              Unchanged by replay
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
              <Fact label="Expected" value={formatPaise(result.replayed.expected_paise)} />
              <Fact label="Observed" value={formatPaise(result.replayed.observed_paise)} />
              <Fact label="Difference" value={formatDelta(result.replayed.difference_paise)} />
              <Fact
                label="Evidence"
                value={
                  result.reproducible ? (
                    <span className="text-[hsl(var(--verdict-verified))]">
                      {result.original.evidence_ids_used.length} rows, hashes intact
                    </span>
                  ) : (
                    <span className="text-[hsl(var(--verdict-failed))]">
                      {result.changed_evidence_ids.length} row(s) altered
                    </span>
                  )
                }
              />
            </div>
          </div>

          <Separator />

          <div className="px-4 py-3">
            <p className="text-compact leading-relaxed text-foreground/90">{result.narrative}</p>
            {result.changed_evidence_ids.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.changed_evidence_ids.map((id) => (
                  <Mono key={id} className="text-[hsl(var(--verdict-failed))]">
                    {id}
                  </Mono>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-compact text-muted-foreground">
            Pick a policy epoch above to re-evaluate {caseId}.
          </p>
          <p className="mt-1 text-mini text-muted-foreground">
            Current verdict:{' '}
            <span className="font-semibold">{current.verdict}</span>
            {current.reason_code ? ` · ${current.reason_code}` : ''} under{' '}
            <Mono>{current.policy_version}</Mono>
          </p>
        </div>
      )}
    </div>
  )
}

function VerdictColumn({
  label,
  sublabel,
  result,
  highlight,
}: {
  label: string
  sublabel: string
  result: VerificationResult
  highlight?: boolean
}) {
  return (
    <div className={cn('bg-card px-4 py-4', highlight && 'bg-accent/40')}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
          {label}
        </span>
        <span className="text-micro text-muted-foreground">{sublabel}</span>
      </div>
      <VerdictBadge verdict={result.verdict} reason={result.reason_code} size="lg" />
      <div className="mt-3 flex flex-col gap-1 text-mini">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Policy</span>
          <Mono>{result.policy_version}</Mono>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Fee tolerance</span>
          <span className="tnum">{formatPaise(result.tolerance_paise)}</span>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-micro font-medium uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <span className="tnum text-compact">{value}</span>
    </div>
  )
}

export { Badge }
