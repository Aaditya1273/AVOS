/**
 * Timestamp normalisation, and the precision that survives it.
 *
 * A bank export writes `08/20/2026` in the value-date column. Parsed the obvious
 * way that becomes `2026-08-20T00:00:00Z`, which is midnight — and midnight is
 * *before* a settlement made at 16:40 the same day. The lifecycle check then
 * reports that the money landed before the settlement existed, on a settlement
 * where nothing whatsoever is wrong.
 *
 * That was a real false positive in this codebase (hard-slice case H25). It is
 * the worst kind, because it fires on clean money in a system whose entire value
 * proposition is not crying wolf.
 *
 * Two things fix it, and both are needed:
 *
 *  1. **A date-only value date normalises to the END of that day**, not the
 *     start. The bank is asserting "this credit belongs to the 20th", and the
 *     only reading consistent with that is the latest instant it could have
 *     happened. Choosing midnight silently asserts the earliest, which is the
 *     one reading the bank did not make.
 *
 *  2. **The lost precision is recorded.** Even at end-of-day, comparing a
 *     date-only stamp against a to-the-second one at sub-day granularity is
 *     comparing a fact against a guess. Downstream, ordering checks fall back to
 *     calendar-day granularity when either side carries `'date'` precision.
 *
 * Rounding a date up is not a fudge to make a test pass; it is the only choice
 * that does not invent information the source never carried. Recording that the
 * information was missing is what stops the next reader from forgetting.
 */

export type TimestampPrecision = 'datetime' | 'date'

export interface NormalisedTimestamp {
  /** ISO-8601 UTC, always. */
  iso: string
  /** `'date'` when the source carried no time component. */
  precision: TimestampPrecision
}

const DATE_ONLY_ISO = /^\d{4}-\d{2}-\d{2}$/
const DATE_ONLY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/** True when the raw cell carried a day but no time of day. */
export function isDateOnly(raw: string): boolean {
  const s = (raw ?? '').trim()
  return DATE_ONLY_ISO.test(s) || DATE_ONLY_SLASH.test(s)
}

/**
 * The instant a date-only value should be read as.
 *
 * End of day, to the second. `23:59:59Z` rather than `23:59:59.999Z` because
 * every other timestamp in this system is second-resolution, and mixing
 * resolutions is how you get a comparison that is right in tests and wrong in
 * production.
 */
export function endOfDay(isoDate: string): string {
  return `${isoDate.slice(0, 10)}T23:59:59Z`
}

/**
 * Compare two instants, dropping to calendar-day granularity when either side
 * lost its time component.
 *
 * Returns a negative number when `a` precedes `b`, zero when they are
 * indistinguishable at the available precision, positive otherwise. The zero
 * case is the important one: it is how "the credit is dated the same day as the
 * settlement" stops being an ordering violation and becomes what it actually is,
 * which is no information either way.
 */
export function compareAtPrecision(
  aIso: string,
  aPrecision: TimestampPrecision,
  bIso: string,
  bPrecision: TimestampPrecision,
): number {
  if (aPrecision === 'date' || bPrecision === 'date') {
    const aDay = aIso.slice(0, 10)
    const bDay = bIso.slice(0, 10)
    return aDay < bDay ? -1 : aDay > bDay ? 1 : 0
  }
  const a = Date.parse(aIso)
  const b = Date.parse(bIso)
  return a < b ? -1 : a > b ? 1 : 0
}
