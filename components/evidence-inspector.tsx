'use client'

import { useState } from 'react'
import { Badge, Mono } from '@/components/ui/primitives'
import { formatPaise } from '@/lib/money'
import { cn, fmtTime } from '@/lib/utils'
import type { EvidencePack } from '@/lib/types'

const KIND_LABEL: Record<string, string> = {
  payment: 'Payment',
  settlement: 'Settlement',
  bank_credit: 'Bank credit',
  refund: 'Refund',
  hold: 'Hold',
  webhook_event: 'Webhook',
}

/**
 * The evidence pack, inspectable.
 *
 * Payments are collapsed by default and everything else is shown. That is not a
 * space-saving decision — a settlement with eleven payment rows and one bank
 * credit has exactly one row a reviewer needs to look at first, and burying it
 * under eleven identical-looking siblings is how discrepancies get missed.
 *
 * Every row carries its source file, its row locator and its content hash, so a
 * reviewer can open the CSV and see the same bytes AVOS hashed.
 */
export function EvidenceInspector({
  pack,
  citedIds,
  injectionRows,
}: {
  pack: EvidencePack
  citedIds: string[]
  injectionRows: string[]
}) {
  const [showPayments, setShowPayments] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  const cited = new Set(citedIds)
  const flagged = new Set(injectionRows.map((r) => r.split('.')[0]))
  const payments = pack.evidence.filter((e) => e.kind === 'payment')
  const rest = pack.evidence.filter((e) => e.kind !== 'payment')
  const visible = showPayments ? [...rest, ...payments] : rest

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Evidence pack
          </h4>
          <Badge variant="outline">{pack.evidence.length} rows</Badge>
          <Mono>{pack.pack_hash.slice(0, 16)}</Mono>
          {pack.reproducible ? (
            <Badge variant="verified">reproducible</Badge>
          ) : (
            <Badge variant="failed">hash drift</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {payments.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowPayments((v) => !v)}
              className="text-primary hover:underline"
            >
              {showPayments ? 'Hide' : 'Show'} {payments.length} payment rows
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-primary hover:underline"
          >
            {showRaw ? 'Hide' : 'Show'} raw JSON
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border scrollbar-thin">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Timestamp</th>
              <th className="px-3 py-2 text-right font-medium">Fresh</th>
              <th className="px-3 py-2 font-medium">Hash</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const isFlagged = flagged.has(e.evidence_id)
              return (
                <tr
                  key={e.evidence_id}
                  className={cn(
                    'border-t border-border/60 align-top',
                    !e.hash_matches_recorded && 'bg-[hsl(var(--verdict-failed)/0.10)]',
                    isFlagged && 'bg-[hsl(var(--verdict-uncertain)/0.08)]',
                  )}
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {e.source}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{e.row_id}</td>
                  <td className="px-3 py-2">
                    <span className="text-foreground">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    {!cited.has(e.evidence_id) ? (
                      <span
                        className="ml-1.5 text-[10px] text-muted-foreground"
                        title="Retrieved by AVOS but not cited by the agent. Scored anyway."
                      >
                        uncited
                      </span>
                    ) : null}
                    {e.status ? (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">{e.status}</span>
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
                        ≠ recorded
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No evidence was retrieved for this settlement. That is why AVOS abstained.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {injectionRows.length > 0 ? (
        <div className="rounded-md border border-[hsl(var(--verdict-uncertain)/0.4)] bg-[hsl(var(--verdict-uncertain)/0.08)] p-3">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="uncertain">injection attempt</Badge>
            <span className="text-[11px] text-muted-foreground">
              instruction-shaped text found in {injectionRows.length} free-text cell(s)
            </span>
          </div>
          {pack.evidence
            .filter((e) => flagged.has(e.evidence_id))
            .map((e) => (
              <div key={e.evidence_id} className="mt-1.5 text-[11px]">
                <Mono>{e.evidence_id}</Mono>
                <span className="ml-2 font-mono text-muted-foreground">
                  &ldquo;{Object.values(e.display).join(' ')}&rdquo;
                </span>
              </div>
            ))}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Quarantined, not stripped. This text reached the Q&amp;A prompt and never reached the
            verifier — free-text columns are not on the verdict path, so the verdict above is
            byte-identical with this cell blank. Surfaced here because a bank narration carrying an
            instruction is something a fraud team should see.
          </p>
        </div>
      ) : null}

      {showRaw ? (
        <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[10.5px] leading-relaxed scrollbar-thin">
          {JSON.stringify(pack, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
