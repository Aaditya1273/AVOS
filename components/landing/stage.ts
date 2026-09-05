/**
 * The contract between the pinned story and whichever stage draws it.
 *
 * Two stages implement it — WebGL on a wide screen with motion allowed, SVG
 * everywhere else — and the story never knows which. Both move the same
 * object along the same six nodes to the same gate, and both can say where a
 * node or the object currently is on screen, so HTML layers can attach to it.
 */

export const NODES = ['Razorpay', 'Ledger', 'AI proposal', 'Evidence', 'Policy', 'Verifier'] as const
export type NodeIndex = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Where, in story progress (0–1), each chapter begins. The stage uses these to
 * place the object; the story uses them to time its layers. One source.
 */
export const PHASE = {
  hero: 0,
  ledger: 0.12,
  proposal: 0.24,
  evidence: 0.38,
  verify: 0.54,
  conflict: 0.7,
  consequence: 0.84,
} as const

/** Fraction of the final segment (Verifier → gate) the object reaches. It is blocked there. */
export const BLOCK_AT = 0.86

export interface Anchor {
  x: number
  y: number
}

export interface StageApi {
  setProgress(p: number): void
  /** Screen-space position (px, relative to the stage element) of a node or of the object. */
  anchor(target: NodeIndex | 'object' | 'gate'): Anchor | null
  dispose(): void
}

/**
 * Object travel as a function of story progress. Returns which segment the
 * object is on (0–5, where 5 is Verifier → gate) and how far along it.
 */
export function travel(p: number): { segment: number; t: number; blocked: boolean } {
  const stops: [number, number][] = [
    [PHASE.hero, PHASE.ledger],
    [PHASE.ledger, PHASE.proposal],
    [PHASE.proposal, PHASE.evidence],
    [PHASE.evidence, PHASE.verify],
    [PHASE.verify, PHASE.conflict],
  ]
  for (let i = 0; i < stops.length; i++) {
    const [a, b] = stops[i]
    if (p < b) {
      // Dwell for the first third of each phase, then move.
      const local = (p - a) / (b - a)
      const t = Math.min(1, Math.max(0, (local - 0.3) / 0.7))
      return { segment: i, t: ease(t), blocked: false }
    }
  }
  // Final approach: Verifier → gate, stopping short.
  // The approach takes the first 60% of the conflict phase; the block holds
  // for the rest, so the text that names it (at +0.09) lands on a stopped object.
  const local = Math.min(1, (p - PHASE.conflict) / (PHASE.consequence - PHASE.conflict))
  const approach = Math.min(1, local / 0.6)
  const t = Math.min(BLOCK_AT, ease(approach) * BLOCK_AT)
  return { segment: 5, t, blocked: local >= 0.6 }
}

function ease(t: number): number {
  // Slow in, slow out — an object settling, not sliding.
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
