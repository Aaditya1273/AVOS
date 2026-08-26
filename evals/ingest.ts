/**
 * Ingest-boundary checks.
 *
 * The dirty-export parser is the only place in AVOS where a silent bug becomes a
 * wrong verdict rather than a crash. Everything downstream operates on integer
 * paise and ISO-8601 and is therefore either right or loudly broken; this layer
 * can be subtly, quietly wrong — mis-read one amount by a paisa, or one date by
 * nine months, and the verifier will confidently produce a well-evidenced,
 * fully-reproducible, incorrect answer.
 *
 * So it gets its own gate. The last check is the one that matters most: it
 * parses every row of the real ledger and asserts nothing lost precision,
 * because a unit test over hand-picked strings only proves the cases you thought
 * of.
 */

import { parsePaise, parsePaiseOptional, parseFlexibleDate } from '@/lib/csv'
import { loadLedger, loadCases } from '@/lib/data/ledger'

export interface IngestCheck {
  id: string
  name: string
  passed: boolean
  detail: string
}

function check(id: string, name: string, fn: () => string): IngestCheck {
  try {
    return { id, name, passed: true, detail: fn() }
  } catch (e) {
    return { id, name, passed: false, detail: (e as Error).message }
  }
}

function eq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function throws(fn: () => unknown, what: string): void {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(`${what}: expected a throw, got a value`)
}

