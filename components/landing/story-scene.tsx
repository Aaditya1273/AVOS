'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The hero's one visual object: a settlement moving through the six stages of
 * AVOS, and stopping.
 *
 * Six nodes on a shallow curve — Razorpay, Ledger, AI proposal, Evidence,
 * Verifier, Closure. A disc carrying the settlement's amount travels along the
 * curve as the reader scrolls. It never reaches the sixth node: at the verifier
 * it stops and turns red, because that is what happened to this settlement.
 * Movement completing would mean VERIFIED; pausing, UNCERTAIN; stopping, FAILED.
 * The motion is the meaning, and the meaning is also written in text beside it
 * so nothing depends on the canvas.
 *
 * Restraint is the whole design: seven meshes, one line, two lights, no
 * post-processing, no textures beyond a 512×128 canvas for the amount, DPR
 * capped at 1.5, and a render only when scroll progress changes — the page is
 * idle when the reader is. Three.js is loaded lazily and only where it earns
 * its weight: ≥1024px, WebGL present, and no reduced-motion preference. Every
 * other case gets the same story as a static SVG.
 */

export interface StoryChapter {
  /** Scroll progress at which this chapter takes over, 0–1. */
  at: number
  label: string
  line: string
  state?: 'ok' | 'stop'
}

export interface StorySceneProps {
  amount: string
  chapters: StoryChapter[]
  /** Fraction of the path the object reaches before it stops. */
  stopAt: number
  className?: string
  /** The hero copy. Rendered inside the pinned area so it stays put while the scene plays. */
  children?: React.ReactNode
}

// --- scroll progress ---------------------------------------------------------

function useScrollProgress(target: React.RefObject<HTMLElement>) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const el = target.current
    if (!el) return
    let raf = 0
    const read = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const span = r.height - window.innerHeight
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, -r.top / span))
      setProgress((prev) => (Math.abs(prev - p) < 0.002 ? prev : p))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // The wrapper grows from a single viewport to 240vh once capabilities
    // resolve; without this the progress read before that growth (1, because
    // the span was zero) would stand until the first scroll.
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [target])
  return progress
}

function useCapabilities() {
  const [caps, setCaps] = useState<{ ready: boolean; webgl: boolean; wide: boolean; motion: boolean }>({
    ready: false,
    webgl: false,
    wide: false,
    motion: false,
  })
  useEffect(() => {
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wide = window.innerWidth >= 1024
    let webgl = false
    try {
      const c = document.createElement('canvas')
      webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'))
    } catch {
      webgl = false
    }
    setCaps({ ready: true, webgl, wide, motion })
  }, [])
  return caps
}

// --- the scene -----------------------------------------------------------------

const NAVY = 0x102337
const BLUE = 0x2b6cf6
const RED = 0xc9203a
const MUTED = 0x9aa7bb

