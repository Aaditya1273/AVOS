/**
 * Product-path checks: Razorpay → Ledger → Evidence → Verifier → closure.
 *
 * Offline. These use the committed Razorpay-SHAPED fixture and stub the model
 * transport; they prove the wiring, the boundaries and the absence of fallbacks.
 * They do NOT prove that api.razorpay.com answered — only
 * `scripts/razorpay_live.ts` does that, on purpose, outside the gates.
 *
 * What is being established, in order:
 *   - the pipeline is executable end to end on adapter output (RT01–RT03)
 *   - nothing on the product path can reach a CSV or the decision log (RT04)
 *   - an empty Razorpay answer is an empty screen, not 120 fixtures (RT05)
 *   - every evidence row says where it came from (RT06, RT10)
 *   - "connected" is earned by a 2xx, not by an env var (RT07)
 *   - credentials cannot reach the browser (RT08)
 *   - the connector cannot write (RT09)
 *   - the product path cannot use the scripted proposer (RT11, RT12)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  classifyConnection,
  normalizeRazorpay,
  type RazorpayApiCall,
  type RazorpayReconResponse,
  type RazorpaySettlementsResponse,
  type RazorpaySnapshot,
} from '@/lib/connectors/razorpay'
import { casesFromLedger, syncFromSnapshot } from '@/lib/razorpay/runtime'
import { __setTransportForTests, generateStructuredStrict, ModelUnavailableError } from '@/lib/ai/provider'
import { proposeClaimStrict } from '@/lib/ai/agent'
import { buildEvidencePack } from '@/lib/evidence/pack'
import { verifyClaim } from '@/lib/verifier/deterministic'
import { loadCases, loadLedger } from '@/lib/data/ledger'
import type { AgentProposal, EvidencePack } from '@/lib/types'

export interface RuntimeCheck {
  id: string
  name: string
  passed: boolean
  detail: string
}

function check(id: string, name: string, fn: () => string | Promise<string>): Promise<RuntimeCheck> {
  return Promise.resolve()
    .then(fn)
    .then((detail) => ({ id, name, passed: true, detail }))
    .catch((e: Error) => ({ id, name, passed: false, detail: e.message }))
}

function eq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, 'data', 'fixtures', 'razorpay')
const FETCHED_AT = '2026-09-05T12:00:00.000Z'

function loadFixtures(): { recon: RazorpayReconResponse; settlements: RazorpaySettlementsResponse } {
  return {
    recon: JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'recon-report.json'), 'utf8')),
    settlements: JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'settlements.json'), 'utf8')),
  }
}

function okCall(endpoint: string, count = 0): RazorpayApiCall {
  return { endpoint, method: 'GET', status: 200, ok: true, count, elapsed_ms: 10, error: null, at: FETCHED_AT, attempt: 1 }
}

/** A snapshot as the connector would return it, without the network. */
function snapshotFrom(
  recon: RazorpayReconResponse,
  settlements: RazorpaySettlementsResponse,
  activity: RazorpayApiCall[],
): RazorpaySnapshot {
  const n = normalizeRazorpay(recon, settlements, { ingestedAt: FETCHED_AT, merchantId: 'RZP-TEST' })
  const state = classifyConnection(true, activity)
  return {
    fetched_at: FETCHED_AT,
    mode: 'test',
    connection: { state, detail: state, mode: 'test', key_id_prefix: 'rzp_test_', checked_at: FETCHED_AT },
    activity,
    counts: { settlements: settlements.items.length, recon_rows: recon.items.length, payments: 0, refunds: 0 },
    ledger: n.ledger,
    ledger_counts: n.counts,
    rejected: n.rejected,
    unsettled: { payments: [], refunds: [] },
  }
}

const EMPTY = { entity: 'collection', count: 0, items: [] }
const FOUR_OK = [
  okCall('/v1/settlements'),
  okCall('/v1/settlements/recon/combined'),
  okCall('/v1/settlements/recon/combined'),
  okCall('/v1/payments'),
  okCall('/v1/refunds'),
]

