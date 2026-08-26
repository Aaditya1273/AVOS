/**
 * Rupee rendering. Paise -> string, at the display boundary only.
 *
 * Deliberately not imported by the verifier: formatting is a UI concern, and
 * keeping it out of `deterministic.ts` is part of how that file stays free of
 * runtime imports entirely.
 */

import type { Paise } from '@/lib/types'

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPaise(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—'
  return INR.format(paise / 100)
}

/** Signed, for discrepancies where the direction is the point. */
export function formatDelta(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—'
  const sign = paise > 0 ? '+' : paise < 0 ? '−' : ''
  return `${sign}${INR.format(Math.abs(paise) / 100)}`
}

/** Compact form for dense tables: ₹1.09 Cr, ₹4.8 L, ₹4,800. */
export function formatCompact(paise: Paise): string {
  const rupees = paise / 100
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(2)} L`
  return INR.format(rupees)
}

export function formatPct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}
