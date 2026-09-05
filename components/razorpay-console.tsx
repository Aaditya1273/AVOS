'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Mono } from '@/components/ui/primitives'
import { ProofCard } from '@/components/proof-card'
import { EvidenceInspector } from '@/components/evidence-inspector'
import { VerdictBadge } from '@/components/verdict'
import { IconCheck, IconCross, IconHold, IconReplay } from '@/components/ui/icon'
import { formatPaise } from '@/lib/money'
import { cn, fmtTime } from '@/lib/utils'
// Type-only. `lib/razorpay/runtime` reaches the connector, which throws if it
// is ever evaluated in a browser; a type import is erased and never is.
import type { RazorpayCaseResult, RazorpaySyncPayload } from '@/lib/razorpay/runtime'
import type { Decision } from '@/lib/types'

/**
 * The product surface.
 *
 * Everything on this screen is a field of one JSON response from
 * `/api/razorpay/sync`, which is itself the record of one set of GET requests
 * to Razorpay made moments ago. There is no other data source in this file:
 * no fixture, no fallback, no cached number. If the response says zero, the
 * screen says zero.
 *
 * The sync runs once on mount so a reviewer sees state without clicking, and
 * again on demand. Both go through the same route.
 */

type Phase = 'idle' | 'syncing' | 'done'

interface PolicyPoint {
  label: string
  at: string
  tolerance_paise: number
}

