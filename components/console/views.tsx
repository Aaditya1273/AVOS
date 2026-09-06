'use client'

import { useMemo, useState } from 'react'
import { Mono } from '@/components/ui/primitives'
import { IconArrowRight, IconCheck, IconCross, IconHold, IconReplay } from '@/components/ui/icon'
import { RowDetail } from '@/components/row-detail'
import { ReplayView } from '@/components/replay-view'
import { QaPanel } from '@/components/qa-panel'
import { formatDelta, formatPaise, formatPct } from '@/lib/money'
import { cn, fmtDate, fmtTime } from '@/lib/utils'
import type { RazorpaySyncPayload } from '@/lib/razorpay/runtime'
import type { EvalReport } from '@/lib/eval-report'
import type { EvidenceItem, PolicySnapshot } from '@/lib/types'
import {
  SORT_LABEL,
  SOURCE_LABEL,
  ageDays,
  filterRecords,
  kpis,
  money,
  moneyShort,
  nextAction,
  reasonLabel,
  reasonLine,
  reasonsPresent,
  sortRecords,
  statusLabel,
  type DetailModel,
  type Filters,
  type SettlementRecord,
  type SortKey,
  type SourceKind,
  type Status,
} from './model'

/* ------------------------------------------------------------------------ */
/* Shared pieces                                                             */
/* ------------------------------------------------------------------------ */

export function StatusPill({ status, size = 'sm' }: { status: Status; size?: 'sm' | 'md' }) {
  const s = statusLabel(status)
  const cls =
    status === 'VERIFIED'
      ? 'bg-[hsl(var(--verdict-verified)/0.1)] text-[hsl(var(--verdict-verified))]'
      : status === 'UNCERTAIN'
        ? 'bg-[hsl(var(--verdict-uncertain)/0.12)] text-[hsl(var(--verdict-uncertain))]'
        : status === 'FAILED'
          ? 'bg-[hsl(var(--verdict-failed)/0.1)] text-[hsl(var(--verdict-failed))]'
          : 'bg-muted text-muted-foreground'
  const Icon = status === 'VERIFIED' ? IconCheck : status === 'UNCERTAIN' ? IconHold : status === 'FAILED' ? IconCross : IconHold
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold', size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-3 py-1 text-[13px]', cls)}>
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.5} />
      {s.title}
    </span>
  )
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {sub ? <p className="mt-1 text-[14px] text-muted-foreground">{sub}</p> : null}
      </div>
      {right}
    </div>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[18px] font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className,
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[14px] font-medium transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'secondary' && 'border border-border bg-card hover:bg-accent',
        variant === 'ghost' && 'text-primary hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------------ */
/* Razorpay source block                                                     */
/* ------------------------------------------------------------------------ */

export type SyncPhase = 'idle' | 'syncing' | 'done'

/** A payment the API returned that no settlement has claimed yet. */
type SafePayment = RazorpaySyncPayload['unsettled']['payments'][number]

/**
 * The connection, as a word.
 *
 * "Connected" describes the connection and nothing else. A read that succeeds
 * and returns no settlements is still a successful read — the previous label
 * appended "· empty" whenever `settlements === 0`, so a sync that fetched two
 * real payments over five 200s announced itself as empty. That is not a
 * cosmetic problem: it is the UI contradicting its own evidence.
 *
 * Whether there is anything to *review* is a separate question, answered
 * separately, further down the page.
 */
function connectionView(
  payload: RazorpaySyncPayload | null,
  phase: SyncPhase,
  error: string | null,
): { label: string; dot: string; live: boolean } {
  if (phase === 'syncing') return { label: 'Syncing', dot: 'bg-muted-foreground/50 animate-pulse', live: false }
  const state = payload?.connection.state ?? (error ? 'ERROR' : 'IDLE')
  switch (state) {
    case 'CONNECTED':
      return { label: 'Connected', dot: 'bg-[hsl(var(--verdict-verified))]', live: true }
    case 'NOT_CONFIGURED':
      return { label: 'Not configured', dot: 'border border-muted-foreground bg-transparent', live: false }
    case 'AUTHENTICATION_FAILED':
      return { label: 'Authentication failed', dot: 'bg-[hsl(var(--verdict-failed))]', live: false }
    case 'UNAVAILABLE':
      return { label: 'Unavailable', dot: 'bg-[hsl(var(--verdict-failed))]', live: false }
    case 'ERROR':
      return { label: 'Sync failed', dot: 'bg-[hsl(var(--verdict-failed))]', live: false }
    default:
      return { label: 'Not checked', dot: 'bg-muted-foreground/50', live: false }
  }
}

/** "5 read-only requests succeeded" — counted off the activity log, not assumed. */
function requestSummary(payload: RazorpaySyncPayload | null): string | null {
  if (!payload || payload.activity.length === 0) return null
  const ok = payload.activity.filter((a) => a.ok).length
  const n = payload.activity.length
  return ok === n ? `${n} read-only request${n === 1 ? '' : 's'} succeeded` : `${ok} of ${n} read-only requests succeeded`
}

/**
 * The source panel: what AVOS is reading, on whose authority, and when.
 *
 * Every value is read off the sync payload. There is no branch that renders a
 * status the runtime did not report.
 */
