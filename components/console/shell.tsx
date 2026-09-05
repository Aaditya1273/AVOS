'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { IconArrowRight } from '@/components/ui/icon'
import { Sheet } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { RazorpaySyncPayload } from '@/lib/razorpay/runtime'
import type { EvalReport } from '@/lib/eval-report'
import type { PolicySnapshot } from '@/lib/types'
import { WhySheet } from './why-sheet'
import {
  ArchitectureView,
  ControlsView,
  EvaluationView,
  EvidenceView,
  OverviewView,
  SettlementDetail,
  SettlementList,
  SourceStatus,
  type SyncPhase,
} from './views'
import { detailFromDecision, detailFromRazorpay, fromRazorpayCase, type DetailModel, type Filters, type SettlementRecord, type SortKey, type SourceKind } from './model'

/**
 * The product shell: navigation, one workspace, one context drawer.
 *
 * Two data sources, never mixed and always named. Razorpay is the default and
 * is what a sync reads; the evaluation dataset is a separate, labelled source
 * the operator opts into. Every view reads from the active source. Nothing in
 * this file computes a financial fact — it selects, sorts, filters and shows.
 */

type View = 'overview' | 'settlements' | 'exceptions' | 'evidence' | 'controls' | 'evaluation' | 'architecture'

const NAV: { id: View; label: string; group: 'operate' | 'technical' }[] = [
  { id: 'overview', label: 'Overview', group: 'operate' },
  { id: 'settlements', label: 'Settlements', group: 'operate' },
  { id: 'exceptions', label: 'Exceptions', group: 'operate' },
  { id: 'evidence', label: 'Evidence', group: 'operate' },
  { id: 'controls', label: 'Controls', group: 'operate' },
  { id: 'evaluation', label: 'Evaluation', group: 'operate' },
  { id: 'architecture', label: 'Architecture', group: 'technical' },
]

export interface ShellProps {
  evaluation: SettlementRecord[]
  policies: PolicySnapshot[]
  policyPoints: { label: string; at: string; tolerance_paise: number }[]
  report: EvalReport | null
  verifierVersion: string
  manifest: { seed: number | string; payments: number; settlements: number; bank: number }
  initialSelected: string | null
}

