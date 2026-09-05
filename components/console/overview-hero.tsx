'use client'

import { useEffect, useRef } from 'react'
import { IconReplay } from '@/components/ui/icon'
import { cn, fmtTime } from '@/lib/utils'
import type { RazorpaySyncPayload } from '@/lib/razorpay/runtime'
import { moneyShort, money, kpis, type SettlementRecord, type SourceKind, SOURCE_LABEL } from './model'
import type { SyncPhase } from './views'

/**
 * The console's signature: the same six-stage flow the landing page tells,
 * drawn as one curved line across a deep band, with the real counts of this
 * source riding on its nodes. Razorpay read → ledger rows → proposals →
 * evidence rows → verified → closed, and how much value is held short of the
 * gate. Nothing decorative: every number is a length of an array the system
 * already holds, and the line only draws itself when a sync has completed.
 *
 * Beneath it, money the way a controller reads it: one figure for value in
 * scope, split into a ribbon of verified / review / exceptions.
 */

const NODES = ['Source', 'Ledger', 'AI proposal', 'Evidence', 'Verifier', 'Close'] as const
const X = [70, 240, 410, 580, 750, 920]
const Y = [96, 60, 104, 62, 100, 82]
const PATH = `M ${X[0]} ${Y[0]} C 150 ${Y[0]}, 160 ${Y[1]}, ${X[1]} ${Y[1]} S 330 ${Y[2]}, ${X[2]} ${Y[2]} S 500 ${Y[3]}, ${X[3]} ${Y[3]} S 670 ${Y[4]}, ${X[4]} ${Y[4]} S 840 ${Y[5]}, ${X[5]} ${Y[5]}`

