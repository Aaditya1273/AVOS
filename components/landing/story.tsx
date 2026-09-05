'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Badge, Mono } from '@/components/ui/primitives'
import { IconArrowRight, IconCross } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { ThreeStage } from './three-stage'
import { SvgStage } from './svg-stage'
import { NODES, PHASE, type StageApi } from './stage'

/**
 * The pinned story: one settlement, seven chapters, one scrubbed timeline.
 *
 * The stage (WebGL or SVG) is pinned for the length of the story. Scroll is
 * the only clock: a GSAP timeline scrubbed against the pin drives the chapter
 * copy on the left, the layers that attach to the settlement on the right,
 * and — through `stage.setProgress` — the object itself. Nothing animates
 * while the reader is still.
 *
 * The chapters are the product's logic, in order: the settlement arrives from
 * Razorpay, is normalised into the ledger, a model proposes RECONCILED at
 * 0.95, evidence assembles around it, the verifier recomputes the money and
 * finds the difference, the object reaches the close gate and is stopped, and
 * the screen quiets on what that means: the money is held.
 *
 * Under prefers-reduced-motion the same seven chapters render as a static
 * sequence beneath a static stage. Every fact is ordinary HTML either way.
 */

export interface StoryFacts {
  amount: string
  difference: string
  expected: string
  observed: string
  tolerance: string
  proposal: string
  confidence: string
  reasonWord: string
  reasonCode: string
  evidenceRows: number
  policy: string
  settlementId: string
  caseId: string
  sourceLabel: string
}

const EVIDENCE_CHIPS = ['Razorpay settlement', 'Payment', 'Policy', 'Amount', 'Timestamp'] as const
/** Locked positions around the object, in px, for the five evidence chips. */
const CHIP_LOCK = [
  [-170, -78],
  [150, -78],
  [-190, 34],
  [170, 34],
  [-10, 92],
] as const
/** Where each chip flies in from. */
const CHIP_FROM = [
  [-360, -220],
  [340, -240],
  [-380, 160],
  [360, 180],
  [0, 260],
] as const

function usePrefs() {
  const [prefs, setPrefs] = useState<{ ready: boolean; motion: boolean; wide: boolean; webgl: boolean }>({
    ready: false,
    motion: true,
    wide: true,
    webgl: false,
  })
  useEffect(() => {
    let webgl = false
    try {
      const c = document.createElement('canvas')
      webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'))
    } catch {
      webgl = false
    }
    setPrefs({
      ready: true,
      motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      wide: window.innerWidth >= 1024,
      webgl,
    })
  }, [])
  return prefs
}

