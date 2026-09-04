'use client'

import { Badge, Button, Mono } from '@/components/ui/primitives'
import { formatPaise } from '@/lib/money'
import { cn, fmtTime } from '@/lib/utils'
import type { CheckResult, EvidenceItem } from '@/lib/types'

/**
 * One evidence row, opened.
 *
 * The point of a Proof Card is that a reviewer can get from a verdict to the
 * bytes it was computed from without leaving the screen or asking anyone. This
 * is the last hop: source file, row locator, every typed field, the full content
 * hash, and — the part that usually goes missing — which checks actually read
 * this row.
 *
 * Free text is shown last and labelled as untrusted, not hidden. A reviewer
 * looking at a bank memo containing an instruction should see it, and should see
 * that it sits in the one section marked as never reaching the verdict.
 */
export function RowDetail({
  item,
  checks,
  onClose,
}: {
  item: EvidenceItem
  checks: CheckResult[]
  onClose: () => void
}) {
  // A check "used" this row if it names the row or its evidence id in the detail
  // it wrote. Cheap, and accurate because the verifier writes specific details.
  const referencedBy = checks.filter(
    (c) => c.detail.includes(item.row_id) || c.detail.includes(item.evidence_id),
  )

  const fields: [string, React.ReactNode][] = [
    ['Source file', <Mono key="s">{item.source}.csv</Mono>],
    ['Row', <Mono key="r">{item.row_id}</Mono>],
    ['Kind', item.kind],
    ['Amount', <span key="a" className="tnum">{formatPaise(item.amount_paise)}</span>],
  ]
  if (item.fee_paise !== undefined)
    fields.push(['Fee', <span key="f" className="tnum">{formatPaise(item.fee_paise)}</span>])
  if (item.tax_paise !== undefined)
    fields.push(['GST', <span key="t" className="tnum">{formatPaise(item.tax_paise)}</span>])
  if (item.status) fields.push(['Status', <Mono key="st">{item.status}</Mono>])
  if (item.created_at) fields.push(['Created', fmtTime(item.created_at)])
  fields.push(['Occurred', fmtTime(item.timestamp)])
  fields.push(['Ingested', fmtTime(item.ingested_at)])
  fields.push([
    'Freshness',
    <span key="fr" className="tnum">
      {Number.isFinite(item.freshness_hours) ? `${item.freshness_hours} h before decision` : '—'}
    </span>,
  ])

  const keyEntries = Object.entries(item.keys).filter(([, v]) => v)
  const displayEntries = Object.entries(item.display).filter(([, v]) => v)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-card shadow-2xl scrollbar-thin"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-micro uppercase tracking-label text-muted-foreground">
              Evidence row
            </div>
            <div className="mt-0.5 font-mono text-base font-semibold">{item.row_id}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{item.source}</Badge>
              {item.hash_matches_recorded ? (
                <Badge variant="verified">hash matches baseline</Badge>
              ) : (
                <Badge variant="failed">hash differs from baseline</Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          <section>
            <SectionLabel>Values</SectionLabel>
            <dl className="divide-y divide-border/60 rounded-md border border-border">
              {fields.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 px-3 py-2">
                  <dt className="text-mini text-muted-foreground">{k}</dt>
                  <dd className="text-right text-compact">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {keyEntries.length > 0 ? (
            <section>
              <SectionLabel>Join keys</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {keyEntries.map(([k, v]) => (
                  <span key={k} className="rounded border border-border px-2 py-1 text-mini">
                    <span className="text-muted-foreground">{k}</span>{' '}
                    <span className="font-mono">{v}</span>
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-mini leading-relaxed text-muted-foreground">
                Retrieval follows these. The UTR key is why a settlement claiming another
                settlement&rsquo;s bank reference ends up in this pack at all.
              </p>
            </section>
          ) : null}

          <section>
            <SectionLabel>Content hash</SectionLabel>
            <div className="break-all rounded-md border border-border bg-muted/40 p-2.5 font-mono text-micro leading-relaxed">
              {item.hash}
            </div>
            <p className="mt-1.5 text-mini leading-relaxed text-muted-foreground">
              sha256 over the normalised content, excluding <Mono>row_id</Mono>. Two rows with the
              same content therefore collide — which is how a re-ingested file is detected rather
              than double-counted.
            </p>
          </section>

          <section>
            <SectionLabel>
              Read by {referencedBy.length} check{referencedBy.length === 1 ? '' : 's'}
            </SectionLabel>
            {referencedBy.length === 0 ? (
              <p className="text-mini text-muted-foreground">
                No check names this row specifically. It still contributed to the totals — the
                arithmetic check reads every payment, refund, hold and credit in the pack.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {referencedBy.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      'rounded px-2.5 py-1.5 text-mini',
                      c.status === 'fail'
                        ? 'bg-[hsl(var(--verdict-failed)/0.08)]'
                        : 'bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'mr-2 font-bold',
                        c.status === 'pass' && 'text-[hsl(var(--verdict-verified))]',
                        c.status === 'fail' && 'text-[hsl(var(--verdict-failed))]',
                        c.status === 'skipped' && 'text-muted-foreground',
                      )}
                    >
                      {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '–'}
                    </span>
                    <span className="font-mono text-mini">{c.id}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {displayEntries.length > 0 ? (
            <section>
              <SectionLabel tone="warn">Free text — never reaches the verdict</SectionLabel>
              <div className="rounded-md border border-dashed border-[hsl(var(--verdict-uncertain)/0.45)] bg-[hsl(var(--verdict-uncertain)/0.06)] p-3">
                {displayEntries.map(([k, v]) => (
                  <div key={k} className="mb-1.5 last:mb-0">
                    <div className="text-micro uppercase tracking-label text-muted-foreground">
                      {k}
                    </div>
                    <div className="break-words font-mono text-mini">{v}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-mini leading-relaxed text-muted-foreground">
                This is the only attacker-controlled surface in the row. It is passed to the Q&amp;A
                model as delimited data and is not a field the verifier is permitted to name.
              </p>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function SectionLabel({
  children,
  tone,
}: {
  children: React.ReactNode
  tone?: 'warn'
}) {
  return (
    <h4
      className={cn(
        'mb-1.5 text-micro font-semibold uppercase tracking-label',
        tone === 'warn' ? 'text-[hsl(var(--verdict-uncertain))]' : 'text-muted-foreground',
      )}
    >
      {children}
    </h4>
  )
}