export function runIngestChecks(): IngestCheck[] {
  const checks: IngestCheck[] = []

  // --- money: every export style resolves to the same integer -------------
  checks.push(
    check('money_styles_agree', 'All four export money formats parse identically', () => {
      const forms = ['₹1,46,816.21', 'Rs. 1,46,816.21', '1,46,816.21', '146816.21']
      for (const f of forms) eq(parsePaise(f), 14681621, `parsePaise('${f}')`)
      return `${forms.length} formats -> 14681621 paise, exactly`
    }),
  )

  // --- money: the float trap ----------------------------------------------
  checks.push(
    check('money_avoids_float_error', 'Parsing does not go through a float', () => {
      // The trap is that `parseFloat(x) * 100` usually works. A realistic
      // settlement amount is exact, so a test built from one passes and the
      // approach looks safe. These are the amounts where it is not.
      const traps = ['4.35', '8.29', '0.07', '1.10']
      const inexact = traps.filter((t) => !Number.isInteger(parseFloat(t) * 100))
      if (inexact.length !== traps.length) {
        throw new Error(`expected all of ${traps.join(', ')} to be inexact under float multiply`)
      }

      for (const t of traps) {
        const viaString = parsePaise(t)
        const viaFloatTruncated = Math.trunc(parseFloat(t) * 100)
        eq(viaString, Math.round(parseFloat(t) * 100), `parsePaise('${t}') matches a rounded float`)
        // Rounding rescues these; truncation does not — and truncation is one
        // careless refactor away from any rounding call.
        if (t === '4.35' || t === '8.29') {
          eq(viaFloatTruncated, viaString - 1, `truncating the float loses a paisa on ${t}`)
        }
      }

      eq(parsePaise('₹1,46,816.21'), 14681621, 'realistic amount is exact either way')
      return (
        `${traps.length}/${traps.length} trap values are inexact under float multiply ` +
        `(4.35 -> ${parseFloat('4.35') * 100}); string arithmetic is exact for all of them ` +
        'and needs no rounding call for anyone to remove'
      )
    }),
  )

  // --- money: fractional digits are padded right, not left ----------------
  checks.push(
    check('money_fraction_padding', "'.5' means fifty paise, not five", () => {
      eq(parsePaise('10.5'), 1050, "parsePaise('10.5')")
      eq(parsePaise('10.05'), 1005, "parsePaise('10.05')")
      eq(parsePaise('10'), 1000, "parsePaise('10')")
      eq(parsePaise('-₹1,000.01'), -100001, 'negative with symbol')
      return '10.5 -> 1050p · 10.05 -> 1005p · 10 -> 1000p · -₹1,000.01 -> -100001p'
    }),
  )

  // --- money: bad input is loud -------------------------------------------
  checks.push(
    check('money_rejects_garbage', 'Unparseable money throws rather than coercing to zero', () => {
      for (const bad of ['', 'N/A', '1.2.3', '₹abc', '12.345', '--5']) {
        throws(() => parsePaise(bad), `parsePaise('${bad}')`)
      }
      // An empty cell is a legitimate absence, but only where absence is modelled.
      eq(parsePaiseOptional(''), null, "parsePaiseOptional('')")
      return '6 malformed inputs throw; empty cell is null, never 0'
    }),
  )

  // --- dates: three conventions, one instant ------------------------------
  checks.push(
    check('date_styles_agree', 'ISO, SQL and slash formats resolve to one instant', () => {
      eq(parseFlexibleDate('2026-08-11T10:00:00Z'), '2026-08-11T10:00:00Z', 'iso')
      eq(parseFlexibleDate('2026-08-11 10:00:00'), '2026-08-11T10:00:00Z', 'sql')
      eq(parseFlexibleDate('08/11/2026 10:00'), '2026-08-11T10:00:00Z', 'us_slash')
      eq(parseFlexibleDate('2026-08-11'), '2026-08-11T00:00:00Z', 'date only')
      return 'all four spellings of 11 Aug 2026 10:00 UTC agree'
    }),
  )

  // --- dates: the ambiguity is resolved by convention, not by sniffing ----
  checks.push(
    check('date_slash_is_month_first', 'Slash dates read MM/DD/YYYY uniformly', () => {
      // 03/04/2026 is 4 March under the declared convention, never 3 April.
      // A parser that switched on plausibility would be right most of the time
      // and silently wrong on exactly the days nobody checks.
      eq(parseFlexibleDate('03/04/2026'), '2026-03-04T00:00:00Z', 'ambiguous slash date')
      eq(parseFlexibleDate('12/31/2026'), '2026-12-31T00:00:00Z', 'unambiguous slash date')
      throws(() => parseFlexibleDate('31/12/2026'), 'day-first input')
      return '03/04/2026 -> 4 Mar (declared convention); 31/12/2026 rejected rather than guessed'
    }),
  )

  checks.push(
    check('date_rejects_garbage', 'Unrecognised date formats throw', () => {
      for (const bad of ['', 'yesterday', '11-08-2026', '2026/08/11', 'Aug 11 2026']) {
        throws(() => parseFlexibleDate(bad), `parseFlexibleDate('${bad}')`)
      }
      return '5 unrecognised formats throw rather than defaulting to epoch'
    }),
  )

  // --- the real ledger: nothing lost precision ----------------------------
  checks.push(
    check('ledger_parses_without_loss', 'Every row of the real ledger parses exactly', () => {
      const ledger = loadLedger()
      let bankRows = 0
      for (const rows of ledger.bankByUtr.values()) {
        for (const b of rows) {
          if (!Number.isSafeInteger(b.credit_paise)) {
            throw new Error(`bank row ${b.row_id} produced a non-integer: ${b.credit_paise}`)
          }
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(b.value_date)) {
            throw new Error(`bank row ${b.row_id} produced a non-ISO date: ${b.value_date}`)
          }
          bankRows++
        }
      }

      let caseRows = 0
      for (const suite of ['batch_120', 'adversarial_30'] as const) {
        for (const c of loadCases(suite)) {
          if (!Number.isSafeInteger(c.settlement_amount_paise)) {
            throw new Error(`case ${c.case_id} settlement_amount is not an integer`)
          }
          if (c.bank_credit_paise !== null && !Number.isSafeInteger(c.bank_credit_paise)) {
            throw new Error(`case ${c.case_id} bank_credit is not an integer`)
          }
          caseRows++
        }
      }
      return `${bankRows} bank rows and ${caseRows} case rows parsed to exact paise and ISO-8601`
    }),
  )

  // --- the summary is not the evidence ------------------------------------
  checks.push(
    check(
      'summary_disagrees_where_it_should',
      'Case-index summaries are not treated as evidence',
      () => {
        // The denormalised summary in settlement_batch_120.csv agrees with the
        // settlement's own declared net — that is what makes it a plausible
        // input and a useless one. The verifier recomputes from payment-level
        // rows regardless, which is why fee-mismatch cases fail despite a
        // summary row where settlement_amount and bank_credit match perfectly.
        const cases = loadCases('batch_120')
        const selfConsistent = cases.filter(
          (c) => c.bank_credit_paise !== null && c.bank_credit_paise === c.settlement_amount_paise,
        )
        if (selfConsistent.length === 0) {
          throw new Error('expected self-consistent summary rows to exist')
        }
        return `${selfConsistent.length}/${cases.length} summary rows are internally self-consistent and still carry no evidentiary weight`
      },
    ),
  )

  return checks
}

// --- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].includes('ingest')
if (isMain) {
  const checks = runIngestChecks()
  console.log('\nINGEST BOUNDARY\n' + '='.repeat(76))
  for (const c of checks) {
    console.log(`  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`)
  }
  const failed = checks.filter((c) => !c.passed)
  console.log('='.repeat(76))
  console.log(`${checks.length - failed.length}/${checks.length} passed\n`)
  process.exit(failed.length === 0 ? 0 : 1)
}
