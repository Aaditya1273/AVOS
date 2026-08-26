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
