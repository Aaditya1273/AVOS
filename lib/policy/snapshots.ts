/**
 * Historical policy resolution — the input to the Guard pillar.
 *
 * The entire product rests on one sentence: **a decision is judged under the
 * policy that existed when the decision occurred, not the policy that exists
 * today.** Everything else about replay and auditability follows from that.
 *
 * So policy is never a constant and never "current". It is a function of a
 * timestamp, resolved from an append-only list of snapshots. `resolvePolicy` is
 * the only way any layer obtains a tolerance.
 */

import type { PolicySnapshot } from '@/lib/types'
import snapshotsJson from '@/data/policy_snapshots.json'

/** Sorted ascending by effective_at, once, at module load. */
export const POLICY_SNAPSHOTS: PolicySnapshot[] = ([...(snapshotsJson as PolicySnapshot[])]).sort(
  (a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at),
)

export class NoPolicyInForceError extends Error {
  constructor(at: string) {
    super(`no finance policy was in force at ${at}`)
    this.name = 'NoPolicyInForceError'
  }
}

/**
 * The snapshot in force at `at`: the latest one whose effective_at is <= `at`.
 *
 * Inclusive at the boundary — a policy that becomes effective at 09:15 governs a
 * decision taken at exactly 09:15. Ambiguity at a boundary instant is how two
 * auditors reach two different answers from the same log.
 *
 * Returns null when the instant predates every snapshot. That is not an error to
 * paper over with a default: an unenforceable decision must abstain, not close.
 */
export function resolvePolicy(at: string): PolicySnapshot | null {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return null
  let active: PolicySnapshot | null = null
  for (const p of POLICY_SNAPSHOTS) {
    if (Date.parse(p.effective_at) <= t) active = p
    else break
  }
  return active
}

export function resolvePolicyOrThrow(at: string): PolicySnapshot {
  const p = resolvePolicy(at)
  if (!p) throw new NoPolicyInForceError(at)
  return p
}

export function policyByVersion(version: string): PolicySnapshot | null {
  return POLICY_SNAPSHOTS.find((p) => p.version === version) ?? null
}

/**
 * A synthetic "nothing was in force" snapshot.
 *
 * The verifier still needs a shape to report against when policy resolution
 * fails, and inventing a permissive default would be the single most dangerous
 * line in the codebase. This one is maximally restrictive: zero tolerance, zero
 * lag, nothing closeable. It can only ever produce an abstention.
 */
export const NULL_POLICY: PolicySnapshot = {
  version: 'none-in-force',
  effective_at: '',
  fee_tolerance_paise: 0,
  max_settlement_lag_days: 0,
  evidence_freshness_max_hours: 0,
  closeable_statuses: [],
}