/** A stub transport that behaves like a model: reads the pack, cites every id. */
function stubProposer(status: 'RECONCILED' | 'NOT_RECONCILED' = 'RECONCILED') {
  return async (pack: EvidencePack): Promise<AgentProposal> => ({
    claim: { settlement_id: pack.settlement_id, proposed_status: status, evidence_ids: pack.evidence.map((e) => e.evidence_id) },
    agent_reason: 'stub transport for wiring test',
    confidence: 0.5,
    agent_version: 'test',
    model_version: 'stub-transport',
    used_mock: false,
  })
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export async function runRuntimeChecks(): Promise<RuntimeCheck[]> {
  const checks: RuntimeCheck[] = []

  // --- the executable path ------------------------------------------------

  checks.push(
    await check('RT01', 'connector output becomes cases with nothing typed in', () => {
      const { recon, settlements } = loadFixtures()
      const { ledger } = normalizeRazorpay(recon, settlements, { ingestedAt: FETCHED_AT, merchantId: 'RZP-TEST' })
      const cases = casesFromLedger(ledger, FETCHED_AT)
      eq(cases.length, 1, 'cases')
      const c = cases[0]
      eq(c.settlement_id, 'setl_AVOSdemo00001', 'settlement_id')
      eq(c.settlement_amount_paise, 363165, 'net from the settlement row')
      eq(c.refund_paise, 50000, 'refunds summed from ledger rows')
      eq(c.razorpay_payment_ids.length, 3, 'payment ids from ledger rows')
      eq(c.bank_credit_paise, null, 'no bank figure exists to invent')
      eq(c.decision_time, FETCHED_AT, 'decided at fetch time')
      return `1 case derived from ledger rows; net ₹3,631.65, 3 payments, ₹500 refunded, no bank figure`
    }),
  )

  checks.push(
    await check('RT02', 'ledger → pack → verifier runs on adapter output', () => {
      const { recon, settlements } = loadFixtures()
      const { ledger } = normalizeRazorpay(recon, settlements, { ingestedAt: FETCHED_AT, merchantId: 'RZP-TEST' })
      const [c] = casesFromLedger(ledger, FETCHED_AT)
      const pack = buildEvidencePack(c, { ledger })
      if (pack.evidence.length === 0) throw new Error('empty pack')
      const result = verifyClaim(
        { settlement_id: c.settlement_id, proposed_status: 'RECONCILED', evidence_ids: pack.evidence.map((e) => e.evidence_id) },
        pack,
        pack.policy_snapshot,
        FETCHED_AT,
      )
      if (!['VERIFIED', 'UNCERTAIN', 'FAILED'].includes(result.verdict)) throw new Error('no verdict')
      return `${pack.evidence.length} evidence rows → verifier ${result.verifier_version} → ${result.verdict}${result.reason_code ? ' ' + result.reason_code : ''}`
    }),
  )

  checks.push(
    await check('RT03', 'full sync produces a closed decision from a model claim', async () => {
      const { recon, settlements } = loadFixtures()
      const payload = await syncFromSnapshot(snapshotFrom(recon, settlements, FOUR_OK), { propose: stubProposer(), narrate: async () => null })
      eq(payload.outcome, 'SUCCESS', 'outcome')
      eq(payload.cases.length, 1, 'cases')
      const c = payload.cases[0]
      if (!c.proposal || !c.result || !c.closure) throw new Error('pipeline stopped short')
      eq(c.proposal.used_mock, false, 'used_mock')
      eq(payload.agent.state, 'available', 'agent')
      if (!['CLOSED', 'REFUSED_TO_CLOSE', 'FAILED'].includes(c.closure.status)) throw new Error('no closure')
      return `${c.result.verdict} → ${c.closure.status}; provenance on every row: ${c.pack.evidence.every((e) => e.provenance.origin === 'razorpay_test_api')}`
    }),
  )

  // --- no fixture on the product path ------------------------------------

  checks.push(
    await check('RT04', 'the product path cannot reach a CSV or the decision log', () => {
      const files = [
        'lib/connectors/razorpay.ts',
        'lib/razorpay/runtime.ts',
        'app/api/razorpay/sync/route.ts',
        'components/razorpay-console.tsx',
      ]
      const forbidden = [
        /\bloadLedger\b/, /\bloadCases\b/, /\bloadDecisionLog\b/, /\bmaterializeDecision\b/, /\bmaterializeSuite\b/,
        /\bplaceholderProposal\b/, /\bmockPropose\b/, /\bproposeClaim\b(?!Strict)/, /\breadFileSync\b/, /\.csv\b/, /decision_log/,
        /lib\/data\/ledger'/, /lib\/decisions'/,
      ]
      for (const f of files) {
        const code = stripComments(readFileSync(path.join(ROOT, f), 'utf8'))
        // Type-only imports are erased; the check is about executable reach.
        // Multi-line `import type { … } from '…'` blocks included.
        const executable = code.replace(/^import type[\s\S]*?from '[^']+'\s*$/gm, '')
        for (const re of forbidden) {
          if (re.test(executable)) throw new Error(`${f} references ${re.source} in executable code`)
        }
      }
      return `${files.length} product-path files reference no CSV loader, no decision log and no scripted proposer`
    }),
  )

  checks.push(
    await check('RT05', 'zero from Razorpay stays zero', async () => {
      const payload = await syncFromSnapshot(snapshotFrom(EMPTY, EMPTY, FOUR_OK), { propose: stubProposer() })
      eq(payload.connection.state, 'CONNECTED', 'connected')
      eq(payload.outcome, 'EMPTY', 'outcome')
      eq(payload.cases.length, 0, 'cases')
      eq(payload.counts.settlements, 0, 'settlements')
      eq(payload.ledger_counts.payments, 0, 'ledger payments')
      // The evaluation set is right there on disk and must not have been touched.
      const evalCases = loadCases('batch_120').length
      if (evalCases !== 120) throw new Error('fixture size changed; test premise invalid')
      return `CONNECTED + 0 records → outcome EMPTY, 0 cases, while ${evalCases} evaluation cases sit unused on disk`
    }),
  )

  // --- provenance ---------------------------------------------------------

  checks.push(
    await check('RT06', 'every live evidence row names its origin, endpoint, entity and fetch time', () => {
      const { recon, settlements } = loadFixtures()
      const { ledger } = normalizeRazorpay(recon, settlements, { ingestedAt: FETCHED_AT, merchantId: 'RZP-TEST' })
      const [c] = casesFromLedger(ledger, FETCHED_AT)
      const pack = buildEvidencePack(c, { ledger })
      for (const e of pack.evidence) {
        eq(e.provenance.origin, 'razorpay_test_api', `${e.evidence_id} origin`)
        eq(e.provenance.label, 'Razorpay Test API', `${e.evidence_id} label`)
        eq(e.provenance.fetched_at, FETCHED_AT, `${e.evidence_id} fetched_at`)
        if (!e.provenance.endpoint.startsWith('/v1/')) throw new Error(`${e.evidence_id}: endpoint '${e.provenance.endpoint}'`)
        if (!e.provenance.entity_id) throw new Error(`${e.evidence_id}: no entity id`)
      }
      // And not in the hash: same facts, later fetch, same hash.
      const later = normalizeRazorpay(recon, settlements, { ingestedAt: '2026-09-06T00:00:00.000Z', merchantId: 'RZP-TEST' })
      const [c2] = casesFromLedger(later.ledger, '2026-09-06T00:00:00.000Z')
      const pack2 = buildEvidencePack(c2, { ledger: later.ledger })
      eq(pack2.evidence.map((e) => e.hash).join(), pack.evidence.map((e) => e.hash).join(), 'hashes across fetch times')
      return `${pack.evidence.length} rows stamped razorpay_test_api with /v1/ endpoints; provenance excluded from the hash`
    }),
  )

  checks.push(
    await check('RT07', '"connected" is derived from a 2xx, never from an env var', () => {
      eq(classifyConnection(false, []), 'NOT_CONFIGURED', 'no creds')
      eq(classifyConnection(true, []), 'UNAVAILABLE', 'creds but no request made')
      eq(classifyConnection(true, FOUR_OK), 'CONNECTED', 'all 2xx')
      const auth = [{ ...okCall('/v1/settlements'), status: 401, ok: false, error: '401' }]
      eq(classifyConnection(true, auth), 'AUTHENTICATION_FAILED', '401')
      const down = [{ ...okCall('/v1/settlements'), status: null, ok: false, error: 'connect timeout' }]
      eq(classifyConnection(true, down), 'UNAVAILABLE', 'no response')
      const mixed = [okCall('/v1/settlements'), { ...okCall('/v1/payments'), status: 503, ok: false, error: '503' }]
      eq(classifyConnection(true, mixed), 'UNAVAILABLE', 'partial failure is not connected')
      // A network blip followed by a successful retry is a connected read.
      const recovered = [
        { ...okCall('/v1/settlements'), status: null, ok: false, error: 'connect timeout' },
        { ...okCall('/v1/settlements'), attempt: 2 as const },
        okCall('/v1/payments'),
      ]
      eq(classifyConnection(true, recovered), 'CONNECTED', 'retry recovered')
      const notRecovered = [
        { ...okCall('/v1/settlements'), status: null, ok: false, error: 'connect timeout' },
        { ...okCall('/v1/settlements'), attempt: 2 as const, status: null, ok: false, error: 'connect timeout' },
      ]
      eq(classifyConnection(true, notRecovered), 'UNAVAILABLE', 'retry also failed')
      return 'NOT_CONFIGURED / UNAVAILABLE / CONNECTED / AUTHENTICATION_FAILED each require the matching activity, not a key; a recovered retry counts as connected'
    }),
  )

  // --- security -----------------------------------------------------------

  checks.push(
    await check('RT08', 'credentials cannot reach the browser', () => {
      const client = stripComments(readFileSync(path.join(ROOT, 'components/razorpay-console.tsx'), 'utf8'))
      if (/process\.env/.test(client)) throw new Error('client component reads process.env')
      if (!/^import type .*lib\/razorpay\/runtime'/m.test(client)) throw new Error('runtime import in the client is not type-only')
      const staticDir = path.join(ROOT, '.next', 'static')
      if (!existsSync(staticDir)) return 'client source clean (no process.env; type-only runtime import); .next/static absent so bundle not scanned'
      const hits: string[] = []
      for (const f of walk(staticDir).filter((f) => f.endsWith('.js'))) {
        const body = readFileSync(f, 'utf8')
        for (const pat of ['RAZORPAY_KEY', 'rzp_test_', 'rzp_live_', 'api.razorpay.com', 'OPENAI_API_KEY']) {
          if (body.includes(pat)) hits.push(`${path.relative(ROOT, f)}:${pat}`)
        }
      }
      if (hits.length) throw new Error(`client bundle contains: ${hits.slice(0, 5).join(', ')}`)
      return 'client source clean and built client bundle contains no key name, key prefix or API host'
    }),
  )

  checks.push(
    await check('RT09', 'the connector and the route can only GET', () => {
      for (const f of ['lib/connectors/razorpay.ts', 'lib/razorpay/runtime.ts']) {
        const code = stripComments(readFileSync(path.join(ROOT, f), 'utf8'))
        for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          if (new RegExp(`['"\`]${verb}['"\`]`).test(code)) throw new Error(`${f} names ${verb}`)
        }
        const methods = code.match(/method:\s*'([A-Z]+)'/g) ?? []
        for (const m of methods) if (!/'GET'/.test(m)) throw new Error(`${f}: ${m}`)
      }
      // The route accepts a browser POST but makes no outbound request itself.
      const route = stripComments(readFileSync(path.join(ROOT, 'app/api/razorpay/sync/route.ts'), 'utf8'))
      if (/\bfetch\s*\(/.test(route)) throw new Error('route makes its own outbound request')
      return 'one outbound request function, literal GET; route has no fetch of its own'
    }),
  )

  // --- evaluation cannot masquerade --------------------------------------

  checks.push(
    await check('RT10', 'evaluation evidence is labelled as evaluation, never as Razorpay', () => {
      const ledger = loadLedger()
      const c = loadCases('batch_120')[0]
      const pack = buildEvidencePack(c, { ledger })
      for (const e of pack.evidence) {
        eq(e.provenance.origin, 'avos_evaluation', `${e.evidence_id} origin`)
        eq(e.provenance.label, 'AVOS Evaluation Dataset', `${e.evidence_id} label`)
        if (!e.provenance.endpoint.startsWith('data/')) throw new Error(`${e.evidence_id}: endpoint ${e.provenance.endpoint}`)
      }
      return `${pack.evidence.length} evaluation rows labelled 'AVOS Evaluation Dataset' from data/*.csv`
    }),
  )

  // --- the agent ----------------------------------------------------------

  checks.push(
    await check('RT11', 'with no model, the product path reports unavailable and substitutes nothing', async () => {
      const savedKey = process.env.OPENAI_API_KEY
      const savedMock = process.env.AVOS_USE_MOCK
      try {
        delete process.env.OPENAI_API_KEY
        delete process.env.AVOS_USE_MOCK
        __setTransportForTests(null)
        const { recon, settlements } = loadFixtures()
        // Default proposer: proposeClaimStrict, no override.
        const payload = await syncFromSnapshot(snapshotFrom(recon, settlements, FOUR_OK))
        eq(payload.agent.state, 'unavailable', 'agent')
        eq(payload.cases.length, 1, 'case still shown')
        eq(payload.cases[0].proposal, null, 'proposal')
        eq(payload.cases[0].result, null, 'result')
        eq(payload.cases[0].closure, null, 'closure')
        if (payload.cases[0].pack.evidence.length === 0) throw new Error('evidence should still be built')
        let threw = false
        try {
          await proposeClaimStrict(payload.cases[0].pack)
        } catch (e) {
          threw = e instanceof ModelUnavailableError
        }
        if (!threw) throw new Error('proposeClaimStrict did not throw ModelUnavailableError')
        return `agent=unavailable, evidence built (${payload.cases[0].pack.evidence.length} rows), no proposal, no verdict, no closure — nothing scripted`
      } finally {
        if (savedKey === undefined) delete process.env.OPENAI_API_KEY
        else process.env.OPENAI_API_KEY = savedKey
        if (savedMock === undefined) delete process.env.AVOS_USE_MOCK
        else process.env.AVOS_USE_MOCK = savedMock
      }
    }),
  )

  checks.push(
    await check('RT12', 'when a model is reachable the strict path calls it, not the stand-in', async () => {
      let transportCalls = 0
      __setTransportForTests(async <T,>(call: { prompt: string }): Promise<T> => {
        transportCalls++
        // Prove the real prompt reached the transport: it must carry the pack.
        if (!/setl_AVOSdemo00001/.test(call.prompt)) throw new Error('prompt did not include the settlement')
        return {
          proposed_status: 'RECONCILED',
          evidence_ids: [],
          agent_reason: 'from stub transport',
          confidence: 0.4,
        } as unknown as T
      })
      try {
        const { recon, settlements } = loadFixtures()
        const payload = await syncFromSnapshot(snapshotFrom(recon, settlements, FOUR_OK), { narrate: async () => null })
        eq(transportCalls, 1, 'transport calls')
        eq(payload.agent.state, 'available', 'agent')
        const c = payload.cases[0]
        if (!c.proposal) throw new Error('no proposal')
        eq(c.proposal.used_mock, false, 'used_mock')
        eq(c.proposal.agent_reason, 'from stub transport', 'reason came through the transport')
        if (!c.result) throw new Error('no verdict')
        // And the same strict function refuses to touch the stand-in even with the override off.
        __setTransportForTests(null)
        const saved = process.env.OPENAI_API_KEY
        delete process.env.OPENAI_API_KEY
        try {
          await generateStructuredStrict({ system: '', prompt: '', schema: { parse: (v: unknown) => v } as never })
          throw new Error('strict path returned without a model')
        } catch (e) {
          if (!(e instanceof ModelUnavailableError)) throw e
        } finally {
          if (saved !== undefined) process.env.OPENAI_API_KEY = saved
        }
        return `1 transport call carried the real prompt; proposal.used_mock=false; verdict ${c.result.verdict}. This proves wiring, not OpenAI.`
      } finally {
        __setTransportForTests(null)
      }
    }),
  )

  return checks
}

// --- CLI ---------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].includes('razorpay-runtime')
if (isMain) {
  void runRuntimeChecks().then((checks) => {
    console.log('\nRAZORPAY PRODUCT PATH (offline — fixture-shaped input, stubbed transport)\n' + '='.repeat(76))
    for (const c of checks) console.log(`  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`)
    const failed = checks.filter((c) => !c.passed)
    console.log('='.repeat(76))
    console.log(`${checks.length - failed.length}/${checks.length} passed\n`)
    process.exit(failed.length === 0 ? 0 : 1)
  })
}
