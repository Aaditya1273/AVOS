/**
 * Grouped metrics.
 *
 * Nine unlabelled tiles in a row is a wall of numbers: every figure competes
 * equally for attention, so a reader has to parse all of them to find the one
 * that matters. It also wraps badly — a nine-into-eight grid orphans a tile on a
 * second row, which reads as a bug rather than a layout.
 *
 * Grouping answers a different question. CONTROL says what the system did,
 * ASSURANCE says whether it can be trusted, IMPACT says what it was worth. A
 * reader can skip two of the three and still leave with something true, which is
 * the whole job of a dashboard strip.
 */
import { cn } from '@/lib/utils'

export function MetricGroup({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col gap-2.5', className)}>
      <h3 className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
        {label}
      </h3>
      <div className="grid grid-cols-3 gap-x-5 gap-y-4">{children}</div>
    </section>
  )
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'verified' | 'uncertain' | 'failed'
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-micro font-medium uppercase tracking-label text-muted-foreground">
        {label}
      </dt>
      {/* tnum keeps decimal points aligned down a column. Without it, proportional
          digits make two percentages of the same width look ragged. */}
      <dd
        className={cn(
          'tnum text-figure font-semibold leading-none',
          tone === 'verified' && 'text-[hsl(var(--verdict-verified))]',
          tone === 'uncertain' && 'text-[hsl(var(--verdict-uncertain))]',
          tone === 'failed' && 'text-[hsl(var(--verdict-failed))]',
        )}
      >
        {value}
      </dd>
      {hint ? <p className="truncate text-mini text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
