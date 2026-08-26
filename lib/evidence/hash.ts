/**
 * Content hashing for evidence rows.
 *
 * Two properties the rest of the system depends on:
 *
 *  1. **row_id is excluded from the hash.** A source file re-ingested twice
 *     produces two rows with different row_ids and identical content. Because
 *     the hash covers content only, those two rows collide — and that collision
 *     IS the duplicate-file detector. Hashing row_id would hide the bug.
 *
 *  2. **Canonical key order.** Keys are sorted before serialisation, so the hash
 *     depends on the data and not on the order a loader happened to build the
 *     object. Without this, replay would report spurious non-reproducibility.
 *
 * `node:crypto` is a server-only import, which is why this lives here and not in
 * the verifier: the verifier consumes `hash_matches_recorded` as a boolean and
 * stays importless.
 */

import { createHash } from 'node:crypto'

export function canonicalize(content: Record<string, string | number>): string {
  const keys = Object.keys(content).sort()
  const parts = keys.map((k) => `${k}=${String(content[k])}`)
  return parts.join('')
}

export function hashContent(content: Record<string, string | number>): string {
  return createHash('sha256').update(canonicalize(content), 'utf8').digest('hex')
}

/** A pack-level fingerprint: one value that identifies an exact evidence set. */
export function hashPack(evidenceHashes: string[]): string {
  return createHash('sha256').update(evidenceHashes.join(''), 'utf8').digest('hex')
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12)
}