function ThreeScene({ amount, progress, stopAt }: { amount: string; progress: number; stopAt: number }) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ setProgress: (p: number) => void; dispose: () => void } | null>(null)
  // Always the latest value. The scene is built after an async import and
  // must read this, not the `progress` its closure captured when the effect
  // ran — updates that arrive before the scene exists would otherwise be lost.
  const latest = useRef(progress)
  latest.current = progress

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false

    void import('three').then((THREE) => {
      if (cancelled || !el) return

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setClearColor(0x000000, 0)
      el.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
      camera.position.set(0, 2.4, 13.5)
      camera.lookAt(0, 0, 0)

      scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe6f2, 1.1))
      const key = new THREE.DirectionalLight(0xffffff, 0.9)
      key.position.set(3, 6, 5)
      scene.add(key)

      // Six stages on a shallow S-curve, receding slightly for depth.
      const pts = [
        new THREE.Vector3(-3.0, 0.15, -0.5),
        new THREE.Vector3(-1.8, -0.12, 0.2),
        new THREE.Vector3(-0.6, 0.2, -0.3),
        new THREE.Vector3(0.6, -0.1, 0.3),
        new THREE.Vector3(1.8, 0.15, -0.2),
        new THREE.Vector3(3.0, -0.12, 0.4),
      ]
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.6)

      const pathGeom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120))
      const pathMat = new THREE.LineBasicMaterial({ color: NAVY, transparent: true, opacity: 0.18 })
      scene.add(new THREE.Line(pathGeom, pathMat))

      const ringGeom = new THREE.TorusGeometry(0.26, 0.02, 12, 48)
      const nodes = pts.map((p) => {
        const m = new THREE.MeshStandardMaterial({ color: MUTED, roughness: 0.6, metalness: 0.05 })
        const ring = new THREE.Mesh(ringGeom, m)
        ring.position.copy(p)
        ring.rotation.x = Math.PI / 2
        scene.add(ring)
        return ring
      })

      // The settlement: a thin disc with the amount printed on top.
      const discGeom = new THREE.CylinderGeometry(0.52, 0.52, 0.06, 56)
      const discMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.08 })
      const disc = new THREE.Mesh(discGeom, discMat)
      const rimGeom = new THREE.TorusGeometry(0.52, 0.026, 12, 64)
      const rimMat = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.4, metalness: 0.1 })
      const rim = new THREE.Mesh(rimGeom, rimMat)
      rim.rotation.x = Math.PI / 2
      rim.position.y = 0.035

      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 128
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, 512, 128)
        ctx.fillStyle = '#102337'
        ctx.font = '600 56px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(amount, 256, 66)
      }
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.325),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }),
      )
      label.rotation.x = -Math.PI / 2
      label.position.y = 0.045
      const coin = new THREE.Group()
      coin.add(disc, rim, label)
      scene.add(coin)

      // A ground-plane shadow stand-in: one soft ring under the coin.
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.6, 40),
        new THREE.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 0.07 }),
      )
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = -0.12
      scene.add(shadow)

      const resize = () => {
        const w = el.clientWidth || 1
        const h = el.clientHeight || 1
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      resize()
      const ro = new ResizeObserver(() => {
        resize()
        render()
      })
      ro.observe(el)

      let current = -1
      const tmp = new THREE.Vector3()
      const setProgress = (p: number) => {
        if (Math.abs(p - current) < 0.001) return
        current = p
        const t = Math.min(stopAt, p * stopAt * (1 / stopAt)) // clamp to stopAt
        const at = Math.min(t, stopAt)
        curve.getPoint(at, tmp)
        coin.position.set(tmp.x, tmp.y + 0.14, tmp.z)
        shadow.position.set(tmp.x, tmp.y - 0.12, tmp.z)
        coin.rotation.y = at * Math.PI * 1.2
        const stopped = p >= stopAt - 0.02
        rimMat.color.setHex(stopped ? RED : BLUE)
        nodes.forEach((n, i) => {
          const nodeT = i / (pts.length - 1)
          const mat = n.material as InstanceType<typeof THREE.MeshStandardMaterial>
          if (i === 4 && stopped) mat.color.setHex(RED)
          else mat.color.setHex(nodeT <= at + 0.01 ? BLUE : MUTED)
        })
        // Parallax: the camera drifts a little with the reader. Nothing more.
        camera.position.x = -0.2 + p * 0.5
        camera.lookAt(tmp.x * 0.15, 0, 0)
        render()
      }
      const render = () => renderer.render(scene, camera)
      setProgress(latest.current)

      api.current = {
        setProgress,
        dispose: () => {
          ro.disconnect()
          ;[pathGeom, ringGeom, discGeom, rimGeom, label.geometry, shadow.geometry].forEach((g) => g.dispose())
          ;[pathMat, discMat, rimMat, shadow.material, label.material].forEach((m) => (m as { dispose: () => void }).dispose())
          nodes.forEach((n) => (n.material as { dispose: () => void }).dispose())
          ;(label.material as { map?: { dispose: () => void } }).map?.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        },
      }
    })

    return () => {
      cancelled = true
      api.current?.dispose()
      api.current = null
    }
    // The scene is built once; progress is pushed through the ref below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, stopAt])

  useEffect(() => {
    api.current?.setProgress(progress)
  }, [progress])

  return <div ref={host} className="absolute inset-0" aria-hidden />
}

// --- static fallback ---------------------------------------------------------------