export function OverviewHero({
  source,
  records,
  payload,
  phase,
  error,
  onSync,
}: {
  source: SourceKind
  records: SettlementRecord[]
  payload: RazorpaySyncPayload | null
  phase: SyncPhase
  error: string | null
  onSync: () => void
}) {
  const k = kpis(records)
  const live = source === 'razorpay'
  const counts = [
    live ? (payload?.counts.settlements ?? 0) : records.length,
    live ? (payload ? payload.ledger_counts.payments + payload.ledger_counts.refunds + payload.ledger_counts.holds + payload.ledger_counts.settlements : 0) : records.reduce((a, r) => a + r.evidence_rows, 0),
    records.filter((r) => r.agent_claim).length,
    records.reduce((a, r) => a + r.evidence_rows, 0),
    k.verified,
    records.filter((r) => r.closure === 'CLOSED').length,
  ]
  const c = payload?.connection
  const state = phase === 'syncing' ? 'Syncing' : c?.state === 'CONNECTED' ? 'Connected' : c?.state === 'NOT_CONFIGURED' ? 'Not configured' : c?.state === 'AUTHENTICATION_FAILED' ? 'Authentication failed' : c?.state === 'UNAVAILABLE' ? 'Unavailable' : error ? 'Sync failed' : 'Not checked'
  const ok = c?.state === 'CONNECTED' && phase !== 'syncing'
  const drawn = phase === 'done' && (live ? !!payload : true)
  // The first node names the source truthfully: Razorpay when live, the
  // labelled dataset when not. Never 'Razorpay' over evaluation data.
  const labels = NODES.map((n, i) => (i === 0 ? (live ? 'Razorpay' : 'Dataset') : n))

  const path = useRef<SVGPathElement>(null)
  useEffect(() => {
    const el = path.current
    if (!el) return
    const total = el.getTotalLength()
    el.style.strokeDasharray = `${total}`
    if (!drawn) {
      el.style.transition = 'none'
      el.style.strokeDashoffset = `${total}`
      return
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.style.transition = reduce ? 'none' : 'stroke-dashoffset 900ms cubic-bezier(0.2,0,0,1)'
    requestAnimationFrame(() => {
      el.style.strokeDashoffset = '0'
    })
  }, [drawn, source])

  const total = k.verifiedValue + k.heldValue
  const heldReview = records.filter((r) => r.status === 'UNCERTAIN' || r.status === 'PENDING').reduce((a, r) => a + r.amount_paise, 0)
  const heldFailed = records.filter((r) => r.status === 'FAILED').reduce((a, r) => a + r.amount_paise, 0)
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)

  return (
    <section aria-label="Financial control center" className="overflow-hidden rounded-xl border border-border bg-card">
      {/* --- the band ------------------------------------------------------- */}
      <div className="relative bg-foreground px-6 pb-2 pt-6 text-background">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">Financial control center</h1>
            <p className="mt-1 text-[13px] text-background/70">
              {SOURCE_LABEL[source]}
              {source === 'evaluation' ? ' · synthetic, labelled · not Razorpay transactions' : ' · read-only'}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:gap-4">
            <div className="min-w-0 flex-1 sm:text-right">
              <div className="flex items-center gap-2 text-[15px] font-semibold sm:justify-end">
                <span className={cn('h-2.5 w-2.5 rounded-full', ok ? 'bg-[hsl(152_70%_55%)]' : phase === 'syncing' ? 'animate-pulse bg-background/60' : c?.state === 'NOT_CONFIGURED' ? 'border border-background/60' : 'bg-[hsl(352_80%_65%)]')} aria-hidden />
                <span className="whitespace-nowrap">Razorpay {payload?.mode === 'live' ? 'Live' : 'Test'} API</span>
                <span className="whitespace-nowrap">· {state}</span>
              </div>
              <div className="mt-0.5 text-[12px] text-background/60">
                {payload ? `Last sync ${fmtTime(payload.fetched_at)} · ${payload.activity.length} read-only requests` : phase === 'syncing' ? 'Reading settlements, reconciliation, payments, refunds…' : (error ?? 'No sync yet')}
              </div>
            </div>
            <button
              type="button"
              onClick={onSync}
              disabled={phase === 'syncing'}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-background px-3.5 text-[14px] font-semibold text-foreground transition-colors hover:bg-background/90 disabled:opacity-60"
            >
              <IconReplay className={cn('h-4 w-4', phase === 'syncing' && 'animate-spin')} />
              {phase === 'syncing' ? 'Syncing' : 'Sync Razorpay'}
            </button>
          </div>
        </div>

        {/* The flow. */}
        <div className="relative mt-4 overflow-x-auto scroll-x-clean">
          <svg viewBox="0 0 990 150" className="h-[132px] w-full min-w-[640px]" role="img" aria-label={`Flow: ${labels.map((n, i) => `${n} ${counts[i]}`).join(', ')}`}>
            <path d={PATH} fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
            <path ref={path} d={PATH} fill="none" stroke="#5B9BFF" strokeWidth="2" strokeLinecap="round" />
            {labels.map((n, i) => {
              const gate = i === NODES.length - 1
              const lit = drawn && counts[i] > 0
              return (
                <g key={n} transform={`translate(${X[i]} ${Y[i]})`}>
                  {gate ? (
                    <g stroke={lit ? '#5B9BFF' : 'currentColor'} strokeOpacity={lit ? 1 : 0.4} strokeWidth="2" fill="none" strokeLinecap="round">
                      <path d="M 0 -22 L 0 22 M -8 -22 L 8 -22 M -8 22 L 8 22" />
                    </g>
                  ) : (
                    <circle r="15" fill={lit ? '#5B9BFF' : 'transparent'} fillOpacity={lit ? 0.18 : 0} stroke={lit ? '#5B9BFF' : 'currentColor'} strokeOpacity={lit ? 1 : 0.4} strokeWidth="2" />
                  )}
                  <text y={gate ? -34 : -26} textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {counts[i]}
                  </text>
                  <text y="40" textAnchor="middle" fontSize="11" fontWeight="600" letterSpacing="0.08em" fill="currentColor" fillOpacity="0.7">
                    {n.toUpperCase()}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* --- the ribbon ------------------------------------------------------ */}
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">Value in scope</div>
          <div className="tnum mt-1 text-[40px] font-bold leading-none tracking-tight">{money(total)}</div>
          <div className="mt-2 text-[13px] text-muted-foreground">
            {k.total} settlements · {k.verified} safe to close · {k.exceptions + k.reviews + k.pending} held
          </div>
        </div>
        <div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${moneyShort(k.verifiedValue)} verified, ${moneyShort(heldReview)} under review, ${moneyShort(heldFailed)} in exceptions`}>
            <div className="h-full bg-[hsl(var(--verdict-verified))] transition-[width] duration-500" style={{ width: `${pct(k.verifiedValue)}%` }} />
            <div className="h-full bg-[hsl(var(--verdict-uncertain))] transition-[width] duration-500" style={{ width: `${pct(heldReview)}%` }} />
            <div className="h-full bg-[hsl(var(--verdict-failed))] transition-[width] duration-500" style={{ width: `${pct(heldFailed)}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            <Leg tone="verified" label="Verified" value={moneyShort(k.verifiedValue)} hint={`${k.verified} safe to close`} />
            <Leg tone="uncertain" label="Review" value={moneyShort(heldReview)} hint={`${k.reviews + k.pending} held`} />
            <Leg tone="failed" label="Exceptions" value={moneyShort(heldFailed)} hint={`${k.exceptions} blocked`} />
          </dl>
        </div>
      </div>
    </section>
  )
}

function Leg({ tone, label, value, hint }: { tone: 'verified' | 'uncertain' | 'failed'; label: string; value: string; hint: string }) {
  const dot = tone === 'verified' ? 'bg-[hsl(var(--verdict-verified))]' : tone === 'uncertain' ? 'bg-[hsl(var(--verdict-uncertain))]' : 'bg-[hsl(var(--verdict-failed))]'
  return (
    <div>
      <dt className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-label text-muted-foreground sm:text-[12px]">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden /> {label}
      </dt>
      <dd className="tnum mt-1 text-[18px] font-bold leading-none tracking-tight sm:text-[22px]">{value}</dd>
      <dd className="mt-0.5 text-[12px] text-muted-foreground">{hint}</dd>
    </div>
  )
}