export function SourceStatus({
  payload,
  phase,
  error,
  onSync,
  compact = false,
}: {
  payload: RazorpaySyncPayload | null
  phase: SyncPhase
  error: string | null
  onSync: () => void
  compact?: boolean
}) {
  const c = connectionView(payload, phase, error)
  const requests = requestSummary(payload)
  const detail = phase === 'syncing' ? 'Reading settlements, reconciliation, payments and refunds.' : (payload?.connection.detail ?? error ?? 'No sync has run yet.')

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', c.dot)} aria-hidden />
        <span className="text-[14px] font-semibold">{c.label}</span>
        <span className="text-[13px] text-muted-foreground">
          Razorpay {payload?.mode === 'live' ? 'Live' : 'Test'} API · Read-only
        </span>
        {payload ? <span className="tnum text-[13px] text-muted-foreground">· {countLine(payload)}</span> : null}
        <Button onClick={onSync} disabled={phase === 'syncing'} variant="secondary" className="ml-auto h-8">
          <IconReplay className={cn('h-4 w-4', phase === 'syncing' && 'animate-spin')} />
          {phase === 'syncing' ? 'Syncing' : 'Sync'}
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', c.dot)} aria-hidden />
            <span className="text-[22px] font-bold tracking-tight">{c.label}</span>
          </div>
          <p className="mt-1 text-[14px] font-medium text-foreground/80">{requests ?? detail}</p>
          {/* The detail only earns a line when it says something the request
              count does not — i.e. when something went wrong. */}
          {requests && !c.live ? <p className="mt-0.5 text-[13px] text-muted-foreground">{detail}</p> : null}
        </div>
        <Button onClick={onSync} disabled={phase === 'syncing'} variant="secondary">
          <IconReplay className={cn('h-4 w-4', phase === 'syncing' && 'animate-spin')} />
          {phase === 'syncing' ? 'Syncing Razorpay…' : 'Sync Razorpay'}
        </Button>
      </div>

      <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <SourceFact k="Source" v={`Razorpay ${payload?.mode === 'live' ? 'Live' : 'Test'} API`} sub={payload?.connection.key_id_prefix ? `key ${payload.connection.key_id_prefix}…` : undefined} />
        <SourceFact k="Status" v={c.label} sub={payload?.connection.checked_at ? `checked ${fmtTime(payload.connection.checked_at)}` : undefined} />
        <SourceFact k="Access" v={payload?.access === 'read-only' || !payload ? 'Read-only' : payload.access} sub="GET requests only" />
        <SourceFact
          k="Last sync"
          v={phase === 'syncing' ? 'Syncing…' : payload ? fmtTime(payload.fetched_at) : '—'}
          sub={payload ? `${payload.counts.payments} payment${payload.counts.payments === 1 ? '' : 's'} received` : undefined}
        />
      </dl>
    </div>
  )
}

function SourceFact({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="bg-card px-5 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground">{k}</dt>
      <dd className="mt-1 text-[14px] font-semibold">{v}</dd>
      {sub ? <dd className="mt-0.5 text-[12px] text-muted-foreground">{sub}</dd> : null}
    </div>
  )
}

/** Exact terminology, always. A payment is never counted as a settlement. */
function countLine(p: RazorpaySyncPayload): string {
  return `${p.counts.settlements} settlements · ${p.counts.recon_rows} recon rows · ${p.counts.payments} payments · ${p.counts.refunds} refunds`
}

/**
 * What came back, by entity, in the API's own vocabulary.
 *
 * Four separate numbers rather than one total, because the whole point is that
 * they are not interchangeable: two payments and zero settlements is a
 * meaningful, honest state, and any tile that blurred them into "2 records"
 * would be inviting exactly the misreading this panel exists to prevent.
 */
export function ReceivedTiles({ payload }: { payload: RazorpaySyncPayload }) {
  const tiles: [string, number, string][] = [
    ['Payments', payload.counts.payments, 'GET /v1/payments'],
    ['Settlements', payload.counts.settlements, 'GET /v1/settlements'],
    ['Recon rows', payload.counts.recon_rows, 'GET /v1/settlements/recon/combined'],
    ['Refunds', payload.counts.refunds, 'GET /v1/refunds'],
  ]
  return (
    <div>
      <h2 className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">What AVOS received</h2>
      <dl className="mt-2 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, n, endpoint]) => (
          <div key={label} className="bg-card px-5 py-4">
            <dd className={cn('tnum text-[32px] font-bold leading-none tracking-tight', n > 0 ? 'text-foreground' : 'text-muted-foreground')}>{n}</dd>
            <dt className="mt-1.5 text-[14px] font-medium">{label}</dt>
            <dd className="mt-1 truncate text-[12px] text-muted-foreground">
              <Mono>{endpoint}</Mono>
            </dd>
          </div>
        ))}
      </dl>
      {payload.truncated ? (
        <p className="mt-2 text-[12px] text-muted-foreground">A collection hit the page ceiling — these counts are a floor.</p>
      ) : null}
    </div>
  )
}

/**
 * The records themselves.
 *
 * Razorpay's payments endpoint carries no settlement id, so these rows cannot
 * be reconciled and are not pretended to be. They are shown because they are
 * the plainest available proof that the connection returns real data: every id
 * here can be pasted into the merchant's own dashboard.
 */