function StaticScene({ amount, stopAt }: { amount: string; stopAt: number }) {
  const nodes = [
    ['Razorpay', 40],
    ['Ledger', 156],
    ['AI proposal', 272],
    ['Evidence', 388],
    ['Verifier', 504],
    ['Closure', 620],
  ] as const
  const stopIndex = Math.round(stopAt * (nodes.length - 1))
  return (
    <svg viewBox="0 0 660 220" className="h-full w-full" role="img" aria-label={`${amount} moved through the pipeline and stopped at the verifier; it was not closed.`}>
      <path d="M40 120 C 100 100, 130 140, 156 120 S 240 100, 272 120 S 356 140, 388 120 S 472 100, 504 120 S 588 140, 620 120" fill="none" stroke="#102337" strokeOpacity="0.18" strokeWidth="1.5" />
      {nodes.map(([name, x], i) => {
        const done = i <= stopIndex
        const stop = i === stopIndex
        return (
          <g key={name}>
            <circle cx={x} cy={120} r={14} fill="none" stroke={stop ? '#c9203a' : done ? '#2b6cf6' : '#9aa7bb'} strokeWidth="2" />
            <text x={x} y={165} textAnchor="middle" fontSize="12" fill="#5c6b84" fontFamily="system-ui, sans-serif">
              {name}
            </text>
          </g>
        )
      })}
      <g transform={`translate(${nodes[stopIndex][1]} 120)`}>
        <ellipse cx="0" cy="26" rx="30" ry="6" fill="#102337" fillOpacity="0.08" />
        <circle r="30" fill="#ffffff" stroke="#c9203a" strokeWidth="2.5" />
        <text y="4" textAnchor="middle" fontSize="11" fontWeight="600" fill="#102337" fontFamily="system-ui, sans-serif">
          {amount}
        </text>
      </g>
    </svg>
  )
}

// --- the composed story --------------------------------------------------------------

export function StoryScene({ amount, chapters, stopAt, className, children }: StorySceneProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const progress = useScrollProgress(wrapper)
  const caps = useCapabilities()
  const use3d = caps.ready && caps.webgl && caps.wide && caps.motion
  const chapter = [...chapters].reverse().find((c) => progress >= c.at) ?? chapters[0]
  const stopped = progress >= stopAt - 0.02

  return (
    <div ref={wrapper} className={cn('relative', use3d ? 'min-h-[200vh]' : '', className)}>
      <div className={cn(use3d ? 'sticky top-14 h-[calc(100vh-3.5rem)]' : 'relative')}>
        {/* Background: a faint structural grid, moving slower than the object. */}
        <div
          aria-hidden
          className="grid-lines absolute inset-0 opacity-60"
          style={use3d ? { transform: `translateY(${progress * -24}px)` } : undefined}
        />
        <div className="relative mx-auto grid h-full max-w-[1280px] items-center gap-6 px-4 pb-6 pt-10 sm:px-6 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:gap-8 lg:px-8 lg:py-0">
          <div className="relative z-10">{children}</div>

          <div className={cn('relative', use3d ? 'h-[70vh]' : 'h-[230px] sm:h-[300px]')}>
            <div className="absolute inset-0">
              {use3d ? <ThreeScene amount={amount} progress={progress} stopAt={stopAt} /> : <StaticScene amount={amount} stopAt={stopAt} />}
            </div>
            {use3d ? (
              <ol
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-[62%] grid grid-cols-6 px-6 text-center text-micro font-medium uppercase tracking-label text-muted-foreground"
              >
                {['Razorpay', 'Ledger', 'AI proposal', 'Evidence', 'Verifier', 'Closure'].map((n, i) => (
                  <li key={n} className={cn(i === 4 && stopped && 'text-[hsl(var(--verdict-failed))]', i === 5 && 'opacity-50')}>
                    {n}
                  </li>
                ))}
              </ol>
            ) : null}
            {/* Chapter caption: the meaning in words, whatever the canvas does. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-2">
              <div
                className={cn(
                  'max-w-md rounded-lg border bg-card/95 px-4 py-2.5 text-center shadow-panel backdrop-blur transition-colors',
                  stopped || !use3d ? 'border-[hsl(var(--verdict-failed)/0.4)]' : 'border-border',
                )}
                aria-live="polite"
              >
                <div className="text-micro font-semibold uppercase tracking-label text-muted-foreground">
                  {use3d ? chapter.label : 'Decision'}
                </div>
                <div
                  className={cn(
                    'mt-0.5 text-compact font-medium',
                    (use3d ? chapter.state === 'stop' : true) && 'text-[hsl(var(--verdict-failed))]',
                  )}
                >
                  {use3d ? chapter.line : chapters[chapters.length - 1]?.line}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
