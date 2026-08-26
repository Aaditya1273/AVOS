'use client'

import { useState } from 'react'
import { Button, Mono, Separator } from '@/components/ui/primitives'
import { VerdictBadge } from '@/components/verdict'
import { formatPaise } from '@/lib/money'
import { fmtTime } from '@/lib/utils'
import type { ReplayResult } from '@/lib/types'

interface PolicyPoint {
  label: string
  at: string
  tolerance_paise: number
}

/**
 * Replay controls.
 *
 * The presets are generated from the policy snapshots rather than hard-coded, so
 * adding a policy version adds a button. A demo with two hand-written dates in
 * it stops being a demo of replay and becomes a demo of two dates.
 */
export function ReplayPanel({
  caseId,
  decisionTime,
  policyPoints,
}: {
  caseId: string
  decisionTime: string
  policyPoints: PolicyPoint[]
}) {
  const [result, setResult] = useState<ReplayResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(label: string, payload: Record<string, unknown>) {
    setBusy(label)
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
    } catch (e) {
      setError((e as Error).message)
      setResult(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="mr-1 text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Replay
        </h4>

        <Button
          size="xs"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => run('as-recorded', {})}
        >
          {busy === 'as-recorded' ? '…' : 'As recorded'}
        </Button>

        {policyPoints.map((p) => (
          <Button
            key={p.at}
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run(p.at, { as_of: p.at })}
            title={`Evaluate under ${p.label}, fee tolerance ${formatPaise(p.tolerance_paise)}`}
          >
            {busy === p.at ? '…' : `As of ${p.label}`}
          </Button>
        ))}

        <Button
          size="xs"
          variant="destructive"
          disabled={busy !== null}
          onClick={() => run('tamper', { tamper: true })}
          title="Perturb one evidence row in memory and re-verify. The CSVs on disk are not modified."
        >
          {busy === 'tamper' ? '…' : 'Modify a source row'}
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Decision taken {fmtTime(decisionTime)}. Historical decisions are evaluated using the policy
        that existed when the decision occurred — replaying under a later policy answers a different
        question, and AVOS keeps the two apart.
      </p>

      {error ? (
        <div className="rounded-md border border-[hsl(var(--verdict-failed)/0.4)] bg-[hsl(var(--verdict-failed)/0.08)] px-3 py-2 text-[12px] text-[hsl(var(--verdict-failed))]">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-md border border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
                As recorded
              </span>
              <VerdictBadge
                verdict={result.original.verdict}
                reason={result.original.reason_code}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.original.policy_version} · tol {formatPaise(result.original.tolerance_paise)}
              </span>
            </div>

            <span className="text-xl text-muted-foreground">→</span>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
                Replayed as of {fmtTime(result.as_of)}
              </span>
              <VerdictBadge
                verdict={result.replayed.verdict}
                reason={result.replayed.reason_code}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.replayed.policy_version} · tol {formatPaise(result.replayed.tolerance_paise)}
              </span>
            </div>

            <div className="ml-auto flex flex-col gap-1 text-right">
              <span className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
                Difference
              </span>
              <span className="tnum text-base font-semibold">
                {formatPaise(result.replayed.difference_paise)}
              </span>
              <span className="text-[10px] text-muted-foreground">unchanged by replay</span>
            </div>
          </div>

          <Separator className="my-3" />

          <p className="text-[12px] leading-relaxed text-foreground/90">{result.narrative}</p>

          {result.changed_evidence_ids.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {result.changed_evidence_ids.map((id) => (
                <Mono key={id} className="text-[hsl(var(--verdict-failed))]">
                  {id}
                </Mono>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
