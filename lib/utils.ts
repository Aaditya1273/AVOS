import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** `2026-08-12T09:15:00Z` -> `12 Aug 2026, 09:15 UTC`. Stable across locales. */
export function fmtTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso || '—'
  const d = new Date(t)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function fmtDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso || '—'
  const d = new Date(t)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}