export function Story({ facts }: { facts: StoryFacts }) {
  const prefs = usePrefs()
  const root = useRef<HTMLElement>(null)
  const pin = useRef<HTMLDivElement>(null)
  const stageBox = useRef<HTMLDivElement>(null)
  const stage = useRef<StageApi | null>(null)
  const layers = useRef<HTMLDivElement>(null)
  const [stageReady, setStageReady] = useState(false)

  const use3d = prefs.ready && prefs.motion && prefs.wide && prefs.webgl
  const animate = prefs.ready && prefs.motion

  // --- the timeline ----------------------------------------------------------
  useEffect(() => {
    if (!animate || !root.current || !pin.current) return
    if (use3d && !stageReady) return
    gsap.registerPlugin(ScrollTrigger)

    const q = gsap.utils.selector(root.current)
    const chapters = q<HTMLElement>('[data-chapter]')
    const aiChip = q<HTMLElement>('[data-layer="ai"]')[0]
    const chips = q<HTMLElement>('[data-chip]')
    const status = q<HTMLElement>('[data-status]')
    const blocked = q<HTMLElement>('[data-layer="blocked"]')[0]
    const veil = q<HTMLElement>('[data-layer="veil"]')[0]
    const nodeLabels = q<HTMLElement>('[data-node-label]')
    const numbers = q<HTMLElement>('[data-number]')
    const rule = q<HTMLElement>('[data-rule]')[0]

    const ctx = gsap.context(() => {
      // Layers follow the object; node labels follow their nodes. One DOM
      // write per element per update, no reads — anchors come from the stage.
      const place = () => {
        const s = stage.current
        if (!s) return
        const o = s.anchor('object')
        if (o) gsap.set(layers.current, { x: o.x, y: o.y })
        nodeLabels.forEach((el, i) => {
          const a = s.anchor(i as 0)
          if (a) gsap.set(el, { x: a.x, y: a.y + 44 })
        })
        const g = s.anchor('gate')
        if (g && blocked) gsap.set(blocked, { x: g.x + 36, y: g.y - 150 })
      }

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: root.current,
          pin: pin.current,
          start: 'top top',
          end: () => `+=${prefs.wide ? 620 : 380}%`,
          scrub: 0.5,
          invalidateOnRefresh: true,
          anticipatePin: 1,
          // Refreshed before every trigger below it, so their positions include
          // this pin's spacer. Refresh order is creation order unless told
          // otherwise, and this pin is created last (it waits for the stage).
          refreshPriority: 1,
          onUpdate: (self) => {
            stage.current?.setProgress(self.progress)
            place()
          },
          onRefresh: (self) => {
            stage.current?.setProgress(self.progress)
            place()
          },
        },
      })

      // Pin the timeline's length to exactly 1 so scroll progress maps 1:1 onto
      // PHASE values — the same numbers the stage uses. Without this the
      // timeline ends where its last tween ends (~0.89) and the copy drifts
      // ahead of the object.
      tl.set({}, {}, 1)

      // Chapter copy: each block owns its phase. Transitions are short and
      // land exactly at the phase boundary the stage uses.
      const phases = [PHASE.hero, PHASE.ledger, PHASE.proposal, PHASE.evidence, PHASE.verify, PHASE.conflict, PHASE.consequence, 1]
      chapters.forEach((el, i) => {
        const start = phases[i]
        const end = phases[i + 1]
        if (i > 0) {
          gsap.set(el, { autoAlpha: 0, y: 18 })
          tl.to(el, { autoAlpha: 1, y: 0, duration: 0.03, ease: 'power2.out' }, start)
        }
        if (i < chapters.length - 1) tl.to(el, { autoAlpha: 0, y: -14, duration: 0.03, ease: 'power2.in' }, end - 0.03)
      })

      // Node labels on the WebGL stage: names appear as the object reaches them.
      nodeLabels.forEach((el, i) => {
        gsap.set(el, { autoAlpha: i === 0 ? 1 : 0.35 })
        const at = phases[Math.min(i, 5)] + 0.02
        tl.to(el, { autoAlpha: 1, duration: 0.02 }, at)
      })

      // The AI proposal attaches to the settlement — one layer, not the hero.
      gsap.set(aiChip, { autoAlpha: 0, scale: 0.92, transformOrigin: 'left center' })
      tl.to(aiChip, { autoAlpha: 1, scale: 1, duration: 0.04, ease: 'power2.out' }, PHASE.proposal + 0.03)

      // Evidence flies in and locks around the object, then converges.
      chips.forEach((el, i) => {
        gsap.set(el, { autoAlpha: 0, x: CHIP_FROM[i][0], y: CHIP_FROM[i][1], scale: 0.9 })
        tl.to(el, { autoAlpha: 1, x: CHIP_LOCK[i][0], y: CHIP_LOCK[i][1], scale: 1, duration: 0.06, ease: 'power3.out' }, PHASE.evidence + 0.02 + i * 0.012)
        tl.to(el, { scale: 0.97, duration: 0.01, ease: 'power1.inOut' }, PHASE.evidence + 0.09 + i * 0.012)
        tl.to(el, { scale: 1, duration: 0.01 }, PHASE.evidence + 0.1 + i * 0.012)
        // Converge: into a column beside the object, then step back.
        tl.to(el, { x: 190, y: -70 + i * 26, scale: 0.9, autoAlpha: 0.55, duration: 0.06, ease: 'power2.inOut' }, PHASE.verify)
        tl.to(el, { autoAlpha: 0, duration: 0.04 }, PHASE.conflict)
      })

      // Verification: expected → observed → the difference emerges between them.
      numbers.forEach((el) => gsap.set(el, { autoAlpha: 0, y: 12 }))
      if (rule) gsap.set(rule, { scaleX: 0, transformOrigin: 'left center' })
      tl.to(numbers[0], { autoAlpha: 1, y: 0, duration: 0.03, ease: 'power2.out' }, PHASE.verify + 0.02)
      tl.to(numbers[1], { autoAlpha: 1, y: 0, duration: 0.03, ease: 'power2.out' }, PHASE.verify + 0.055)
      if (rule) tl.to(rule, { scaleX: 1, duration: 0.03, ease: 'power2.inOut' }, PHASE.verify + 0.085)
      if (numbers[2]) {
        gsap.set(numbers[2], { autoAlpha: 0, scale: 0.7, y: -10, transformOrigin: 'left center' })
        tl.to(numbers[2], { autoAlpha: 1, scale: 1, y: 0, duration: 0.04, ease: 'power3.out' }, PHASE.verify + 0.105)
      }

      // The status word transforms, in place: RECONCILED → FEE MISMATCH → NOT CLOSED.
      gsap.set(status[1], { autoAlpha: 0, y: 10 })
      gsap.set(status[2], { autoAlpha: 0, y: 10 })
      tl.to(status[0], { autoAlpha: 0, y: -10, duration: 0.015 }, PHASE.verify + 0.1)
      tl.to(status[1], { autoAlpha: 1, y: 0, duration: 0.015 }, PHASE.verify + 0.1)
      tl.to(status[1], { autoAlpha: 0, y: -10, duration: 0.015 }, PHASE.conflict + 0.09)
      tl.to(status[2], { autoAlpha: 1, y: 0, duration: 0.015 }, PHASE.conflict + 0.09)

      // The block. No flash: it arrives after the object has already stopped.
      gsap.set(blocked, { autoAlpha: 0, y: 8 })
      tl.to(blocked, { autoAlpha: 1, y: 0, duration: 0.03, ease: 'power2.out' }, PHASE.conflict + 0.095)

      // Consequence: the stage quiets under a veil; the money stays.
      gsap.set(veil, { autoAlpha: 0 })
      tl.to(veil, { autoAlpha: 0.72, duration: 0.05 }, PHASE.consequence)
      tl.to([aiChip, blocked], { autoAlpha: 0.35, duration: 0.05 }, PHASE.consequence)
      tl.to(nodeLabels, { autoAlpha: 0.25, duration: 0.05 }, PHASE.consequence)
    }, root)

    // The pin inserts a spacer the height of the whole story. Every trigger
    // created before this effect ran — all the sections below — measured the
    // page without it, and ScrollTrigger refreshes in creation order, so a
    // plain refresh would measure them again before the pin. Sort by document
    // position first; then refresh now, after layout settles, and on load.
    ScrollTrigger.sort()
    ScrollTrigger.refresh()
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => ScrollTrigger.refresh()))
    const onLoad = () => ScrollTrigger.refresh()
    window.addEventListener('load', onLoad)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('load', onLoad)
      ctx.revert()
    }
  }, [animate, use3d, stageReady, prefs.wide])

  // Static rendering: reduced motion, or before capabilities are known.
  useEffect(() => {
    if (animate) return
    stage.current?.setProgress(1)
  }, [animate, prefs.ready])

  const staticMode = prefs.ready && !prefs.motion

  const chapterBlocks = [
    // 0 — hero
    <div key="hero" data-chapter className="max-w-xl">
      <Badge variant="outline">Razorpay Buildathon · Track 04</Badge>
      <h1 className="mt-5 text-[40px] font-bold leading-[1.04] tracking-[-0.02em] sm:text-[56px] xl:text-[72px]">
        The agent said close it.
        <br />
        AVOS asked for proof.
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-[20px]">
        Razorpay-connected settlement control that independently verifies AI reconciliation before financial closure.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link href="/console" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
          Open console <IconArrowRight className="h-4 w-4" />
        </Link>
        <a href="#how" className="inline-flex h-11 items-center rounded-lg border border-border bg-card px-5 text-body font-medium transition-colors hover:bg-accent">
          See how it works
        </a>
      </div>
      <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="tnum text-[36px] font-bold leading-none tracking-tight sm:text-[44px]">{facts.amount}</span>
        <span className="inline-flex items-center gap-1.5 text-compact font-semibold text-[hsl(var(--verdict-failed))]">
          <IconCross className="h-3.5 w-3.5" /> Not closed · {facts.difference} {facts.reasonWord}
        </span>
      </div>
      <p className="mt-2 text-mini text-muted-foreground">
        Scroll to follow this settlement through AVOS. It is from the {facts.sourceLabel}, case {facts.caseId} — not a Razorpay transaction.
      </p>
    </div>,
    // 1 — ledger
    <Chapter key="ledger" n={1} title="Ledger" line="The settlement is normalised to integer paise and ISO time. Merchant notes are dropped at the door. Nothing is trusted yet.">
      <Fact k="Settlement" v={<Mono>{facts.settlementId}</Mono>} />
      <Fact k="Net amount" v={facts.amount} />
    </Chapter>,
    // 2 — proposal
    <Chapter key="proposal" n={2} title="AI proposal" line="A model reads the pack and proposes. It is a proposal — one layer on the settlement, not the decision.">
      <Fact k="Proposes" v={<span className="font-semibold">{facts.proposal}</span>} />
      <Fact k="Confidence" v={<span className="tnum">{facts.confidence}</span>} />
      <p className="mt-3 text-mini text-muted-foreground">The confidence score is recorded and shown. It is never an input to what follows.</p>
    </Chapter>,
    // 3 — evidence
    <Chapter key="evidence" n={3} title="Evidence" line={`${facts.evidenceRows} rows assemble around the settlement — source, amount, policy, timestamp — each hashed and labelled with where it came from.`}>
      <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-compact text-muted-foreground">
        {EVIDENCE_CHIPS.map((c) => (
          <li key={c}>· {c}</li>
        ))}
      </ul>
    </Chapter>,
    // 4 — verification
    <Chapter key="verify" n={4} title="Independent verification" line="The verifier recomputes the money from the evidence. It imports nothing: no model, no clock, no network.">
      <div className="mt-2 space-y-2">
        <div data-number className="flex items-baseline justify-between gap-4">
          <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">Expected</span>
          <span className="tnum text-[26px] font-bold leading-none sm:text-[30px]">{facts.expected}</span>
        </div>
        <div data-number className="flex items-baseline justify-between gap-4">
          <span className="text-micro font-semibold uppercase tracking-label text-muted-foreground">Observed</span>
          <span className="tnum text-[26px] font-bold leading-none sm:text-[30px]">{facts.observed}</span>
        </div>
        <div data-rule className="h-px w-full bg-foreground/30" />
        <div data-number className="flex items-baseline justify-between gap-4">
          <span className="text-micro font-semibold uppercase tracking-label text-[hsl(var(--verdict-failed))]">Difference</span>
          <span className="tnum text-[30px] font-bold leading-none text-[hsl(var(--verdict-failed))] sm:text-[36px]">+{facts.difference}</span>
        </div>
        <p className="text-mini text-muted-foreground">Tolerance under {facts.policy}: {facts.tolerance}.</p>
      </div>
    </Chapter>,
    // 5 — conflict
    <Chapter key="conflict" n={5} title="The evidence disagrees" line="The model said reconciled. The money says otherwise. The settlement reaches the close gate and is stopped there.">
      <Fact k="AI said" v={<span className="line-through decoration-muted-foreground/60">{facts.proposal} · {facts.confidence}</span>} />
      <Fact k="Evidence" v={<span className="text-[hsl(var(--verdict-failed))]">{facts.difference} {facts.reasonWord}</span>} />
      <Fact k="AVOS" v={<span className="font-semibold text-[hsl(var(--verdict-failed))]">FAILED · {facts.reasonCode}</span>} />
    </Chapter>,
    // 6 — consequence
    <div key="consequence" data-chapter className="max-w-xl">
      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">What this means</div>
      <div className="tnum mt-3 text-[52px] font-bold leading-none tracking-tight sm:text-[72px]">{facts.amount}</div>
      <div className="mt-3 inline-flex items-center gap-2 text-[22px] font-semibold text-[hsl(var(--verdict-failed))] sm:text-[26px]">
        <IconCross className="h-5 w-5" /> NOT CLOSED
      </div>
      <p className="mt-3 text-lg text-muted-foreground">
        <span className="tnum font-medium text-foreground">{facts.difference}</span> {facts.reasonWord}. The money is held because the evidence did not support closure — not because the model was unsure. It was 95% sure.
      </p>
    </div>,
  ]

  const stageEl = use3d ? (
    <ThreeStage amount={facts.amount} apiRef={stage} onReady={() => setStageReady(true)} />
  ) : (
    <SvgStage amount={facts.amount} apiRef={stage} />
  )

  // ---------------------------------------------------------------- static
  if (staticMode) {
    return (
      <section ref={root} className="border-b border-border bg-card" aria-label="One settlement through AVOS">
        <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 lg:px-8">
          <div className="relative h-[260px] sm:h-[320px]">{stageEl}</div>
          <ol className="mt-10 grid gap-10 lg:grid-cols-2">
            {chapterBlocks.map((b, i) => (
              <li key={i} className="[&_[data-chapter]]:max-w-none">{b}</li>
            ))}
          </ol>
        </div>
      </section>
    )
  }

  // ---------------------------------------------------------------- pinned
  return (
    <section ref={root} className="relative border-b border-border bg-card" aria-label="One settlement through AVOS">
      <div ref={pin} className="relative h-[100svh] overflow-hidden">
        <div aria-hidden className="grid-lines absolute inset-0 opacity-50" />
        <div className="relative mx-auto grid h-full max-w-[1280px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-4 pb-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:grid-rows-none lg:items-center lg:gap-10 lg:px-8 lg:py-0">
          {/* Chapter copy: stacked, one visible at a time. */}
          <div className="relative z-10 min-h-[240px] lg:min-h-[420px]">
            {chapterBlocks.map((b, i) => (
              <div key={i} className={cn('lg:absolute lg:inset-x-0 lg:top-1/2 lg:-translate-y-1/2', i > 0 && 'absolute inset-x-0 top-0 lg:top-1/2')}>
                {b}
              </div>
            ))}
          </div>

          {/* The stage and the layers that attach to it. */}
          <div ref={stageBox} className="relative h-[42svh] min-h-[220px] overflow-hidden lg:h-[64vh]">
            <div className="absolute inset-0">{stageEl}</div>
            <div data-layer="veil" aria-hidden className="pointer-events-none absolute inset-0 bg-card" />

            {use3d
              ? NODES.map((n, i) => (
                  <div
                    key={n}
                    data-node-label
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap text-micro font-semibold uppercase tracking-label text-muted-foreground"
                    style={{ willChange: 'transform' }}
                  >
                    {n}
                    {i === 5 ? <span className="ml-3 opacity-60">→ close</span> : null}
                  </div>
                ))
              : null}

            <div ref={layers} className="pointer-events-none absolute left-0 top-0 hidden lg:block" style={{ willChange: 'transform' }}>
              {/* AI layer, attached above the object. */}
              <div data-layer="ai" className="absolute -translate-y-[calc(100%+118px)] translate-x-[28px] rounded-lg border border-border bg-card/95 px-3 py-2 shadow-panel backdrop-blur">
                <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">AI proposal</div>
                <div className="relative mt-0.5 h-[22px] w-[150px] text-body font-semibold">
                  <span data-status className="absolute inset-0">
                    {facts.proposal} <span className="tnum font-normal text-muted-foreground">· {facts.confidence}</span>
                  </span>
                  <span data-status className="absolute inset-0 text-[hsl(var(--verdict-failed))]">
                    FEE MISMATCH
                  </span>
                  <span data-status className="absolute inset-0 text-[hsl(var(--verdict-failed))]">
                    NOT CLOSED
                  </span>
                </div>
              </div>
              {/* Evidence chips lock around the object. */}
              {EVIDENCE_CHIPS.map((c) => (
                <div key={c} data-chip className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-mini font-medium shadow-panel">
                  {c}
                </div>
              ))}
            </div>

            {/* The block, at the gate. */}
            <div data-layer="blocked" className="pointer-events-none absolute left-0 top-0 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-[hsl(var(--verdict-failed)/0.4)] bg-card px-3 py-1.5 text-compact font-semibold text-[hsl(var(--verdict-failed))] shadow-panel lg:block">
              <span className="inline-flex items-center gap-1.5">
                <IconCross className="h-3.5 w-3.5" /> FAILED · NOT CLOSED
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Chapter({ n, title, line, children }: { n: number; title: string; line: string; children?: React.ReactNode }) {
  return (
    <div data-chapter className="max-w-xl">
      <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
        {String(n).padStart(2, '0')} · {title}
      </div>
      <h2 className="mt-2 text-[28px] font-bold leading-[1.15] tracking-tight sm:text-[36px]">{title}</h2>
      <p className="mt-3 text-body leading-relaxed text-muted-foreground sm:text-lg">{line}</p>
      {children ? <div className="mt-4 border-t border-border pt-3">{children}</div> : null}
    </div>
  )
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-compact">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  )
}
