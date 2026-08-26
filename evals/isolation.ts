/**
 * Verifier isolation, enforced by a test rather than by a promise.
 *
 * "The deterministic verifier has zero LLM imports" is the central architectural
 * claim of this product. A claim like that decays the moment someone needs one
 * quick helper, and it decays silently — the code still works, the tests still
 * pass, and the guarantee is gone. So it is asserted mechanically, it runs as
 * part of `npm run eval`, and a violation is a non-zero exit.
 *
 * What is checked, and why each one:
 *
 *  1. **Every import is type-only.** Not "no OpenAI import" — no runtime import
 *     at all. A denylist of model SDKs is a game of catch-up; requiring the file
 *     to have no runtime dependencies is a property that cannot be gamed by
 *     picking a package the list has not heard of.
 *
 *  2. **No free-text field access.** The verifier must not name the quarantined
 *     evidence field, nor any agent-narrative field. This is what makes prompt
 *     injection structurally inert rather than merely filtered.
 *
 *  3. **No ambient nondeterminism.** No clock, no randomness, no I/O. A verifier
 *     whose answer depends on when it ran cannot be replayed, and replay is half
 *     the product.
 *
 *  4. **Ground truth stays out of the serving path.** Nothing under `app/` or
 *     `lib/` may import `loadGroundTruth`. Labels leaking into the code that
 *     produces verdicts would invalidate every metric in the README.
 *
 * Comments are stripped before scanning, so this file's own prose — and the
 * verifier's — can discuss the forbidden names without tripping the check.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const VERIFIER = path.join(ROOT, 'lib', 'verifier', 'deterministic.ts')

export interface IsolationFinding {
  id: string
  passed: boolean
  detail: string
}

/** Remove block and line comments, and string literals, leaving executable code. */
function strip(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const two = source.slice(i, i + 2)
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (two === '//') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    const ch = source[i]
    // Skip string and template literals: a forbidden word inside a message the
    // verifier *writes* is not the verifier *reading* anything.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i++
          break
        }
        // Template substitutions are real code and must still be scanned.
        if (quote === '`' && source.slice(i, i + 2) === '${') {
          let depth = 1
          i += 2
          const start = i
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++
            else if (source[i] === '}') depth--
            i++
          }
          out += ` ${source.slice(start, i - 1)} `
          continue
        }
        i++
      }
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

const FORBIDDEN_IDENTIFIERS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bdisplay\b/, why: 'the quarantined free-text evidence field' },
  { pattern: /\bagent_reason\b|\bagentReason\b/, why: 'agent narrative' },
  { pattern: /\bexplanation\b|\brationale\b/, why: 'agent narrative' },
  { pattern: /\bnarration\b/, why: 'attacker-controlled bank text' },
  { pattern: /\bconfidence\b/, why: 'a model score has no place in a deterministic verdict' },
  { pattern: /\bDate\s*\.\s*now\b/, why: 'ambient clock' },
  { pattern: /\bnew\s+Date\s*\(/, why: 'ambient clock' },
  { pattern: /\bMath\s*\.\s*random\b/, why: 'nondeterminism' },
  { pattern: /\bfetch\s*\(/, why: 'network I/O' },
  { pattern: /\bprocess\s*\.\s*env\b/, why: 'ambient configuration' },
  { pattern: /\brequire\s*\(/, why: 'runtime module load' },
  { pattern: /\bimport\s*\(/, why: 'dynamic import' },
  { pattern: /\breadFileSync\b|\breadFile\b/, why: 'filesystem I/O' },
]

/** Belt and braces: even a type-only import of these would be a smell. */
const FORBIDDEN_MODULES =
  /(openai|anthropic|@ai-sdk|['"`]ai['"`]|langchain|llamaindex|cohere|mistral|gemini|generative)/i

export function checkVerifierIsolation(): IsolationFinding[] {
  const raw = readFileSync(VERIFIER, 'utf8')
  const code = strip(raw)
  const findings: IsolationFinding[] = []

  // --- 1. every import is type-only ----------------------------------------
  const importLines = code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^import\b/.test(l))
  const runtimeImports = importLines.filter((l) => !/^import\s+type\b/.test(l))
  findings.push({
    id: 'verifier_has_zero_runtime_imports',
    passed: runtimeImports.length === 0,
    detail:
      runtimeImports.length === 0
        ? `all ${importLines.length} import statement(s) are type-only and erased at compile time`
        : `runtime import(s) found: ${runtimeImports.join(' | ')}`,
  })

  // --- 2. no model SDK anywhere, even in a type position -------------------
  const moduleHit = raw.match(FORBIDDEN_MODULES)
  const moduleHitInCode = code.match(FORBIDDEN_MODULES)
  findings.push({
    id: 'verifier_references_no_model_sdk',
    passed: moduleHitInCode === null,
    detail:
      moduleHitInCode === null
        ? 'no model SDK identifier appears in executable code' +
          (moduleHit ? ' (a mention exists in comments only, which is fine)' : '')
        : `model SDK identifier '${moduleHitInCode[0]}' appears in executable code`,
  })

  // --- 3. no free text, no ambient nondeterminism ---------------------------
  for (const { pattern, why } of FORBIDDEN_IDENTIFIERS) {
    const hit = code.match(pattern)
    findings.push({
      id: `verifier_avoids_${pattern.source.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`,
      passed: hit === null,
      detail:
        hit === null
          ? `no reference to ${why}`
          : `found '${hit[0]}' in executable code — ${why} must not reach the verdict`,
    })
  }

  return findings
}

/** No label may reach the code that serves verdicts. */
export function checkGroundTruthIsolation(): IsolationFinding[] {
  const offenders: string[] = []
  for (const dir of ['app', 'lib', 'components']) {
    for (const file of walk(path.join(ROOT, dir))) {
      if (!/\.(ts|tsx)$/.test(file)) continue
      const code = strip(readFileSync(file, 'utf8'))
      // The loader itself defines the symbol; that is not a leak.
      if (file.endsWith(path.join('lib', 'data', 'ledger.ts'))) continue
      if (/\bloadGroundTruth\b|ground_truth_/.test(code)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
  }
  return [
    {
      id: 'ground_truth_never_reaches_serving_path',
      passed: offenders.length === 0,
      detail:
        offenders.length === 0
          ? 'no file under app/, lib/ or components/ reads ground truth; only evals/ does'
          : `ground truth is reachable from: ${offenders.join(', ')}`,
    },
  ]
}

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else out.push(full)
  }
  return out
}

export function runIsolationChecks(): { passed: boolean; findings: IsolationFinding[] } {
  const findings = [...checkVerifierIsolation(), ...checkGroundTruthIsolation()]
  return { passed: findings.every((f) => f.passed), findings }
}

// --- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].includes('isolation')
if (isMain) {
  const { passed, findings } = runIsolationChecks()
  console.log('\nVERIFIER ISOLATION\n' + '='.repeat(72))
  for (const f of findings) {
    console.log(`  ${f.passed ? 'PASS' : 'FAIL'}  ${f.id}\n        ${f.detail}`)
  }
  console.log('='.repeat(72))
  console.log(passed ? 'Isolation intact.\n' : 'ISOLATION BROKEN.\n')
  process.exit(passed ? 0 : 1)
}
