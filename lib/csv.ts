/**
 * A minimal RFC 4180 CSV reader.
 *
 * We parse quoting properly rather than splitting on commas, for one specific
 * reason: the adversarial suite plants attacker-controlled text inside a bank
 * narration cell. A naive split would let a crafted cell shift every downstream
 * column by one and silently corrupt the amounts — a parser bug that presents as
 * a reconciliation failure. The safest place to be strict is the ingest edge.
 *
 * No dependency needed for 60 lines that we fully control.
 */

import { endOfDay } from '@/lib/evidence/normalize'

export type CsvRow = Record<string, string>

export function parseCsv(text: string): CsvRow[] {
  const rows = parseRows(text)
  if (rows.length === 0) return []
  const header = rows[0]
  const out: CsvRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]
    // A trailing newline yields one empty cell; that is not a record.
    if (cells.length === 1 && cells[0] === '') continue
    const row: CsvRow = {}
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c] ?? ''
    out.push(row)
  }
  return out
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Parse an integer-paise column.
 *
 * Throws rather than coercing. A silently-zeroed amount in a verifier produces a
 * confident wrong verdict, which is the exact failure mode this product exists
 * to prevent — so bad input must be loud.
 */
export function paiseField(row: CsvRow, key: string): number {
  const raw = (row[key] ?? '').trim()
  if (raw === '') throw new Error(`missing required paise field '${key}'`)
  const n = Number(raw)
  if (!Number.isInteger(n)) {
    throw new Error(`field '${key}' must be integer paise, got '${raw}'`)
  }
  return n
}

// ---------------------------------------------------------------------------
// The ingest boundary
//
// Bank and portal exports do not agree on what a number looks like. The same
// ₹1,46,816.21 arrives as `₹1,46,816.21`, `Rs. 1,46,816.21`, `1,46,816.21` or
// `146816.21` depending on which system wrote the file.
//
// Tolerating that is a feature. Propagating it is the bug. Everything below
// converts dirty input to exact integer paise and then the mess is over — no
// downstream module ever sees a formatted amount or an ambiguous date.
// ---------------------------------------------------------------------------

const MONEY_PREFIX = /^(₹|Rs\.?|INR)\s*/i
const MONEY_SHAPE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/

/**
 * Dirty money string -> exact integer paise.
 *
 * Deliberately string arithmetic, never `parseFloat(x) * 100`.
 *
 * That expression is the most common way money breaks in a JavaScript codebase,
 * and what makes it dangerous is that it *usually works*: `146816.21 * 100` is
 * exactly `14681621`, so a test built from a realistic amount passes and the
 * approach looks fine. Then `4.35 * 100` is `434.99999999999994` and `8.29 *
 * 100` is `828.9999999999999`. `Math.round` rescues both; `Math.trunc`, `| 0`
 * and `parseInt` each lose a paisa, and every one of those is a plausible
 * refactor by someone who saw a rounding call and assumed it was noise.
 *
 * Splitting on the decimal point and treating both halves as integers has no
 * such failure mode, and needs no rounding call for anyone to later remove.
 */
export function parsePaise(raw: string, context = 'amount'): number {
  let s = (raw ?? '').trim().replace(/,/g, '')
  if (s === '') throw new Error(`empty ${context}`)

  // Sign before symbol (`-₹500.00`) and symbol before sign are both in the wild.
  // Strip the sign first so the currency prefix is always at position zero.
  let sign = 1
  if (s.startsWith('-')) {
    sign = -1
    s = s.slice(1).trimStart()
  } else if (s.startsWith('+')) {
    s = s.slice(1).trimStart()
  }
  s = s.replace(MONEY_PREFIX, '').trimStart()

  const m = MONEY_SHAPE.exec(s)
  if (!m) throw new Error(`unparseable ${context}: '${raw}'`)
  // A second sign inside the digits (`--5`) means the string was never money.
  if (m[1] === '-') throw new Error(`unparseable ${context}: '${raw}'`)

  const rupees = Number(m[2])
  // '.5' means fifty paise, not five. Pad right, never left.
  const paise = Number((m[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(rupees)) throw new Error(`${context} out of range: '${raw}'`)

  return sign * (rupees * 100 + paise)
}

/** Same, but an empty cell is a legitimate absence rather than an error. */
export function parsePaiseOptional(raw: string, context = 'amount'): number | null {
  return (raw ?? '').trim() === '' ? null : parsePaise(raw, context)
}

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const US_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * Dirty date string -> ISO-8601 UTC.
 *
 * Accepts `2026-08-11T10:00:00Z`, `2026-08-11 10:00:00`, `2026-08-11`, and
 * `08/11/2026 10:00`.
 *
 * **On the slash format.** It is read as MM/DD/YYYY, because that is the
 * convention the exporting portal declares. This is not a guess and must never
 * become one: `08/11/2026` is a perfectly valid DD/MM date too, and for the
 * first twelve days of any month the two readings are indistinguishable. A
 * parser that sniffs the format per row will silently move a settlement by nine
 * months on exactly the rows where nobody is looking. One declared convention,
 * applied uniformly, is wrong loudly or not at all.
 */
export function parseFlexibleDate(raw: string, context = 'timestamp'): string {
  const s = (raw ?? '').trim()
  if (s === '') throw new Error(`empty ${context}`)

  if (ISO_LIKE.test(s)) {
    const normalised = s.includes('T') ? s : s.replace(' ', 'T')
    const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalised) ? normalised : `${normalised}Z`
    const t = Date.parse(withZone)
    if (!Number.isFinite(t)) throw new Error(`unparseable ${context}: '${raw}'`)
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
  }

  // End of day, not midnight. See lib/evidence/normalize.ts — midnight silently
  // asserts the earliest instant the source could have meant, which is the one
  // reading it did not make, and it manufactures ordering violations on clean data.
  if (DATE_ONLY.test(s)) return endOfDay(s)

  const m = US_SLASH.exec(s)
  if (m) {
    const [, mm, dd, yyyy, hh = '00', mi = '00', ss = '00'] = m
    const month = Number(mm)
    const day = Number(dd)
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error(`out-of-range ${context}: '${raw}'`)
    }
    const pad = (n: string | number) => String(n).padStart(2, '0')
    const day0 = `${yyyy}-${pad(month)}-${pad(day)}`
    // A slash date with no time is date-only too, and gets the same treatment.
    if (hh === '00' && mi === '00' && ss === '00' && !/[ T]/.test(s)) return endOfDay(day0)
    return `${day0}T${pad(hh)}:${pad(mi)}:${pad(ss)}Z`
  }

  throw new Error(`unrecognised ${context} format: '${raw}'`)
}

