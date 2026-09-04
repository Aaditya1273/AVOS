'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Badge, Card } from '@/components/ui/primitives'
import { ProofCard, type DecisionPayload } from '@/components/proof-card'
import { formatCompact, formatDelta } from '@/lib/money'
import { IconFlag } from '@/components/ui/icon'
import { cn, fmtDate } from '@/lib/utils'
import type { Verdict } from '@/lib/types'

export interface CaseRow {
  case_id: string
  settlement_id: string
  merchant_id: string
  suite: 'batch_120' | 'adversarial_30' | 'hard_slice_20'
  verdict: Verdict
  reason_code: string | null
  value_paise: number
  difference_paise: number | null
  policy_version: string
  decision_time: string
  agent_claim: string
  confidence: number
  injection: boolean
}

interface PolicyPoint {
  label: string
  at: string
  tolerance_paise: number
}

const VERDICT_ORDER: Verdict[] = ['FAILED', 'UNCERTAIN', 'VERIFIED']

/**
 * The console: an exception queue on the left, the Proof Card for the selection
 * on the right.
 *
 * Rows sort FAILED first, then UNCERTAIN, then VERIFIED, and by value within
 * each. Chronological would be the obvious default and it would be wrong —
 * nobody opens a reconciliation queue to read the eighty settlements that were
 * fine. The exceptions are the work, and the largest exception is the most work.
 *
 * Arrow keys move the selection, because anyone doing this for an hour will not
 * be reaching for a mouse.
 *
 * Full decisions are fetched per selection rather than shipped with the page:
 * 150 packs is well over a megabyte of evidence a reviewer will open five rows
 * of.
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const move = useCallback(
    (delta: number) => {
      const i = visible.findIndex((r) => r.case_id === selected)
      const next = visible[Math.max(0, Math.min(visible.length - 1, (i < 0 ? 0 : i) + delta))]
      if (next) setSelected(next.case_id)
    },
    [visible, selected],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        move(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move])

  // Keep the selected row in view when the user moves — but NOT on mount.
  //
  // Without the guard this fires during first paint and scrolls the whole page,
  // so someone opening the app lands halfway down it with the product identity
  // and the metrics already off screen. An interface that scrolls itself before
  // the reader has done anything has taken a decision that was not its to take.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-case="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      {/* --- exception queue -------------------------------------------------- */}
      <Card className="flex max-h-[70vh] flex-col overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
        <Tabs.Root
          value={suite}
          onValueChange={(v) => setSuite(v as typeof suite)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List className="flex shrink-0 border-b border-border">
            {(
              [
                ['batch_120', 'Batch', 120],
                ['adversarial_30', 'Adversarial', 30],
              ] as const
            ).map(([value, label, n]) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className={cn(
                  'relative flex-1 px-4 py-2.5 text-compact font-medium text-muted-foreground transition-colors hover:text-foreground',
                  'data-[state=active]:text-foreground',
                  'data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary',
                )}
              >
                {label} <span className="text-micro text-muted-foreground">{n}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settlement, case, merchant, reason code"
              className="h-8 rounded-md border border-border bg-background px-2.5 text-compact outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
            />
            {/* Scrolls rather than clips. At 390px these four pills do not fit,
                and the previous flex row silently cut "Verified" in half. */}
            <div className="scroll-x-clean -mx-1 flex gap-1 px-1">
              {(['ALL', 'FAILED', 'UNCERTAIN', 'VERIFIED'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'shrink-0 flex-1 whitespace-nowrap rounded border px-2 py-1 text-micro font-medium transition-colors',
                    filter === f
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  {f === 'ALL' ? 'All' : f[0] + f.slice(1).toLowerCase()}
                  <span className="ml-1 tabular-nums opacity-70">{counts[f]}</span>
                </button>
              ))}
            </div>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {visible.map((r) => (
              <button
                key={r.case_id}
                data-case={r.case_id}
                type="button"
                onClick={() => setSelected(r.case_id)}
                className={cn(
                  'flex w-full items-stretch gap-0 border-b border-border/40 text-left transition-colors hover:bg-accent/50',
                  selected === r.case_id && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'w-[3px] shrink-0',
                    r.verdict === 'VERIFIED' && 'bg-[hsl(var(--verdict-verified))]',
                    r.verdict === 'UNCERTAIN' && 'bg-[hsl(var(--verdict-uncertain))]',
                    r.verdict === 'FAILED' && 'bg-[hsl(var(--verdict-failed))]',
                  )}
                />
                <span className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-mono text-compact font-semibold">
                        {r.settlement_id}
                      </span>
                      {r.injection ? (
                        <span
                          className="text-micro text-[hsl(var(--verdict-uncertain))]"
                          title="instruction-shaped text in a free-text cell"
                        >
                          ⚑
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-micro text-muted-foreground">
                      <span className="truncate">{r.reason_code ?? 'clean'}</span>
                      <span className="opacity-50">·</span>
                      <span>{fmtDate(r.decision_time)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-mini">
                      {formatCompact(r.value_paise)}
                    </span>
                    {r.difference_paise ? (
                      <span className="tnum block text-micro text-[hsl(var(--verdict-failed))]">
                        {formatDelta(r.difference_paise)}
                      </span>
                    ) : (
                      <span className="tnum block text-micro text-muted-foreground">
                        {r.confidence.toFixed(2)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
            {visible.length === 0 ? (
              <div className="p-8 text-center text-compact text-muted-foreground">
                No cases match.
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border px-3 py-1.5 text-micro text-muted-foreground">
            {visible.length} shown · <kbd className="font-mono">↑</kbd>{' '}
            <kbd className="font-mono">↓</kbd> to move
          </div>
        </Tabs.Root>
      </Card>

      {/* --- proof card -------------------------------------------------------- */}
      <div className="min-w-0">
        {error ? (
          <Card className="p-6">
            <p className="text-body text-[hsl(var(--verdict-failed))]">{error}</p>
          </Card>
        ) : payload ? (
          <div className={cn('transition-opacity', loading && 'opacity-50')}>
            <ProofCard payload={payload} policyPoints={policyPoints} />
          </div>
        ) : (
          <ProofCardSkeleton />
        )}
      </div>
    </div>
  )
}

/** A skeleton, not a spinner — the layout should not jump when data arrives. */
function ProofCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="h-12 animate-pulse border-b border-border bg-muted/40" />
      <div className="grid gap-0 md:grid-cols-2">
        <div className="flex flex-col gap-3 border-r border-border p-5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-20 w-full animate-pulse rounded bg-muted/60" />
        </div>
        <div className="flex flex-col gap-3 p-5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-11 w-44 animate-pulse rounded bg-muted" />
          <div className="h-12 w-full animate-pulse rounded bg-muted/60" />
        </div>
      </div>
      <div className="grid grid-cols-5 divide-x divide-border border-y border-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="h-2.5 w-14 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-64 animate-pulse bg-muted/20" />
    </Card>
  )
}

export { Badge }