export function RazorpayConsole({ policyPoints }: { policyPoints: PolicyPoint[] }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [payload, setPayload] = useState<RazorpaySyncPayload | null>(null)
  const [transportError, setTransportError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const sync = useCallback(async () => {
    setPhase('syncing')
    setTransportError(null)
    try {
      const res = await fetch('/api/razorpay/sync', { method: 'POST', cache: 'no-store' })
      const json = (await res.json()) as RazorpaySyncPayload | { error: string; detail?: string }
      if (!res.ok || 'error' in json) {
        const err = json as { error: string; detail?: string }
        setTransportError(`${err.error}${err.detail ? ` — ${err.detail}` : ''}`)
        setPayload(null)
      } else {
        setPayload(json)
        setSelected((cur) => cur ?? json.cases[0]?.case_id ?? null)
      }
    } catch (e) {
      setTransportError((e as Error).message)
      setPayload(null)
    } finally {
      setPhase('done')
    }
  }, [])

  useEffect(() => {
    void sync()
  }, [sync])

  const current = useMemo(
    () => payload?.cases.find((c) => c.case_id === selected) ?? payload?.cases[0] ?? null,
    [payload, selected],
  )

  return (
    <div className="flex flex-col gap-5">
      <ConnectionCard payload={payload} phase={phase} transportError={transportError} onSync={sync} />

      {payload ? (
        <>
          <CountsCard payload={payload} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ActivityCard payload={payload} />
            <AgentCard payload={payload} />
          </div>
          <CasesSection payload={payload} current={current} onSelect={setSelected} policyPoints={policyPoints} />
          <UnsettledSection payload={payload} />
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<RazorpaySyncPayload['connection']['state'], string> = {
  CONNECTED: 'Connected',
  AUTHENTICATION_FAILED: 'Authentication failed',
  NOT_CONFIGURED: 'Not configured',
  UNAVAILABLE: 'Unavailable',
}

function ConnectionCard({
  payload,
  phase,
  transportError,
  onSync,
}: {
  payload: RazorpaySyncPayload | null
  phase: Phase
  transportError: string | null
  onSync: () => void
}) {
  const state = payload?.connection.state ?? null
  const mode = payload?.mode ?? null
  const syncing = phase === 'syncing'

  return (
    <Card className="overflow-hidden shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
            Razorpay {mode === 'live' ? 'Live' : mode === 'test' ? 'Test' : ''} API
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <StateGlyph state={syncing ? 'SYNCING' : state} />
            <span className="text-xl font-bold tracking-tight">
              {syncing ? 'Syncing…' : state ? STATE_LABEL[state] : transportError ? 'Sync failed' : '—'}
            </span>
          </div>
          <p className="mt-1.5 max-w-2xl text-compact leading-relaxed text-muted-foreground">
            {syncing
              ? 'Reading settlements, recon report, payments and refunds from Razorpay…'
              : (payload?.connection.detail ?? transportError ?? 'No sync has run yet.')}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Button onClick={onSync} disabled={syncing} className="gap-2">
            <IconReplay className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? 'Syncing' : 'Sync Razorpay'}
          </Button>
          {payload ? <OutcomeBadge outcome={payload.outcome} /> : null}
        </div>
      </div>

      <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-4">
        <Fact label="Environment" value={mode ? mode.toUpperCase() : '—'} />
        <Fact label="Access" value="READ ONLY" />
        <Fact
          label="Last sync"
          value={payload ? fmtTime(payload.fetched_at) : '—'}
          mono={false}
        />
        <Fact label="Key" value={payload?.connection.key_id_prefix ? `${payload.connection.key_id_prefix}…` : '—'} />
      </dl>
    </Card>
  )
}

function StateGlyph({ state }: { state: RazorpaySyncPayload['connection']['state'] | 'SYNCING' | null }) {
  const cls = 'flex h-6 w-6 items-center justify-center rounded-full'
  switch (state) {
    case 'CONNECTED':
      return (
        <span className={cn(cls, 'bg-[hsl(var(--verdict-verified)/0.12)] text-[hsl(var(--verdict-verified))]')}>
          <IconCheck className="h-3.5 w-3.5" />
        </span>
      )
    case 'AUTHENTICATION_FAILED':
      return (
        <span className={cn(cls, 'bg-[hsl(var(--verdict-failed)/0.12)] text-[hsl(var(--verdict-failed))]')}>
          <IconCross className="h-3.5 w-3.5" />
        </span>
      )
    case 'UNAVAILABLE':
      return (
        <span className={cn(cls, 'bg-[hsl(var(--verdict-uncertain)/0.12)] text-[hsl(var(--verdict-uncertain))]')}>
          <IconHold className="h-3.5 w-3.5" />
        </span>
      )
    case 'SYNCING':
      return <span className={cn(cls, 'bg-muted text-muted-foreground')}><IconReplay className="h-3.5 w-3.5 animate-spin" /></span>
    default:
      return <span className={cn(cls, 'border border-border text-muted-foreground')} aria-hidden>{'○'}</span>
  }
}

function OutcomeBadge({ outcome }: { outcome: RazorpaySyncPayload['outcome'] }) {
  return (
    <Badge variant={outcome === 'SUCCESS' ? 'verified' : outcome === 'EMPTY' ? 'outline' : 'failed'}>
      sync · {outcome.toLowerCase()}
    </Badge>
  )
}

function Fact({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card px-5 py-3">
      <dt className="text-micro font-semibold uppercase tracking-label text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 text-compact font-medium', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Counts — exactly what Razorpay returned
// ---------------------------------------------------------------------------

function CountsCard({ payload }: { payload: RazorpaySyncPayload }) {
  const c = payload.counts
  return (
    <Card className="shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
        <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
          Returned by Razorpay
        </span>
        <span className="text-mini text-muted-foreground">
          {payload.truncated
            ? 'a collection hit the page ceiling — these counts are a floor'
            : 'counts are the lengths of the paged API responses, not computed by AVOS'}
        </span>
      </div>
      <dl className="grid gap-px bg-border sm:grid-cols-4">
        <Count label="Settlements" value={c.settlements} hint="GET /v1/settlements" />
        <Count label="Settlement recon rows" value={c.recon_rows} hint="GET /v1/settlements/recon/combined" />
        <Count label="Payments" value={c.payments} hint="GET /v1/payments" />
        <Count label="Refunds" value={c.refunds} hint="GET /v1/refunds" />
      </dl>
    </Card>
  )
}

function Count({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="text-micro font-semibold uppercase tracking-label text-muted-foreground">{label}</dt>
      <dd className="tnum mt-1 text-3xl font-bold tracking-tight">{value}</dd>
      <dd className="mt-0.5 font-mono text-micro text-muted-foreground">{hint}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// API activity
// ---------------------------------------------------------------------------

function ActivityCard({ payload }: { payload: RazorpaySyncPayload }) {
  return (
    <Card className="overflow-hidden shadow-panel">
      <div className="flex items-baseline justify-between border-b border-border px-5 py-3">
        <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
          Razorpay API activity
        </span>
        <span className="text-mini text-muted-foreground">this sync · {payload.activity.length} request(s)</span>
      </div>
      {payload.activity.length === 0 ? (
        <p className="px-5 py-4 text-compact text-muted-foreground">{payload.connection.detail}</p>
      ) : (
        <ul className="divide-y divide-border">
          {payload.activity.map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-compact">
              <span className="font-mono text-mini font-semibold">{a.method}</span>
              <span className="font-mono text-mini">{a.endpoint}</span>
              <span
                className={cn(
                  'ml-auto font-mono text-mini font-semibold',
                  a.ok ? 'text-[hsl(var(--verdict-verified))]' : 'text-[hsl(var(--verdict-failed))]',
                )}
              >
                {a.status === null ? 'no response' : `${a.status} ${a.ok ? 'OK' : ''}`.trim()}
              </span>
              {a.count !== null ? <span className="tnum text-mini text-muted-foreground">count {a.count}</span> : null}
              <span className="tnum text-mini text-muted-foreground">{a.elapsed_ms} ms</span>
              {a.error ? <span className="basis-full text-mini text-[hsl(var(--verdict-failed))]">{a.error}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border px-5 py-2.5 text-mini text-muted-foreground">
        Every request is a literal GET. The Authorization header is built inside the connector and is not part of this log.
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// AI agent
// ---------------------------------------------------------------------------

function AgentCard({ payload }: { payload: RazorpaySyncPayload }) {
  const a = payload.agent
  const ok = a.state === 'available'
  return (
    <Card className="shadow-panel">
      <div className="flex items-baseline justify-between border-b border-border px-5 py-3">
        <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">AI reconciliation agent</span>
        <Badge variant={ok ? 'verified' : 'uncertain'}>{ok ? 'available' : 'unavailable'}</Badge>
      </div>
      <div className="px-5 py-4">
        <div className="text-body font-semibold">{ok ? `Live model · ${a.model}` : 'AI agent unavailable'}</div>
        <p className="mt-1 text-compact leading-relaxed text-muted-foreground">{a.detail}</p>
        <p className="mt-3 text-mini leading-relaxed text-muted-foreground">
          The agent proposes a <Mono>StructuredClaim</Mono>; the verifier <Mono>{payload.verifier_version}</Mono> checks
          it independently and never reads the model&rsquo;s confidence or rationale. With no model there is no claim,
          so settlements below are shown with their evidence and without a verdict. No stand-in is substituted.
        </p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Settlement cases
// ---------------------------------------------------------------------------

function CasesSection({
  payload,
  current,
  onSelect,
  policyPoints,
}: {
  payload: RazorpaySyncPayload
  current: RazorpayCaseResult | null
  onSelect: (id: string) => void
  policyPoints: PolicyPoint[]
}) {
  if (payload.cases.length === 0) {
    return (
      <Card className="p-5 shadow-panel">
        <div className="text-body font-semibold">0 settlements to verify</div>
        <p className="mt-1 max-w-3xl text-compact leading-relaxed text-muted-foreground">
          {payload.connection.state === 'CONNECTED'
            ? 'Razorpay returned no settlements for the current and previous month. Nothing has been substituted for them.'
            : 'No settlements were read because the Razorpay connection is not available.'}
          {payload.mode === 'test' && payload.connection.state === 'CONNECTED' ? (
            <>
              {' '}
              Test-mode payments are simulated and no money moves, so there is nothing for the T+2 bank
              settlement cycle to settle; payments made with a test key appear under{' '}
              <span className="text-foreground">Unsettled</span> below until a settlement exists for them.
            </>
          ) : null}
        </p>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="overflow-hidden shadow-panel">
        <div className="border-b border-border px-4 py-3 text-micro font-semibold uppercase tracking-label text-muted-foreground">
          Settlements · {payload.cases.length}
        </div>
        <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto scrollbar-thin">
          {payload.cases.map((c) => (
            <li key={c.case_id}>
              <button
                type="button"
                onClick={() => onSelect(c.case_id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60',
                  current?.case_id === c.case_id && 'bg-accent',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-compact font-semibold">{c.settlement_id}</div>
                  <div className="text-mini text-muted-foreground">
                    {c.pack.evidence.length} evidence rows
                    {c.result?.reason_code ? ` · ${c.result.reason_code}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tnum text-compact">{formatPaise(c.value_paise)}</span>
                  {c.result ? (
                    <VerdictBadge verdict={c.result.verdict} size="sm" />
                  ) : (
                    <span className="text-micro uppercase tracking-label text-muted-foreground">no claim</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {current ? <CaseDetail c={current} policyPoints={policyPoints} /> : null}
    </div>
  )
}

function CaseDetail({ c, policyPoints }: { c: RazorpayCaseResult; policyPoints: PolicyPoint[] }) {
  if (c.proposal && c.result && c.closure) {
    const decision: Decision = {
      case_id: c.case_id,
      suite: 'razorpay',
      proposal: c.proposal,
      pack: c.pack,
      result: c.result,
      batch_value_paise: c.value_paise,
      closure: c.closure,
    }
    return (
      <ProofCard
        payload={{ decision, narration: c.narration, injection: c.injection }}
        policyPoints={policyPoints}
        capabilities={{ replay: false, ask: false }}
      />
    )
  }

  // No claim to verify. The evidence is real and is shown; a verdict is not
  // invented to fill the space.
  return (
    <Card className="overflow-hidden shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-lg font-bold tracking-tight">{c.settlement_id}</h2>
          <span className="text-compact text-muted-foreground">{c.merchant_id}</span>
          <span className="tnum text-compact font-medium">{formatPaise(c.value_paise)}</span>
        </div>
        <Badge variant="outline">{c.pack.evidence[0]?.provenance.label ?? 'Razorpay API'}</Badge>
      </div>
      <div className="border-b border-border bg-[hsl(var(--verdict-uncertain)/0.06)] px-5 py-3">
        <div className="text-compact font-semibold text-[hsl(var(--verdict-uncertain))]">
          {c.agent_error ? 'Agent call failed' : 'AI agent unavailable'} — no claim to verify
        </div>
        <p className="mt-0.5 text-mini text-muted-foreground">
          {c.agent_error ?? 'Configure a model key on the server to have a model propose a claim for this settlement.'}{' '}
          The verifier runs only on a claim; it has not been given a scripted one.
        </p>
      </div>
      <div className="px-5 py-4">
        <EvidenceInspector pack={c.pack} checks={[]} citedIds={[]} injectionRows={c.injection.rows} />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Unsettled entities
// ---------------------------------------------------------------------------

function UnsettledSection({ payload }: { payload: RazorpaySyncPayload }) {
  const { payments, refunds } = payload.unsettled
  if (payments.length === 0 && refunds.length === 0) return null
  return (
    <Card className="overflow-hidden shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
        <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
          Unsettled · returned by Razorpay, not yet in a settlement
        </span>
        <span className="text-mini text-muted-foreground">
          real entities; verifiable once Razorpay settles them
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-compact">
          <thead className="bg-muted/60 text-micro uppercase tracking-label text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Entity</th>
              <th className="px-4 py-2 text-left font-medium">Kind</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Method</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-mono text-mini">{p.id}</td>
                <td className="px-4 py-2">payment</td>
                <td className="px-4 py-2"><Mono>{p.status}</Mono></td>
                <td className="px-4 py-2">{p.method ?? '—'}</td>
                <td className="tnum px-4 py-2 text-right">{formatPaise(p.amount_paise)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtTime(p.created_at)}</td>
              </tr>
            ))}
            {refunds.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-mono text-mini">{r.id}</td>
                <td className="px-4 py-2">refund · {r.payment_id}</td>
                <td className="px-4 py-2"><Mono>{r.status}</Mono></td>
                <td className="px-4 py-2">—</td>
                <td className="tnum px-4 py-2 text-right">{formatPaise(r.amount_paise)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
