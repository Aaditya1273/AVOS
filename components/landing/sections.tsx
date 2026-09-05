'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { IconArrowRight, IconCross } from '@/components/ui/icon'
import { Mono } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/**
 * The sections after the pinned story. Each keeps the same object, the same
 * grammar and the same rule: motion only where it says something about
 * money, evidence, verification or closure, and every fact present as plain
 * HTML whether or not anything moves.
 */

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---------------------------------------------------------------------------
// Why AVOS — three statements, one argument, scrubbed
// ---------------------------------------------------------------------------

export function WhyAvos() {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!root.current || reducedMotion()) return
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      const lines = gsap.utils.toArray<HTMLElement>('[data-line]')
      const bar = root.current!.querySelector<HTMLElement>('[data-bar]')
      gsap.set(lines, { autoAlpha: 0.18, y: 10 })
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: root.current, start: 'top 70%', end: 'bottom 60%', scrub: 0.4 },
      })
      lines.forEach((l, i) => {
        tl.to(l, { autoAlpha: 1, y: 0, duration: 0.25, ease: 'power2.out' }, i * 0.3)
        if (i < lines.length - 1) tl.to(l, { autoAlpha: 0.45, duration: 0.2 }, (i + 1) * 0.3 + 0.05)
      })
      if (bar) tl.fromTo(bar, { scaleY: 0, transformOrigin: 'top' }, { scaleY: 1, duration: 0.95 }, 0)
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={root} className="border-b border-border bg-background" aria-labelledby="why-title">
      <div className="mx-auto grid max-w-[1100px] gap-8 px-4 py-24 sm:px-6 lg:grid-cols-[1px_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:py-32">
        <div className="hidden lg:block">
          <div data-bar className="h-full w-px bg-primary" />
        </div>
        <div>
          <h2 id="why-title" className="sr-only">Why AVOS exists</h2>
          <p data-line className="text-[36px] font-bold leading-[1.1] tracking-tight sm:text-[52px]">AI can reason.</p>
          <p data-line className="mt-6 text-[36px] font-bold leading-[1.1] tracking-tight sm:text-[52px]">AI can be wrong.</p>
          <p data-line className="mt-6 text-[36px] font-bold leading-[1.1] tracking-tight text-primary sm:text-[52px]">
            Financial closure requires proof.
          </p>
          <p className="mt-10 max-w-2xl text-lg text-muted-foreground">
            So the model proposes, the evidence is recomputed by code that has no model in it, and AVOS decides. Confidence is
            recorded. It is never an input.
          </p>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Razorpay flow — a drawn path from Razorpay into AVOS, around the live block
// ---------------------------------------------------------------------------

