'use client'

import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import type { Verdict } from '@/lib/types'

const VARIANT = {
  VERIFIED: 'verified',
  UNCERTAIN: 'uncertain',
  FAILED: 'failed',
} as const

const GLYPH = { VERIFIED: '✓', UNCERTAIN: '?', FAILED: '✕' } as const

export function VerdictBadge({
  verdict,
  reason,
  size = 'sm',
  className,
}: {
  verdict: Verdict
  reason?: string | null
  size?: 'sm' | 'lg'
  className?: string
}) {
  if (size === 'lg') {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div
          className={cn(
            'inline-flex w-fit items-center gap-2.5 rounded-lg border px-4 py-2',
            verdict === 'VERIFIED' &&
              'border-[hsl(var(--verdict-verified)/0.4)] bg-[hsl(var(--verdict-verified)/0.12)] text-[hsl(var(--verdict-verified))]',
            verdict === 'UNCERTAIN' &&
              'border-[hsl(var(--verdict-uncertain)/0.4)] bg-[hsl(var(--verdict-uncertain)/0.12)] text-[hsl(var(--verdict-uncertain))]',
            verdict === 'FAILED' &&
              'border-[hsl(var(--verdict-failed)/0.4)] bg-[hsl(var(--verdict-failed)/0.12)] text-[hsl(var(--verdict-failed))]',
          )}
        >
          <span className="text-lg leading-none">{GLYPH[verdict]}</span>
          <span className="text-lg font-bold tracking-tight">{verdict}</span>
        </div>
        {reason ? (
          <span className="font-mono text-mini tracking-wide text-muted-foreground">{reason}</span>
        ) : null}
      </div>
    )
  }

  return (
    <Badge variant={VARIANT[verdict]} className={className}>
      {GLYPH[verdict]} {verdict}
      {reason ? <span className="ml-1.5 font-mono font-normal opacity-80">{reason}</span> : null}
    </Badge>
  )
}

/**
 * The distinction the product turns on, stated wherever a verdict appears.
 * A reviewer who reads UNCERTAIN as "the system failed" has misread the system.
 */
export const VERDICT_MEANING: Record<Verdict, string> = {
  VERIFIED: 'Recomputed state supports the claim under the policy in force at decision time.',
  UNCERTAIN:
    'Evidence is incomplete, stale or unenforceable. AVOS does not know, so it will not close.',
  FAILED: 'Evidence refutes the claim, or its integrity is broken. Closing would move money wrongly.',
}