export function RazorpayPayments({ payload }: { payload: RazorpaySyncPayload }) {
  const rows = payload.unsettled.payments
  if (rows.length === 0) return null
  const captured = rows.filter((p) => p.captured).length
  const failed = rows.filter((p) => p.status === 'failed').length
  return (
    <div>
      <SectionTitle
        right={
          <span className="tnum text-[13px] text-muted-foreground">
            {rows.length} fetched
            {captured ? <> · {captured} captured</> : null}
            {failed ? <> · {failed} failed</> : null}
          </span>
        }
      >
        Razorpay payments
      </SectionTitle>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map((p) => (
          <li key={p.id}>
            <PaymentRow p={p} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Source <span className="font-medium text-foreground">Razorpay {payload.mode === 'live' ? 'Live' : 'Test'} API</span> · fetched {fmtTime(payload.fetched_at)} ·{' '}
        <Mono>GET /v1/payments</Mono>. These carry no settlement id, so nothing here has been reconciled or closed.
      </p>
    </div>
  )
}

/**
 * Razorpay's payment status is a financial state, not a label, so it gets the
 * verdict palette: captured money is green, a failed attempt is red, and a
 * payment still in flight stays neutral because nothing has been decided.
 *
 * A failed payment moved no money, so its amount is set in muted type — the
 * figure is what was attempted, not what arrived, and rendering it as boldly
 * as a captured amount would overstate the account's balance at a glance.
 * The status word carries the same information on its own, for anyone who
 * cannot separate the two colours.
 */
function statusTone(status: string): { text: string; amount: string } {
  switch (status) {
    case 'captured':
      return { text: 'text-[hsl(var(--verdict-verified))]', amount: 'text-foreground' }
    case 'failed':
      return { text: 'text-[hsl(var(--verdict-failed))]', amount: 'text-muted-foreground' }
    case 'refunded':
      return { text: 'text-[hsl(var(--verdict-uncertain))]', amount: 'text-foreground' }
    default:
      return { text: 'text-muted-foreground', amount: 'text-foreground' }
  }
}

function PaymentRow({ p }: { p: SafePayment }) {
  const tone = statusTone(p.status)
  return (
    <div className="grid items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn('tnum text-[20px] font-bold tracking-tight', tone.amount)}>{formatPaise(p.amount_paise)}</span>
          <span className="text-[13px] font-medium text-muted-foreground">
            <span className={cn('font-semibold capitalize', tone.text)}>{p.status}</span>
            {p.method ? ` · ${p.method}` : ''}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
          <Mono>{p.id}</Mono> · {fmtTime(p.created_at)}
        </div>
      </div>
      <div className="text-[12px] text-muted-foreground sm:text-right">
        {p.fee_paise != null ? (
          <span className="tnum">
            fee {formatPaise(p.fee_paise)}
            {p.tax_paise != null ? ` · tax ${formatPaise(p.tax_paise)}` : ''}
          </span>
        ) : null}
        <span className="block">{p.currency}</span>
      </div>
    </div>
  )
}

/**
 * The API activity log, one click away.
 *
 * This is the single most load-bearing element on the page for a sceptical
 * reader: it is the list of requests that actually left the process, with the
 * status the API actually returned. `classifyConnection` derives "Connected"
 * from exactly this list, so what is shown here *is* what the badge is made of.
 */
export function ApiActivity({ payload }: { payload: RazorpaySyncPayload }) {
  if (payload.activity.length === 0) return null
  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
        API activity · {payload.activity.length} requests
        <span className="ml-auto text-[12px] text-muted-foreground group-open:hidden">every request this sync made</span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {payload.activity.map((a, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <Mono>{a.method}</Mono>
              <Mono className="truncate">{a.endpoint}</Mono>
            </span>
            <span className="ml-auto flex items-center gap-3">
              <span className={cn('tnum font-semibold', a.ok ? 'text-[hsl(var(--verdict-verified))]' : 'text-[hsl(var(--verdict-failed))]')}>
                {a.status === null ? 'no response' : `${a.status}${a.ok ? ' OK' : ''}`}
              </span>
              <span className="tnum text-muted-foreground">{a.count !== null ? `count ${a.count}` : '—'}</span>
              <span className="tnum text-muted-foreground">
                {a.elapsed_ms}ms
                {a.attempt === 2 ? ' · retry' : ''}
              </span>
            </span>
            {a.error ? <span className="basis-full text-[12px] text-[hsl(var(--verdict-failed))]">{a.error}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * The runtime path, with each stage showing the state the runtime reported.
 *
 * A filled mark means the stage has data or is live; a hollow one means it has
 * nothing yet. Both carry words, because a reader who cannot distinguish the
 * two colours must still be able to read the state.
 */
export function SystemPath({ payload }: { payload: RazorpaySyncPayload }) {
  const conn = connectionView(payload, 'done', null)
  const stages: { name: string; on: boolean; state: string; detail: string }[] = [
    {
      name: 'Razorpay',
      on: conn.live,
      state: conn.label,
      detail: requestSummary(payload) ?? payload.connection.detail,
    },
    {
      name: 'AVOS Ledger',
      on: payload.ledger_counts.settlements > 0,
      state: payload.ledger_counts.settlements > 0 ? 'Populated' : 'Ready · no rows',
      detail: `${payload.ledger_counts.settlements} settlement rows normalised${payload.counts.payments > 0 ? ' · payments carry no settlement id' : ''}`,
    },
    {
      name: 'Evidence',
      on: payload.cases.length > 0,
      state: payload.cases.length > 0 ? `${payload.cases.length} packs` : 'Ready · no packs',
      detail: 'One hashed pack per settlement',
    },
    {
      name: 'AI agent',
      on: payload.agent.state === 'available',
      state: payload.agent.state === 'available' ? 'Available' : 'Unavailable',
      detail: payload.agent.model ?? payload.agent.detail,
    },
    {
      name: 'Verifier',
      on: true,
      state: 'Ready',
      detail: `${payload.verifier_version} · runs on every sync`,
    },
    {
      name: 'Decision',
      on: payload.cases.length > 0,
      state: payload.cases.length > 0 ? `${payload.cases.length} decided` : 'None to make',
      detail: 'Close, hold or raise an exception',
    },
  ]
  return (
    <div>
      <h2 className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">System path</h2>
      <ol className="mt-2 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stages.map((s) => (
          <li key={s.name} className="bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', s.on ? 'bg-[hsl(var(--verdict-verified))]' : 'border border-muted-foreground bg-transparent')} aria-hidden />
              <span className="text-[13px] font-semibold">{s.name}</span>
            </div>
            <div className={cn('mt-1 text-[13px] font-medium', s.on ? 'text-foreground' : 'text-muted-foreground')}>{s.state}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{s.detail}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Nothing to review — said precisely, and without a page of whitespace.
 *
 * It names what *did* arrive, so the absence of settlements reads as a fact
 * about the account rather than a failure of the connection.
 */
export function NoSettlements({
  payload,
  phase,
  error,
  onSync,
  onSwitchSource,
}: {
  payload: RazorpaySyncPayload | null
  phase: SyncPhase
  error: string | null
  onSync: () => void
  onSwitchSource: (s: SourceKind) => void
}) {
  const connected = payload?.connection.state === 'CONNECTED'
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      {/* A failed read is not evidence that there are no settlements — only a
          successful one can say that. The heading follows the connection. */}
      <h2 className="text-[18px] font-semibold tracking-tight">{connected ? 'No settlements to review' : 'Razorpay could not be read'}</h2>
      <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
        {connected ? (
          <>
            Razorpay {payload?.mode === 'live' ? 'Live' : 'Test'} API is connected and AVOS received{' '}
            <span className="tnum font-medium text-foreground">{countLine(payload)}</span>. This account has no settlement records, so there is nothing to
            verify or close. <span className="font-medium text-foreground">Nothing was substituted.</span>
          </>
        ) : (
          (payload?.connection.detail ?? error ?? 'Waiting for the first sync.')
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={onSync} disabled={phase === 'syncing'}>
          <IconReplay className={cn('h-4 w-4', phase === 'syncing' && 'animate-spin')} /> {phase === 'syncing' ? 'Syncing Razorpay…' : 'Sync Razorpay'}
        </Button>
        <Button variant="secondary" onClick={() => onSwitchSource('evaluation')}>
          Open AVOS Evaluation <IconArrowRight className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">
        AVOS Evaluation is a controlled synthetic benchmark — seeded and labelled — not Razorpay transaction data.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Overview                                                                  */
/* ------------------------------------------------------------------------ */

export function OverviewView(props: {
  source: SourceKind
  records: SettlementRecord[]
  razorpay: { payload: RazorpaySyncPayload | null; phase: SyncPhase; error: string | null }
  report: EvalReport | null
  onSync: () => void
  onOpen: (rec: SettlementRecord) => void
  onSwitchSource: (s: SourceKind) => void
  onGo: (view: 'exceptions' | 'settlements' | 'evaluation') => void
}) {
  return props.source === 'razorpay' ? <RazorpayOverview {...props} /> : <EvaluationOverview {...props} />
}

/**
 * The Razorpay overview.
 *
 * With settlements, this is a money-first console and the hero is the money.
 * Without them, the hero is the *source*: what AVOS is connected to, what it
 * asked for, and what came back. There is no third mode where a number is
 * invented to fill the space.
 */
function RazorpayOverview({
  records,
  razorpay,
  onSync,
  onOpen,
  onSwitchSource,
  onGo,
}: {
  records: SettlementRecord[]
  razorpay: { payload: RazorpaySyncPayload | null; phase: SyncPhase; error: string | null }
  onSync: () => void
  onOpen: (rec: SettlementRecord) => void
  onSwitchSource: (s: SourceKind) => void
  onGo: (view: 'exceptions' | 'settlements' | 'evaluation') => void
}) {
  const { payload, phase, error } = razorpay
  const k = kpis(records)
  const attention = sortRecords(records.filter((r) => r.status !== 'VERIFIED'), 'severity').slice(0, 6)

  return (
    <div className="space-y-6">
      <PageHeader title="Financial control center" sub={`${SOURCE_LABEL.razorpay} · read-only`} />

      <SourceStatus payload={payload} phase={phase} error={error} onSync={onSync} />

      {records.length > 0 ? (
        <>
          <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Value verified" value={moneyShort(k.verifiedValue)} hint={`${k.verified} safe to close`} tone="verified" />
            <Kpi label="Value held" value={moneyShort(k.heldValue)} hint={`${k.exceptions + k.reviews + k.pending} not closed`} tone={k.heldValue > 0 ? 'uncertain' : undefined} />
            <Kpi label="Exceptions" value={String(k.exceptions)} hint={`${k.reviews} need review`} tone={k.exceptions > 0 ? 'failed' : undefined} />
            <Kpi label="Settlements" value={String(k.total)} hint="read this sync" />
          </dl>

          {attention.length > 0 ? (
            <div>
              <SectionTitle right={<Button variant="ghost" onClick={() => onGo('exceptions')}>All exceptions <IconArrowRight className="h-4 w-4" /></Button>}>
                Needs attention
              </SectionTitle>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {attention.map((r) => (
                  <li key={r.key}>
                    <AttentionRow rec={r} onOpen={() => onOpen(r)} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[14px] text-muted-foreground">Nothing needs attention. Every settlement verified.</p>
          )}
        </>
      ) : null}

      {payload ? (
        <>
          <ReceivedTiles payload={payload} />
          <RazorpayPayments payload={payload} />
          {records.length === 0 ? <NoSettlements payload={payload} phase={phase} error={error} onSync={onSync} onSwitchSource={onSwitchSource} /> : null}
          <ApiActivity payload={payload} />
          <SystemPath payload={payload} />
        </>
      ) : phase === 'syncing' ? null : (
        // No payload and not syncing: the first read failed, or none has run.
        // While a sync is in flight there is nothing to report yet, and saying
        // "no settlements" before the API has answered would be a guess.
        <NoSettlements payload={payload} phase={phase} error={error} onSync={onSync} onSwitchSource={onSwitchSource} />
      )}
    </div>
  )
}

/** The evaluation overview: unchanged in substance, explicit about its identity. */
function EvaluationOverview({
  records,
  report,
  onOpen,
  onSwitchSource,
  onGo,
}: {
  records: SettlementRecord[]
  report: EvalReport | null
  onOpen: (rec: SettlementRecord) => void
  onSwitchSource: (s: SourceKind) => void
  onGo: (view: 'exceptions' | 'settlements' | 'evaluation') => void
}) {
  const k = kpis(records)
  const attention = sortRecords(records.filter((r) => r.status !== 'VERIFIED'), 'severity').slice(0, 6)
  const falseClosures = report ? report.batch_120.false_closure_cases.length : null

  return (
    <div className="space-y-6">
      <PageHeader title="AVOS Evaluation" sub="Synthetic · seeded · labelled. Not Razorpay transaction data." />

      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Value verified" value={moneyShort(k.verifiedValue)} hint={`${k.verified} safe to close`} tone="verified" />
        <Kpi label="Value held" value={moneyShort(k.heldValue)} hint={`${k.exceptions + k.reviews + k.pending} not closed`} tone={k.heldValue > 0 ? 'uncertain' : undefined} />
        <Kpi label="Exceptions" value={String(k.exceptions)} hint={`${k.reviews} need review`} tone={k.exceptions > 0 ? 'failed' : undefined} />
        <Kpi
          label="False closures"
          value={falseClosures === null ? '—' : String(falseClosures)}
          hint={falseClosures === null ? 'run npm run eval' : `of ${report?.batch_120.n ?? k.total} labelled`}
          tone={falseClosures === 0 ? 'verified' : undefined}
        />
      </dl>

      {attention.length > 0 ? (
        <div>
          <SectionTitle right={<Button variant="ghost" onClick={() => onGo('exceptions')}>All exceptions <IconArrowRight className="h-4 w-4" /></Button>}>
            Needs attention
          </SectionTitle>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {attention.map((r) => (
              <li key={r.key}>
                <AttentionRow rec={r} onOpen={() => onOpen(r)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[12px] text-muted-foreground">
        These figures describe the AVOS Evaluation Dataset — synthetic, seeded, labelled settlements used to prove the verifier. They are not Razorpay
        transactions.{' '}
        <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onSwitchSource('razorpay')}>
          Switch to Razorpay
        </button>
      </p>
    </div>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'verified' | 'uncertain' | 'failed' }) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'tnum mt-1 text-[32px] font-bold leading-none tracking-tight',
          tone === 'verified' && 'text-[hsl(var(--verdict-verified))]',
          tone === 'uncertain' && 'text-[hsl(var(--verdict-uncertain))]',
          tone === 'failed' && 'text-[hsl(var(--verdict-failed))]',
        )}
      >
        {value}
      </dd>
      <dd className="mt-1 text-[13px] text-muted-foreground">{hint}</dd>
    </div>
  )
}

function AttentionRow({ rec, onOpen }: { rec: SettlementRecord; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
      <span className="tnum w-[92px] text-[18px] font-bold tracking-tight">{moneyShort(rec.amount_paise)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={rec.status} />
          <span className="text-[14px] font-medium">{reasonLine(rec) || statusLabel(rec.status).sub}</span>
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {rec.merchant} · {fmtDate(rec.decision_time)} · <span className="font-mono text-[12px]">{rec.settlement_id}</span>
        </div>
      </div>
      <Button variant="secondary" onClick={onOpen}>
        View why
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Settlements / Exceptions                                                  */
/* ------------------------------------------------------------------------ */

export function SettlementList({
  records,
  selectedKey,
  onSelect,
  filters,
  onFilters,
  sort,
  onSort,
  showNextAction = false,
  now,
}: {
  records: SettlementRecord[]
  selectedKey: string | null
  onSelect: (rec: SettlementRecord) => void
  filters: Filters
  onFilters: (f: Filters) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  showNextAction?: boolean
  now: number
}) {
  const reasons = useMemo(() => reasonsPresent(records), [records])
  const visible = useMemo(() => sortRecords(filterRecords(records, filters), sort), [records, filters, sort])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = visible.findIndex((r) => r.key === selectedKey)
    const next = visible[Math.min(visible.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) onSelect(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search settlements</span>
          <input
            value={filters.q}
            onChange={(e) => onFilters({ ...filters, q: e.target.value })}
            placeholder="Search settlements, merchants, reasons…"
            className="h-9 w-full rounded-md border border-border bg-card px-3 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:border-primary"
          />
        </label>
        <Select
          label="Status"
          value={filters.status}
          onChange={(v) => onFilters({ ...filters, status: v as Filters['status'] })}
          options={[['ALL', 'All statuses'], ['FAILED', 'Failed'], ['UNCERTAIN', 'Review required'], ['VERIFIED', 'Verified'], ['PENDING', 'Awaiting verdict']]}
        />
        <Select
          label="Reason"
          value={filters.reason}
          onChange={(v) => onFilters({ ...filters, reason: v })}
          options={[['ALL', 'All reasons'], ...reasons.map((r) => [r, reasonLabel(r)] as [string, string])]}
        />
        <Select label="Sort" value={sort} onChange={(v) => onSort(v as SortKey)} options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => [k, SORT_LABEL[k]])} />
      </div>

      <div className="text-[12px] text-muted-foreground">
        {visible.length} of {records.length} · ↑↓ to move
      </div>

      <ul role="listbox" aria-label="Settlements" tabIndex={0} onKeyDown={onKey} className="mt-2 min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-[14px] text-muted-foreground">No settlements match.</li>
        ) : (
          visible.map((r) => {
            const selected = r.key === selectedKey
            return (
              <li key={r.key} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => onSelect(r)}
                  data-key={r.key}
                  className={cn(
                    'grid w-full items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/50',
                    showNextAction ? 'grid-cols-[84px_minmax(0,1fr)] md:grid-cols-[84px_minmax(0,1fr)_auto]' : 'grid-cols-[84px_minmax(0,1fr)]',
                    selected && 'bg-accent',
                  )}
                >
                  <span className="tnum text-[16px] font-bold tracking-tight">{moneyShort(r.amount_paise)}</span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusPill status={r.status} />
                      <span className="truncate text-[14px] font-medium">{reasonLine(r) || (r.status === 'VERIFIED' ? 'Evidence matched' : statusLabel(r.status).sub)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                      {r.merchant} · {fmtDate(r.decision_time)}
                      {showNextAction ? ` · ${ageDays(r.decision_time, now)}d old` : ''} · <span className="font-mono">{r.settlement_id}</span>
                    </span>
                  </span>
                  {showNextAction ? <span className="hidden whitespace-nowrap text-right text-[12px] font-medium text-primary md:block">{nextAction(r)}</span> : null}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:border-primary">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ------------------------------------------------------------------------ */
/* Selected settlement                                                       */
/* ------------------------------------------------------------------------ */

export function SettlementDetail({
  detail,
  loading,
  error,
  onWhy,
  onEvidence,
}: {
  detail: DetailModel | null
  loading: boolean
  error: string | null
  onWhy: () => void
  onEvidence: () => void
}) {
  if (loading) return <DetailFrame><div className="h-40 animate-pulse rounded-md bg-muted/60" /></DetailFrame>
  if (error) return <DetailFrame><p className="text-[14px] text-[hsl(var(--verdict-failed))]">Could not load this settlement: {error}</p></DetailFrame>
  if (!detail) return <DetailFrame><p className="text-[14px] text-muted-foreground">Select a settlement.</p></DetailFrame>

  const { record: r, result, proposal } = detail
  const s = statusLabel(r.status)
  const tone = r.status === 'VERIFIED' ? 'text-[hsl(var(--verdict-verified))]' : r.status === 'UNCERTAIN' ? 'text-[hsl(var(--verdict-uncertain))]' : r.status === 'FAILED' ? 'text-[hsl(var(--verdict-failed))]' : 'text-muted-foreground'

  return (
    <DetailFrame>
      <div className="text-[13px] text-muted-foreground">
        {r.merchant} · Settlement <span className="font-mono text-[12px]">{r.settlement_id}</span> · {SOURCE_LABEL[r.source]}
      </div>
      <div className="mt-2 tnum text-[44px] font-bold leading-none tracking-tight sm:text-[48px]">{money(r.amount_paise)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <StatusPill status={r.status} size="md" />
        <span className={cn('text-[15px] font-semibold', tone)}>{s.sub.toUpperCase()}</span>
      </div>
      <p className="mt-2 text-[15px]">
        {r.reason_code ? (
          <><span className="tnum font-medium">{reasonLine(r)}</span></>
        ) : r.status === 'VERIFIED' ? (
          'Evidence matched.'
        ) : r.status === 'PENDING' ? (
          'No model was available to propose a claim, so nothing was verified. No stand-in is used.'
        ) : null}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onWhy}>{r.status === 'VERIFIED' ? 'View proof' : 'View why'}</Button>
        <Button variant="secondary" onClick={onEvidence}>View evidence</Button>
        {r.status !== 'VERIFIED' && r.status !== 'PENDING' ? <span className="inline-flex items-center text-[13px] text-muted-foreground">Next: {nextAction(r)}</span> : null}
      </div>

      {result ? (
        <dl className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          <Figure k="Expected" v={result.expected_paise != null ? formatPaise(result.expected_paise) : '—'} />
          <Figure k="Observed" v={result.observed_paise != null ? formatPaise(result.observed_paise) : '—'} />
          <Figure k="Difference" v={formatDelta(result.difference_paise)} tone={result.difference_paise ? 'failed' : 'verified'} />
          <Figure k="Policy fee" v={result.policy_fee_paise != null ? formatPaise(result.policy_fee_paise) : '—'} />
          <Figure k="Fee delta" v={formatDelta(result.fee_delta_paise)} tone={result.fee_delta_paise ? 'failed' : undefined} />
        </dl>
      ) : null}

      {proposal ? (
        <p className="mt-5 text-[13px] text-muted-foreground">
          Agent proposal <span className="font-medium text-foreground">{proposal.claim.proposed_status}</span> · {Math.round(proposal.confidence * 100)}% confidence — recorded, not used as proof.
        </p>
      ) : null}
    </DetailFrame>
  )
}

function DetailFrame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-5 sm:p-6">{children}</div>
}

function Figure({ k, v, tone }: { k: string; v: string; tone?: 'failed' | 'verified' }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">{k}</dt>
      <dd className={cn('tnum mt-1 text-[18px] font-semibold', tone === 'failed' && 'text-[hsl(var(--verdict-failed))]', tone === 'verified' && 'text-[hsl(var(--verdict-verified))]')}>{v}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Evidence                                                                  */
/* ------------------------------------------------------------------------ */

const KIND_LABEL: Record<string, string> = {
  payment: 'Payment',
  settlement: 'Settlement',
  bank_credit: 'Bank credit',
  refund: 'Refund',
  hold: 'Hold',
  webhook_event: 'Webhook',
}

export function EvidenceView({ detail }: { detail: DetailModel | null }) {
  const [open, setOpen] = useState<EvidenceItem | null>(null)
  const [showPayments, setShowPayments] = useState(false)
  if (!detail) {
    return (
      <div>
        <PageHeader title="Evidence" sub="Select a settlement to inspect the records its decision rests on." />
      </div>
    )
  }
  const { pack, result, record: r } = detail
  const used = new Set(result?.evidence_ids_used ?? [])
  const payments = pack.evidence.filter((e) => e.kind === 'payment')
  const rest = pack.evidence.filter((e) => e.kind !== 'payment')
  const rows = showPayments ? [...rest, ...payments] : rest
  const provenance = pack.evidence[0]?.provenance

  return (
    <div>
      <PageHeader title="Evidence" sub={`${r.merchant} · ${r.settlement_id} · ${money(r.amount_paise)}`} />

      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Fact k="Source" v={provenance?.label ?? SOURCE_LABEL[r.source]} />
        <Fact k="Captured" v={`${fmtTime(pack.event_time)} · decided ${fmtTime(pack.decision_time)}`} />
        <Fact k="Policy" v={`${pack.policy_snapshot.version} · fee tolerance ${formatPaise(pack.policy_snapshot.fee_tolerance_paise)}`} />
        <Fact k="Verifier" v={result ? `AVOS ${result.verifier_version} · ${result.checks.length} checks` : 'AVOS · not run'} />
      </dl>

      <div className="mt-6">
        <SectionTitle
          right={
            payments.length ? (
              <button type="button" onClick={() => setShowPayments((v) => !v)} className="text-[13px] font-medium text-primary hover:underline">
                {showPayments ? 'Hide' : 'Show'} {payments.length} payment rows
              </button>
            ) : null
          }
        >
          Records · {pack.evidence.length}
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="text-[12px] uppercase tracking-label text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-semibold">Source</th>
                <th className="px-3 py-2 text-left font-semibold">Record</th>
                <th className="px-3 py-2 text-left font-semibold">Captured</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-left font-semibold">Used in verification</th>
                <th className="px-3 py-2 text-left font-semibold">Integrity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => (
                <tr key={e.evidence_id} className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => setOpen(e)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && setOpen(e)}>
                  <td className="px-3 py-2">{KIND_LABEL[e.kind] ?? e.kind}<span className="block text-[12px] text-muted-foreground">{e.provenance.label}</span></td>
                  <td className="px-3 py-2"><Mono>{e.row_id}</Mono></td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtTime(e.timestamp)}</td>
                  <td className="tnum px-3 py-2 text-right">{formatPaise(e.amount_paise)}</td>
                  <td className="px-3 py-2">{used.has(e.evidence_id) ? <span className="inline-flex items-center gap-1 text-[hsl(var(--verdict-verified))]"><IconCheck className="h-3.5 w-3.5" /> Used</span> : <span className="text-muted-foreground">Retrieved</span>}</td>
                  <td className="px-3 py-2">{e.hash_matches_recorded ? <span className="text-muted-foreground">Matches baseline</span> : <span className="text-[hsl(var(--verdict-failed))]">Differs from baseline</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Open a record for its source file, full hash, join keys and the checks that read it.</p>
      </div>

      {r.source === 'evaluation' ? (
        <details className="group mt-6 rounded-lg border border-border bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">Ask about this settlement</summary>
          <div className="border-t border-border p-4">
            <QaPanel caseId={r.case_id} />
          </div>
        </details>
      ) : null}

      {open ? <RowDetail item={open} checks={result?.checks ?? []} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-[12px] font-semibold uppercase tracking-label text-muted-foreground">{k}</dt>
      <dd className="mt-1 text-[14px]">{v}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Controls                                                                  */
/* ------------------------------------------------------------------------ */

export function ControlsView({ policies, detail, policyPoints }: { policies: PolicySnapshot[]; detail: DetailModel | null; policyPoints: { label: string; at: string; tolerance_paise: number }[] }) {
  const current = policies[policies.length - 1]
  return (
    <div>
      <PageHeader title="Controls" sub="The policy AVOS applies is the one in force at decision time, never today's." />
      {current ? (
        <div className="rounded-lg border border-border bg-card p-5">
          <SectionTitle>Current policy</SectionTitle>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact k="Version" v={current.version} />
            <Fact k="In force from" v={fmtTime(current.effective_at)} />
            <Fact k="Fee tolerance" v={formatPaise(current.fee_tolerance_paise)} />
            <Fact k="Rate card" v={`${current.fee_rate_bps} bps + ${current.gst_rate_bps} bps GST`} />
          </dl>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-[14px] font-semibold">Historical policy</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="text-[12px] uppercase tracking-label text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-2 text-left font-semibold">Version</th>
                <th className="px-5 py-2 text-left font-semibold">In force from</th>
                <th className="px-5 py-2 text-right font-semibold">Fee tolerance</th>
                <th className="px-5 py-2 text-right font-semibold">Rate card</th>
                <th className="px-5 py-2 text-right font-semibold">Max lag</th>
                <th className="px-5 py-2 text-right font-semibold">Freshness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.map((p) => (
                <tr key={p.version}>
                  <td className="px-5 py-2">{p.version}</td>
                  <td className="px-5 py-2 text-muted-foreground">{fmtTime(p.effective_at)}</td>
                  <td className="tnum px-5 py-2 text-right">{formatPaise(p.fee_tolerance_paise)}</td>
                  <td className="tnum px-5 py-2 text-right">{p.fee_rate_bps} bps</td>
                  <td className="tnum px-5 py-2 text-right">{p.max_settlement_lag_days} d</td>
                  <td className="tnum px-5 py-2 text-right">{p.evidence_freshness_max_hours} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <SectionTitle>Replay a decision</SectionTitle>
        {detail && detail.result && detail.record.source === 'evaluation' ? (
          <>
            <p className="mb-4 text-[14px] text-muted-foreground">
              Re-verify <span className="font-medium text-foreground">{detail.record.settlement_id}</span> ({money(detail.record.amount_paise)}) under a different policy epoch. Same evidence, same hashes, same arithmetic — only the rule changes.
            </p>
            <ReplayView caseId={detail.record.case_id} decisionTime={detail.pack.decision_time} policyPoints={policyPoints} current={detail.result} />
          </>
        ) : (
          <p className="text-[14px] text-muted-foreground">
            {detail?.record.source === 'razorpay' ? 'Replay needs a recorded decision; live settlements are verified fresh on every sync.' : 'Select a settlement from the evaluation dataset to replay its decision under another policy.'}
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Evaluation                                                                */
/* ------------------------------------------------------------------------ */

export function EvaluationView({ report, onOpenDataset }: { report: EvalReport | null; onOpenDataset: () => void }) {
  if (!report) return <PageHeader title="AVOS Evaluation" sub="No evaluation on record. Run npm run eval." />
  const m = report.batch_120
  const gate = report.gates.find((g) => /verifier unit tests/i.test(g.name))
  const stats: [string, string, string, boolean][] = [
    [formatPct(m.false_closure_rate, 0), 'False closure', `${m.false_closure_cases.length} of ${m.n}`, true],
    [formatPct(m.verification_precision, 0), 'Verification precision', 'every VERIFIED was correct', true],
    [formatPct(m.exception_detection_rate, 0), 'Injected exceptions caught', `${m.exceptions_caught} of ${m.exceptions_injected}`, true],
    [`${report.isolation.filter((i) => i.passed).length}/${report.isolation.length}`, 'Isolation checks', 'verifier imports nothing', false],
    [gate?.detail.match(/(\d+)\/(\d+)/)?.[0] ?? '—', 'Verifier checks', 'unit tests over verifyClaim', false],
    [`${report.adversarial_tests.filter((t) => t.passed).length}/${report.adversarial_tests.length}`, 'Adversarial coverage', 'attacks it must survive', false],
    [formatPct(m.match_rate), 'Match rate', `${m.ambiguous_count} ambiguous sent to review`, false],
    [`${(m.throughput_records_per_sec / 1000).toFixed(1)}k/s`, 'Verify throughput', 'deterministic, no model', false],
  ]
  return (
    <div>
      <PageHeader
        title="AVOS Evaluation"
        sub={`${m.n} synthetic, seeded, labelled settlements — how the verifier is proven. Not Razorpay transactions.`}
        right={<Button variant="secondary" onClick={onOpenDataset}>Open dataset in Settlements <IconArrowRight className="h-4 w-4" /></Button>}
      />
      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([v, k, hint, good]) => (
          <div key={k} className="bg-card px-5 py-4">
            <dd className={cn('tnum text-[28px] font-bold leading-none tracking-tight', good && 'text-[hsl(var(--verdict-verified))]')}>{v}</dd>
            <dt className="mt-1.5 text-[14px] font-medium">{k}</dt>
            <dd className="mt-0.5 text-[12px] text-muted-foreground">{hint}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <GateList title={`Acceptance gates · ${report.gates.filter((g) => g.passed).length}/${report.gates.length}`} items={report.gates.map((g) => [g.name, g.detail, g.passed])} />
        <GateList title={`Adversarial suite · ${report.adversarial_tests.filter((t) => t.passed).length}/${report.adversarial_tests.length}`} items={report.adversarial_tests.map((t) => [t.name, t.detail, t.passed])} />
        <GateList title={`Verifier isolation · ${report.isolation.filter((i) => i.passed).length}/${report.isolation.length}`} items={report.isolation.map((i) => [i.id, i.detail, i.passed])} mono />
      </div>
      <p className="mt-4 text-[12px] text-muted-foreground">
        Generated {report.generated_at} · verifier {report.verifier_version}. These gates run in CI on every commit and fail the build.
      </p>
    </div>
  )
}

function GateList({ title, items, mono }: { title: string; items: [string, string, boolean][]; mono?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3 text-[14px] font-semibold">{title}</div>
      <ul className="max-h-[420px] divide-y divide-border overflow-y-auto scrollbar-thin">
        {items.map(([name, detail, ok]) => (
          <li key={name} className="flex gap-2.5 px-4 py-2.5">
            {ok ? <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--verdict-verified))]" /> : <IconCross className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--verdict-failed))]" />}
            <div className="min-w-0">
              <div className={cn('text-[13px] font-medium', mono && 'font-mono text-[12px]')}>{name}</div>
              <div className="text-[12px] leading-relaxed text-muted-foreground">{detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Architecture                                                              */
/* ------------------------------------------------------------------------ */

export function ArchitectureView({ verifierVersion, manifest }: { verifierVersion: string; manifest: { seed: number | string; payments: number; settlements: number; bank: number } }) {
  const stages: [string, string, string][] = [
    ['Razorpay', 'Settlements, reconciliation rows, payments and refunds are read over four GET endpoints. Read-only; every request is logged.', 'lib/connectors/razorpay.ts'],
    ['AVOS Ledger', 'Everything becomes integer paise and ISO time. Merchant notes are dropped at the door. Provenance is stamped on every row.', 'normalizeRazorpay · lib/data/ledger.ts'],
    ['AI proposal', 'A live model proposes a status and cites the rows it relied on. Without a model, no claim is made — nothing is substituted.', 'proposeClaimStrict · lib/ai/agent.ts'],
    ['Evidence', 'Each row is hashed, stamped with the rate card in force when its fact occurred, and labelled with where it came from.', 'buildEvidencePack · lib/evidence/pack.ts'],
    ['Independent verifier', `Recomputes the money from the evidence with no model, clock, network or filesystem. ${verifierVersion}, asserted on every run.`, 'verifyClaim · lib/verifier/deterministic.ts'],
    ['Decision', 'VERIFIED closes. UNCERTAIN is held for review. FAILED is an exception with a named owner and a stated resolution.', 'closeRecord · lib/closure.ts'],
  ]
  return (
    <div>
      <PageHeader title="Architecture" sub="The runtime path every settlement takes. Each stage is a function that executes on sync." />
      <ol className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
        {stages.map(([name, body, code], i) => (
          <li key={name} className="bg-card">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{i + 1}</span>
                <span className="text-[15px] font-semibold">{name}</span>
                <span className="ml-auto text-[12px] text-muted-foreground group-open:hidden">details</span>
              </summary>
              <div className="border-t border-border px-5 py-3 pl-16 text-[14px] text-muted-foreground">
                {body}
                <div className="mt-2"><Mono>{code}</Mono></div>
              </div>
            </details>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12px] text-muted-foreground">
        The evaluation dataset runs the same stages from committed CSVs (seed {String(manifest.seed)}: {manifest.payments} payments, {manifest.settlements} settlements, {manifest.bank} bank rows) and shares no data with the Razorpay path. Razorpay has no bank-statement endpoint, so a Razorpay-only ledger carries no bank rows and the verifier says so.
      </p>
    </div>
  )
}
