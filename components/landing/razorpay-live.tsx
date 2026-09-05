'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Mono } from '@/components/ui/primitives'
import { IconCheck, IconCross, IconHold } from '@/components/ui/icon'
import { cn, fmtTime } from '@/lib/utils'
import type { RazorpaySyncPayload } from '@/lib/razorpay/runtime'

/**
 * The one block on the landing page that talks to Razorpay — and it does so
 * for real, through the same `/api/razorpay/sync` the console uses, when the
 * block scrolls into view. Nothing here is pre-rendered as "connected": until
 * the request returns, it says it is checking; after, it shows what came back,
 * including the endpoints and their status codes. A visitor with no
 * credentials on the server sees "Not configured", which is the truth.
 */
export function RazorpayLive() {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'checking' | 'done'>('idle')
  const [payload, setPayload] = useState<RazorpaySyncPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        setState('checking')
        fetch('/api/razorpay/sync', { method: 'POST', cache: 'no-store' })
          .then(async (r) => {
            const j = (await r.json()) as RazorpaySyncPayload | { error: string }
            if (!r.ok || 'error' in j) throw new Error((j as { error: string }).error)
            setPayload(j)
          })
          .catch((e: Error) => setError(e.message))
          .finally(() => setState('done'))
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const c = payload?.connection
  const tone =
    c?.state === 'CONNECTED' ? 'verified' : c?.state === 'NOT_CONFIGURED' ? 'muted' : c ? 'failed' : 'muted'

  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-border bg-card shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div>
          <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
            Razorpay {payload?.mode === 'live' ? 'Live' : 'Test'} API
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full',
                tone === 'verified' && 'bg-[hsl(var(--verdict-verified)/0.12)] text-[hsl(var(--verdict-verified))]',
                tone === 'failed' && 'bg-[hsl(var(--verdict-failed)/0.12)] text-[hsl(var(--verdict-failed))]',
                tone === 'muted' && 'border border-border text-muted-foreground',
              )}
              aria-hidden
            >
              {tone === 'verified' ? <IconCheck className="h-3.5 w-3.5" /> : tone === 'failed' ? <IconCross className="h-3.5 w-3.5" /> : <IconHold className="h-3.5 w-3.5" />}
            </span>
            <span className="text-xl font-semibold tracking-tight">
              {state === 'checking' || state === 'idle'
                ? 'Checking…'
                : c
                  ? { CONNECTED: 'Connected', NOT_CONFIGURED: 'Not configured', AUTHENTICATION_FAILED: 'Authentication failed', UNAVAILABLE: 'Unavailable' }[c.state]
                  : 'Check failed'}
            </span>
          </div>
          <p className="mt-1.5 max-w-xl text-compact leading-relaxed text-muted-foreground">
            {state !== 'done'
              ? 'Making read-only requests to Razorpay from the server, right now.'
              : (c?.detail ?? error ?? '')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 text-mini text-muted-foreground">
          <Badge variant="outline">read-only</Badge>
          {payload ? <span>checked {fmtTime(payload.fetched_at)}</span> : null}
        </div>
      </div>

      {payload && payload.activity.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {payload.activity.map((a, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-2 text-compact sm:px-6">
              <span className="font-mono text-mini font-semibold">{a.method}</span>
              <Mono>{a.endpoint}</Mono>
              <span
                className={cn(
                  'ml-auto font-mono text-mini font-semibold',
                  a.ok ? 'text-[hsl(var(--verdict-verified))]' : 'text-[hsl(var(--verdict-failed))]',
                )}
              >
                {a.status === null ? 'no response' : `${a.status}${a.ok ? ' OK' : ''}`}
              </span>
              {a.count !== null ? <span className="tnum text-mini text-muted-foreground">count {a.count}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {payload ? (
        <div className="border-t border-border px-5 py-3 text-mini leading-relaxed text-muted-foreground sm:px-6">
          {payload.counts.settlements === 0
            ? 'This account returned no settlements — test-mode transactions are simulated and nothing settles. The decision shown on this page comes from the AVOS Evaluation Dataset and is labelled as such.'
            : `${payload.counts.settlements} settlement(s) returned. Open the console to see them verified.`}
        </div>
      ) : null}
    </div>
  )
}