export function RazorpayFlow({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!root.current) return
    const path = root.current.querySelector<SVGPathElement>('[data-flow]')
    if (!path) return
    const total = path.getTotalLength()
    path.style.strokeDasharray = `${total}`
    if (reducedMotion()) {
      path.style.strokeDashoffset = '0'
      return
    }
    path.style.strokeDashoffset = `${total}`
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      gsap.to(path, {
        strokeDashoffset: 0,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top 75%', end: 'top 20%', scrub: 0.4 },
      })
      gsap.utils.toArray<HTMLElement>('[data-flow-node]').forEach((n, i) => {
        gsap.fromTo(
          n,
          { autoAlpha: 0.3 },
          { autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: root.current, start: `top ${72 - i * 12}%`, end: `top ${60 - i * 12}%`, scrub: 0.4 } },
        )
      })
    }, root)
    return () => ctx.revert()
  }, [])

  const nodes = ['Razorpay', 'AVOS Ledger', 'Evidence', 'Verification']
  return (
    <section ref={root} className="border-b border-border bg-card" aria-labelledby="rzp-title">
      <div className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <h2 id="rzp-title" className="text-[32px] font-bold tracking-tight sm:text-[44px]">Connected to Razorpay. Read-only.</h2>
        <p className="mt-3 max-w-2xl text-body text-muted-foreground sm:text-lg">
          Four GET endpoints, read on every sync. The block below asks the API from the server when it comes into view and shows
          exactly what came back. It is never pre-rendered as connected.
        </p>

        <div className="relative mt-10">
          <svg viewBox="0 0 1000 120" className="h-[90px] w-full sm:h-[120px]" aria-hidden>
            <path data-flow d="M 60 60 C 200 60, 220 20, 340 20 S 480 100, 620 100 S 780 60, 940 60" fill="none" stroke="#2b6cf6" strokeWidth="2" />
            {[60, 340, 620, 940].map((x, i) => (
              <g key={x} data-flow-node>
                <circle cx={x} cy={i === 1 ? 20 : i === 2 ? 100 : 60} r="8" fill="#fff" stroke="#2b6cf6" strokeWidth="2" />
              </g>
            ))}
          </svg>
          <ol className="mt-1 grid grid-cols-4 text-center text-micro font-semibold uppercase tracking-label text-muted-foreground sm:text-mini">
            {nodes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </div>

        <div className="mt-8">{children}</div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Evidence sheets — the record, as documents that stack and are stamped
// ---------------------------------------------------------------------------

export interface Sheet {
  title: string
  rows: [string, string][]
}

export function EvidenceSheets({ sheets, verdict, technical }: { sheets: Sheet[]; verdict: string; technical: [string, string][] }) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!root.current || reducedMotion()) return
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      const items = gsap.utils.toArray<HTMLElement>('[data-sheet]')
      const stamp = root.current!.querySelector<HTMLElement>('[data-stamp]')
      // Spread, then gather into one stack; the stamp lands last.
      items.forEach((el, i) => {
        const spread = window.innerWidth < 640 ? 8 : 22
        gsap.set(el, { x: (i - 2) * spread, y: 40 + i * 6, rotate: (i - 2) * 2, autoAlpha: 0.6 })
      })
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: root.current, start: 'top 70%', end: 'center 45%', scrub: 0.5 },
      })
      items.forEach((el, i) => {
        tl.to(el, { x: 0, y: i * 10, rotate: 0, autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, i * 0.08)
      })
      if (stamp) {
        gsap.set(stamp, { autoAlpha: 0, scale: 1.25, rotate: -6 })
        tl.to(stamp, { autoAlpha: 1, scale: 1, rotate: -4, duration: 0.25, ease: 'power3.out' }, 0.85)
      }
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={root} className="overflow-hidden border-b border-border bg-background" aria-labelledby="ev-title">
      <div className="mx-auto grid max-w-[1100px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:px-8 lg:py-28">
        <div>
          <h2 id="ev-title" className="text-[32px] font-bold tracking-tight sm:text-[44px]">Evidence, not confidence</h2>
          <p className="mt-3 text-body text-muted-foreground sm:text-lg">
            The record a reviewer can open: source, policy, timestamps, verifier. It assembles from separate sources and is
            stamped once, by code — the same way the console shows it.
          </p>
          <details className="group mt-6 rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-body font-medium [&::-webkit-details-marker]:hidden">
              View technical details
              <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
                <IconArrowRight className="h-4 w-4" />
              </span>
            </summary>
            <dl className="divide-y divide-border border-t border-border text-compact">
              {technical.map(([k, v]) => (
                <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-all font-mono text-mini">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>

        <div className="relative mx-auto w-full max-w-[520px] pt-6" style={{ minHeight: 320 + sheets.length * 10 }}>
          {sheets.map((s, i) => (
            <div
              key={s.title}
              data-sheet
              className="absolute inset-x-0 top-0 rounded-lg border border-border bg-card p-4 shadow-raised"
              style={{ zIndex: i + 1 }}
            >
              <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">{s.title}</div>
              <dl className="mt-2 divide-y divide-border">
                {s.rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 py-1.5 text-compact">
                    <dt className="shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="tnum min-w-0 break-words text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <div
            data-stamp
            className="pointer-events-none absolute -right-2 top-2 rounded-md border-2 border-[hsl(var(--verdict-failed))] px-3 py-1 text-[18px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--verdict-failed))]"
            style={{ zIndex: sheets.length + 2 }}
            aria-hidden
          >
            {verdict}
          </div>
          <p className="sr-only">Verdict: {verdict}</p>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Evaluation — restrained count-ups, labelled as evaluation
// ---------------------------------------------------------------------------

export interface EvalStat {
  value: string
  label: string
  hint: string
  tone?: 'verified'
}

export function EvalNumbers({ stats, n, footer }: { stats: EvalStat[]; n: number; footer: React.ReactNode }) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!root.current || reducedMotion()) return
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
        const finalText = el.dataset.count ?? el.textContent ?? ''
        const num = parseFloat(finalText.replace(/[^0-9.]/g, ''))
        if (!Number.isFinite(num)) return
        const suffix = finalText.replace(/^[0-9.]+/, '')
        const obj = { v: 0 }
        gsap.to(obj, {
          v: num,
          duration: 1.1,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
          onUpdate: () => {
            el.textContent = `${Math.round(obj.v)}${suffix}`
          },
          onComplete: () => {
            el.textContent = finalText
          },
        })
      })
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={root} className="border-b border-border bg-card" aria-labelledby="eval-title">
      <div className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="eval-title" className="text-[32px] font-bold tracking-tight sm:text-[44px]">AVOS Evaluation</h2>
          <span className="text-compact text-muted-foreground">{n} labelled synthetic settlements · not Razorpay transactions</span>
        </div>
        <dl className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label}>
              <dd
                data-count={s.value}
                className={cn('tnum text-[36px] font-bold leading-none tracking-tight', s.tone === 'verified' && 'text-[hsl(var(--verdict-verified))]')}
              >
                {s.value}
              </dd>
              <dt className="mt-2 text-compact font-medium">{s.label}</dt>
              <dd className="mt-0.5 text-mini text-muted-foreground">{s.hint}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10 text-mini text-muted-foreground">{footer}</div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Finale — the object returns and settles; the argument closes
// ---------------------------------------------------------------------------

export function Finale({ amount, difference, reasonWord }: { amount: string; difference: string; reasonWord: string }) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!root.current || reducedMotion()) return
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      const disc = root.current!.querySelector<SVGGElement>('[data-disc]')
      const path = root.current!.querySelector<SVGPathElement>('[data-settle]')
      const lines = gsap.utils.toArray<HTMLElement>('[data-final-line]')
      if (!disc || !path) return
      const total = path.getTotalLength()
      path.style.strokeDasharray = `${total}`
      path.style.strokeDashoffset = `${total}`
      gsap.set(lines, { autoAlpha: 0, y: 12 })
      const state = { l: 0 }
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: root.current, start: 'top 75%', end: 'top 15%', scrub: 0.5 },
      })
      tl.to(state, {
        l: total,
        duration: 0.7,
        ease: 'power2.inOut',
        onUpdate: () => {
          const pt = path.getPointAtLength(state.l)
          disc.setAttribute('transform', `translate(${pt.x} ${pt.y})`)
          path.style.strokeDashoffset = `${total - state.l}`
        },
      })
      lines.forEach((l, i) => tl.to(l, { autoAlpha: 1, y: 0, duration: 0.12, ease: 'power2.out' }, 0.45 + i * 0.14))
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={root} className="bg-background" aria-labelledby="final-title">
      <div className="mx-auto max-w-[1100px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative">
            <svg viewBox="0 0 520 240" className="w-full" role="img" aria-label={`${amount} settles into its final state: not closed, ${difference} ${reasonWord}.`}>
              <path data-settle d="M 40 200 C 140 200, 180 60, 300 60 S 440 120, 460 120" fill="none" stroke="#102337" strokeOpacity="0.22" strokeWidth="1.5" />
              <g transform="translate(460 120)" stroke="#c9203a" strokeWidth="2.5" fill="none" strokeLinecap="round">
                <path d="M 26 -40 L 26 40 M 18 -40 L 34 -40 M 18 40 L 34 40" />
              </g>
              <g data-disc transform="translate(40 200)">
                <ellipse cy="26" rx="34" ry="6" fill="#102337" fillOpacity="0.08" />
                <circle r="33" fill="#fff" stroke="#c9203a" strokeWidth="2.5" />
                <text y="4" textAnchor="middle" fontSize="12" fontWeight="700" fill="#102337" fontFamily="system-ui, sans-serif">
                  {amount}
                </text>
              </g>
            </svg>
            <div className="mt-2 flex items-center gap-2 text-compact text-[hsl(var(--verdict-failed))]">
              <IconCross className="h-4 w-4" /> Not closed · <span className="tnum">{difference}</span> {reasonWord}
            </div>
          </div>
          <div>
            <h2 id="final-title" className="sr-only">Conclusion</h2>
            <p data-final-line className="text-[30px] font-bold leading-[1.12] tracking-tight sm:text-[40px]">AI can propose.</p>
            <p data-final-line className="mt-2 text-[30px] font-bold leading-[1.12] tracking-tight sm:text-[40px]">Evidence must prove.</p>
            <p data-final-line className="mt-2 text-[30px] font-bold leading-[1.12] tracking-tight text-primary sm:text-[40px]">AVOS decides.</p>
            <p data-final-line className="mt-8 text-xl text-muted-foreground">Before money closes, prove it.</p>
            <div data-final-line className="mt-8">
              <Link href="/console" className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                Open console <IconArrowRight className="h-4 w-4" />
              </Link>
              <p className="mt-3 text-mini text-muted-foreground">
                Razorpay-connected. Evidence-backed. Independently verified. · <Mono>read-only</Mono>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
