'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Badge, Button, Card } from '@/components/ui/primitives'
import { VerdictBadge } from '@/components/verdict'
import { ProofCard, type DecisionPayload } from '@/components/proof-card'
import { formatDelta, formatCompact } from '@/lib/money'
import { cn, fmtDate } from '@/lib/utils'
import type { Verdict } from '@/lib/types'

export interface CaseRow {
  case_id: string
  settlement_id: string
  merchant_id: string
  suite: 'batch_120' | 'adversarial_30'
  verdict: Verdict
  reason_code: string | null
  value_paise: number
  difference_paise: number | null
  policy_version: string
  decision_time: string
  agent_claim: string
  injection: boolean
}

interface PolicyPoint {
  label: string
  at: string
  tolerance_paise: number
}

const VERDICT_ORDER: Verdict[] = ['FAILED', 'UNCERTAIN', 'VERIFIED']

/**
 * The console: a case list, and the Proof Card for whatever is selected.
 *
 * Rows are sorted FAILED first, then UNCERTAIN, then VERIFIED. Chronological
 * order would be the obvious default and it would be wrong — nobody opens a
 * reconciliation queue to read the eighty settlements that were fine. The
 * exceptions are the work.
 *
 * Full decisions are fetched per selection rather than shipped with the page.
 * 150 packs is roughly a megabyte and a half of evidence that a reviewer will
 * look at four or five rows of.
 */
export function Console({
  rows,
  policyPoints,
  initialCaseId,
}: {
  rows: CaseRow[]
  policyPoints: PolicyPoint[]
  initialCaseId: string
}) {
  const [suite, setSuite] = useState<'batch_120' | 'adversarial_30'>('batch_120')
  const [filter, setFilter] = useState<Verdict | 'ALL'>('ALL')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(initialCaseId)
  const [payload, setPayload] = useState<DecisionPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/decision?case_id=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'could not load decision')
        if (!cancelled) setPayload(json as DecisionPayload)
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message)
          setPayload(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => r.suite === suite)
      .filter((r) => filter === 'ALL' || r.verdict === filter)
      .filter(
        (r) =>
          q === '' ||
          r.settlement_id.toLowerCase().includes(q) ||
          r.case_id.toLowerCase().includes(q) ||
          r.merchant_id.toLowerCase().includes(q) ||
          (r.reason_code ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const v = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict)
        return v !== 0 ? v : b.value_paise - a.value_paise
      })
  }, [rows, suite, filter, query])

  const counts = useMemo(() => {
    const inSuite = rows.filter((r) => r.suite === suite)
    return {
      ALL: inSuite.length,
      VERIFIED: inSuite.filter((r) => r.verdict === 'VERIFIED').length,
      UNCERTAIN: inSuite.filter((r) => r.verdict === 'UNCERTAIN').length,
      FAILED: inSuite.filter((r) => r.verdict === 'FAILED').length,
    }
  }, [rows, suite])

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* --- case list ------------------------------------------------------ */}
      <Card className="flex h-fit max-h-[calc(100vh-3rem)] flex-col overflow-hidden xl:sticky xl:top-6">
        <Tabs.Root
          value={suite}
          onValueChange={(v) => setSuite(v as typeof suite)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List className="flex shrink-0 border-b border-border">
            {(
              [
                ['batch_120', 'Batch · 120'],
                ['adversarial_30', 'Adversarial · 30'],
              ] as const
            ).map(([value, label]) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className={cn(
                  'flex-1 px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors',
                  'data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground',
                )}
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settlement, case, merchant or reason code"
              className="h-8 rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'FAILED', 'UNCERTAIN', 'VERIFIED'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium transition-colors',
                    filter === f
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  {f} {counts[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {visible.map((r) => (
              <button
                key={r.case_id}
                type="button"
                onClick={() => setSelected(r.case_id)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/60',
                  selected === r.case_id && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'h-8 w-1 shrink-0 rounded-full',
                    r.verdict === 'VERIFIED' && 'bg-[hsl(var(--verdict-verified))]',
                    r.verdict === 'UNCERTAIN' && 'bg-[hsl(var(--verdict-uncertain))]',
                    r.verdict === 'FAILED' && 'bg-[hsl(var(--verdict-failed))]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[12.5px] font-semibold">{r.settlement_id}</span>
                    {r.injection ? (
                      <span
                        className="text-[10px] text-[hsl(var(--verdict-uncertain))]"
                        title="instruction-shaped text in a free-text evidence cell"
                      >
                        ⚑
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {r.reason_code ?? 'no exception'} · {fmtDate(r.decision_time)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-[11.5px]">{formatCompact(r.value_paise)}</div>
                  {r.difference_paise ? (
                    <div className="tnum text-[10px] text-[hsl(var(--verdict-failed))]">
                      {formatDelta(r.difference_paise)}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
            {visible.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                No cases match.
              </div>
            ) : null}
          </div>
        </Tabs.Root>
      </Card>

      {/* --- proof card ------------------------------------------------------ */}
      <div className="min-w-0">
        {error ? (
          <Card className="p-6">
            <p className="text-[13px] text-[hsl(var(--verdict-failed))]">{error}</p>
            <Button className="mt-3" size="sm" onClick={() => setSelected(selected)}>
              Retry
            </Button>
          </Card>
        ) : payload ? (
          <div className={cn(loading && 'opacity-60 transition-opacity')}>
            <ProofCard payload={payload} policyPoints={policyPoints} />
          </div>
        ) : (
          <Card className="flex h-64 items-center justify-center">
            <span className="text-[13px] text-muted-foreground">Loading proof card…</span>
          </Card>
        )}
      </div>
    </div>
  )
}

/** Compact verdict tally, used in the page header. */
export function VerdictTally({ counts }: { counts: Record<Verdict, number> }) {
  return (
    <div className="flex items-center gap-2">
      {VERDICT_ORDER.map((v) => (
        <VerdictBadge key={v} verdict={v} reason={String(counts[v])} />
      ))}
    </div>
  )
}

export { Badge }