export function ConsoleShell(props: ShellProps) {
  const [view, setViewState] = useState<View>('overview')
  // A search typed in Settlements should not silently narrow Exceptions.
  const setView = (v: View) => {
    setViewState(v)
    setFilters({ q: '', status: 'ALL', reason: 'ALL' })
  }
  const [source, setSource] = useState<SourceKind>('razorpay')
  const [filters, setFilters] = useState<Filters>({ q: '', status: 'ALL', reason: 'ALL' })
  const [sort, setSort] = useState<SortKey>('severity')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)
  const now = useMemo(() => Date.now(), [])

  // --- Razorpay sync ------------------------------------------------------
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [payload, setPayload] = useState<RazorpaySyncPayload | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const sync = useCallback(async () => {
    setPhase('syncing')
    setSyncError(null)
    try {
      const res = await fetch('/api/razorpay/sync', { method: 'POST', cache: 'no-store' })
      const json = (await res.json()) as RazorpaySyncPayload | { error: string; detail?: string }
      if (!res.ok || 'error' in json) {
        const e = json as { error: string; detail?: string }
        throw new Error(`${e.error}${e.detail ? ` — ${e.detail}` : ''}`)
      }
      setPayload(json)
    } catch (e) {
      setSyncError((e as Error).message)
      setPayload(null)
    } finally {
      setPhase('done')
    }
  }, [])
  useEffect(() => {
    void sync()
  }, [sync])

  // --- records for the active source ------------------------------------
  const razorpayRecords = useMemo(() => (payload ? payload.cases.map(fromRazorpayCase) : []), [payload])
  const records = source === 'razorpay' ? razorpayRecords : props.evaluation

  // --- selected settlement detail ---------------------------------------
  const cache = useRef(new Map<string, DetailModel>())
  const [detail, setDetail] = useState<DetailModel | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null)
      return
    }
    const cached = cache.current.get(selectedKey)
    if (cached) {
      setDetail(cached)
      return
    }
    const [src, caseId] = selectedKey.split(':', 2) as [SourceKind, string]
    if (src === 'razorpay') {
      const c = payload?.cases.find((x) => x.case_id === caseId)
      if (c) {
        const d = detailFromRazorpay(c)
        cache.current.set(selectedKey, d)
        setDetail(d)
      }
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    fetch(`/api/decision?case_id=${encodeURIComponent(caseId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        const d = detailFromDecision(j)
        if (!cancelled) {
          cache.current.set(selectedKey, d)
          setDetail(d)
        }
      })
      .catch((e: Error) => !cancelled && setDetailError(e.message))
      .finally(() => !cancelled && setDetailLoading(false))
    return () => {
      cancelled = true
    }
  }, [selectedKey, payload])

  // Default selection: the first record of the active source needing attention.
  useEffect(() => {
    if (selectedKey && records.some((r) => r.key === selectedKey)) return
    const first = [...records].sort((a, b) => (a.status === 'VERIFIED' ? 1 : 0) - (b.status === 'VERIFIED' ? 1 : 0) || b.amount_paise - a.amount_paise)[0]
    const initial = source === 'evaluation' && props.initialSelected ? records.find((r) => r.case_id === props.initialSelected) : undefined
    setSelectedKey((initial ?? first)?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, source])

  const open = (rec: SettlementRecord, andWhy = false) => {
    setSelectedKey(rec.key)
    if (view !== 'settlements' && view !== 'exceptions') setView('settlements')
    if (andWhy) setWhyOpen(true)
    else if (typeof window !== 'undefined' && window.innerWidth < 1024) setDetailSheetOpen(true)
  }

  const switchSource = (s: SourceKind) => {
    setSource(s)
    setFilters({ q: '', status: 'ALL', reason: 'ALL' })
  }

  const sourceSwitch = (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-[13px]" role="group" aria-label="Data source">
      {(['razorpay', 'evaluation'] as SourceKind[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => switchSource(s)}
          aria-pressed={source === s}
          className={cn('rounded px-2.5 py-1 font-medium transition-colors', source === s ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {s === 'razorpay' ? 'Razorpay' : 'Evaluation dataset'}
        </button>
      ))}
    </div>
  )

  const listAndDetail = (exceptionsOnly: boolean) => {
    const rows = exceptionsOnly ? records.filter((r) => r.status !== 'VERIFIED') : records
    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(440px,11fr)_minmax(0,13fr)] xl:items-start">
        <div className="xl:sticky xl:top-20 xl:h-[calc(100vh-7rem)]">
          <SettlementList
            records={rows}
            selectedKey={selectedKey}
            onSelect={(r) => open(r)}
            filters={filters}
            onFilters={setFilters}
            sort={sort}
            onSort={setSort}
            showNextAction={exceptionsOnly}
            now={now}
          />
        </div>
        <div className="hidden xl:block">
          <SettlementDetail detail={detail} loading={detailLoading} error={detailError} onWhy={() => setWhyOpen(true)} onEvidence={() => setView('evidence')} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* --- top bar ------------------------------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded" aria-label="AVOS home">
            {/* eslint-disable-next-line @next/next/no-img-element -- static asset, see site-nav */}
            <img src="/logo-mark.png" alt="" aria-hidden width={224} height={256} className="h-6 w-auto" />
            <span className="text-[15px] font-bold tracking-tight">AVOS</span>
            <span className="hidden text-[13px] text-muted-foreground sm:inline">Financial control center</span>
          </Link>
          <nav className="ml-auto flex items-center gap-3">
            {sourceSwitch}
          </nav>
        </div>
        {/* Mobile nav: horizontal scroll. */}
        <nav className="scroll-x-clean flex gap-1 border-t border-border px-2 lg:hidden" aria-label="Sections">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setView(n.id)}
              aria-current={view === n.id ? 'page' : undefined}
              className={cn('shrink-0 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium', view === n.id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground')}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* --- left nav ---------------------------------------------------- */}
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-6" aria-label="Sections">
            {(['operate', 'technical'] as const).map((g) => (
              <div key={g}>
                {g === 'technical' ? <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-label text-muted-foreground">Technical</div> : null}
                <ul className="space-y-0.5">
                  {NAV.filter((n) => n.group === g).map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => setView(n.id)}
                        aria-current={view === n.id ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center rounded-md px-3 py-2 text-left text-[14px] font-medium transition-colors',
                          view === n.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                      >
                        {n.label}
                        {n.id === 'exceptions' && records.some((r) => r.status === 'FAILED') ? (
                          <span className="tnum ml-auto text-[12px] text-[hsl(var(--verdict-failed))]">{records.filter((r) => r.status === 'FAILED').length}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="border-t border-border px-3 pt-4 text-[12px] text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">Source</div>
              {source === 'razorpay' ? 'Razorpay Test API · read-only' : 'AVOS Evaluation Dataset · synthetic, labelled'}
            </div>
          </nav>
        </aside>

        {/* --- workspace --------------------------------------------------- */}
        <main className="min-w-0">
          {view === 'overview' ? (
            <OverviewView
              source={source}
              records={records}
              razorpay={{ payload, phase, error: syncError }}
              report={props.report}
              onSync={sync}
              onOpen={(r) => open(r, true)}
              onSwitchSource={switchSource}
              onGo={(v) => setView(v)}
            />
          ) : null}

          {view === 'settlements' || view === 'exceptions' ? (
            <div>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-[26px] font-bold leading-tight tracking-tight">{view === 'exceptions' ? 'Exceptions' : 'Settlements'}</h1>
                  <p className="mt-1 text-[14px] text-muted-foreground">
                    {view === 'exceptions' ? 'Every settlement AVOS would not close, with what to do next.' : 'Every settlement from the active source, verified fresh.'} ·{' '}
                    {source === 'razorpay' ? 'Razorpay Test API' : 'AVOS Evaluation Dataset'}
                  </p>
                </div>
                {source === 'razorpay' ? <SourceStatus compact payload={payload} phase={phase} error={syncError} onSync={sync} /> : null}
              </div>
              {source === 'razorpay' && records.length === 0 && phase !== 'syncing' ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <div className="text-[18px] font-semibold">No settlement data yet</div>
                  <p className="mx-auto mt-1 max-w-xl text-[14px] text-muted-foreground">
                    {payload?.connection.state === 'CONNECTED'
                      ? 'Razorpay Test API is connected, but this account has no settlement records. Nothing is substituted.'
                      : (payload?.connection.detail ?? syncError ?? 'Waiting for the first sync.')}
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <button type="button" onClick={() => switchSource('evaluation')} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[14px] font-medium hover:bg-accent">
                      Open AVOS Evaluation dataset <IconArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                listAndDetail(view === 'exceptions')
              )}
            </div>
          ) : null}

          {view === 'evidence' ? <EvidenceView detail={detail} /> : null}
          {view === 'controls' ? <ControlsView policies={props.policies} detail={detail} policyPoints={props.policyPoints} /> : null}
          {view === 'evaluation' ? (
            <EvaluationView
              report={props.report}
              onOpenDataset={() => {
                switchSource('evaluation')
                setView('settlements')
              }}
            />
          ) : null}
          {view === 'architecture' ? <ArchitectureView verifierVersion={props.verifierVersion} manifest={props.manifest} /> : null}
        </main>
      </div>

      {/* --- drawers ------------------------------------------------------- */}
      <WhySheet detail={detail} open={whyOpen} onClose={() => setWhyOpen(false)} />
      <Sheet open={detailSheetOpen} onClose={() => setDetailSheetOpen(false)} title={detail ? detail.record.settlement_id : 'Settlement'} wide>
        <div className="p-4">
          <SettlementDetail
            detail={detail}
            loading={detailLoading}
            error={detailError}
            onWhy={() => {
              setDetailSheetOpen(false)
              setWhyOpen(true)
            }}
            onEvidence={() => {
              setDetailSheetOpen(false)
              setView('evidence')
            }}
          />
        </div>
      </Sheet>
    </div>
  )
}
