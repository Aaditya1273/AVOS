'use client'

import { useState } from 'react'
import { Badge, Mono } from '@/components/ui/primitives'
import { RowDetail } from '@/components/row-detail'
import { formatPaise } from '@/lib/money'
import { cn, fmtTime } from '@/lib/utils'
import type { CheckResult, EvidenceItem, EvidencePack } from '@/lib/types'

const KIND_LABEL: Record<string, string> = {
  payment: 'Payment',
  settlement: 'Settlement',
  bank_credit: 'Bank credit',
  refund: 'Refund',
  hold: 'Hold',
  webhook_event: 'Webhook',
}

const SOURCE_LABEL: Record<string, string> = {
  razorpay_payments: 'payments',
  razorpay_settlements: 'settlements',
  bank_statement: 'bank',
  refunds: 'refunds',
  holds: 'holds',
  webhook_events: 'webhooks',
}

/**
 * The evidence pack, inspectable to the row.
 *
 * Every row opens. That is the difference between a card that asserts it has
 * evidence and one that hands it over: a reviewer who does not believe the
 * verdict can click through to the source file, the row locator, the content
 * hash, and the list of checks that read it, without leaving the screen.
 *
 * Payments collapse by default. Not to save space — a settlement with eleven
 * payment rows and one bank credit has exactly one row worth looking at first,
 * and burying it under eleven near-identical siblings is how discrepancies get
 * missed at 9am.
 */
export function EvidenceInspector({
  pack,
  checks,
  citedIds,
  injectionRows,
}: {
  pack: EvidencePack
  checks: CheckResult[]
  citedIds: string[]
  injectionRows: string[]
}) {
  const [showPayments, setShowPayments] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [open, setOpen] = useState<EvidenceItem | null>(null)

  const cited = new Set(citedIds)
  const flagged = new Set(injectionRows.map((r) => r.split('.')[0]))
  const payments = pack.evidence.filter((e) => e.kind === 'payment')
  const rest = pack.evidence.filter((e) => e.kind !== 'payment')
  const visible = showPayments ? [...rest, ...payments] : rest

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{pack.evidence.length} rows</Badge>
          <Mono>{pack.pack_hash.slice(0, 16)}</Mono>
          {pack.reproducible ? (
            <Badge variant="verified">hashes intact</Badge>
          ) : (
            <Badge variant="failed">hash drift</Badge>
          )}
          {injectionRows.length > 0 ? (
            <Badge variant="uncertain">{injectionRows.length} injected cell</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {payments.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowPayments((v) => !v)}
              className="text-primary hover:underline"
            >
              {showPayments ? 'Collapse' : 'Show'} {payments.length} payment rows
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-primary hover:underline"
          >
            {showRaw ? 'Hide' : 'Show'} raw pack
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Occurred</th>
                <th className="px-3 py-2 text-right font-medium">Age</th>
                <th className="px-3 py-2 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const isFlagged = flagged.has(e.evidence_id)
                return (
                  <tr
                    key={e.evidence_id}
                    tabIndex={0}
                    role="button"
                    onClick={() => setOpen(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        setOpen(e)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-t border-border/60 align-top outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent',
                      !e.hash_matches_recorded && 'bg-[hsl(var(--verdict-failed)/0.10)]',
                      isFlagged && 'bg-[hsl(var(--verdict-uncertain)/0.08)]',
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {SOURCE_LABEL[e.source] ?? e.source}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-[11px] text-primary underline decoration-primary/30 underline-offset-2">
                        {e.row_id}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span>{KIND_LABEL[e.kind] ?? e.kind}</span>
                      {!cited.has(e.evidence_id) ? (
                        <span
                          className="ml-1.5 text-[10px] text-muted-foreground"
                          title="Retrieved by AVOS but not cited by the agent. Scored anyway."
                        >
                          uncited
                        </span>
                      ) : null}
                      {isFlagged ? (
                        <span
                          className="ml-1.5 text-[10px] text-[hsl(var(--verdict-uncertain))]"
                          title="Instruction-shaped text in a free-text cell"
                        >
                          ⚑
                        </span>
                      ) : null}
                    </td>
                    <td className="tnum px-3 py-2 text-right">{formatPaise(e.amount_paise)}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {fmtTime(e.timestamp)}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-[11px] text-muted-foreground">
                      {Number.isFinite(e.freshness_hours) ? `${e.freshness_hours}h` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'font-mono text-[10px]',
                          e.hash_matches_recorded
                            ? 'text-muted-foreground'
                            : 'font-semibold text-[hsl(var(--verdict-failed))]',
                        )}
                      >
                        {e.hash.slice(0, 12)}
                      </span>
                      {!e.hash_matches_recorded ? (
                        <span className="ml-1.5 text-[10px] font-semibold text-[hsl(var(--verdict-failed))]">
                          ≠ baseline
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No evidence was retrieved for this settlement. That is why AVOS abstained.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-muted/30 px-3 py-1.5 text-[10.5px] text-muted-foreground">
          Click any row to open its source file, full hash, and the checks that read it.
        </div>
      </div>

      {showRaw ? (
        <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[10.5px] leading-relaxed scrollbar-thin">
          {JSON.stringify(pack, null, 2)}
        </pre>
      ) : null}

      {open ? <RowDetail item={open} checks={checks} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
