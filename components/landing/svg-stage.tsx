'use client'

import { useEffect, useRef } from 'react'
import { BLOCK_AT, NODES, travel, type Anchor, type NodeIndex, type StageApi } from './stage'

/**
 * The SVG stage: the same story as the WebGL one, drawn flat.
 *
 * Used below 1024px and whenever the reader prefers reduced motion — and it
 * is not a lesser version. The same six nodes, the same path, the same disc
 * carrying the same amount, the same gate it never passes. The path draws
 * with stroke-dashoffset and the disc rides it with getPointAtLength, which
 * is MotionPath by hand with no plugin and no per-frame layout.
 *
 * It also carries the labels that the WebGL stage leaves to HTML, because on
 * a phone the stage is the only wide element there is.
 */

const VB_W = 800
const VB_H = 260
const PATH_D =
  'M 60 130 C 120 60, 170 190, 230 130 S 340 70, 400 130 S 510 190, 570 130 S 660 90, 700 130 L 760 130'
const NODE_X = [60, 230, 400, 570, 640, 700]
const GATE_X = 760

export function SvgStage({ amount, apiRef }: { amount: string; apiRef: React.MutableRefObject<StageApi | null> }) {
  const svg = useRef<SVGSVGElement>(null)
  const pathEl = useRef<SVGPathElement>(null)
  const objEl = useRef<SVGGElement>(null)
  const rimEl = useRef<SVGCircleElement>(null)
  const gateEl = useRef<SVGGElement>(null)
  const ringEls = useRef<(SVGCircleElement | null)[]>([])
  const labelEls = useRef<(SVGTextElement | null)[]>([])

  useEffect(() => {
    const path = pathEl.current
    const s = svg.current
    if (!path || !s) return
    const total = path.getTotalLength()
    path.style.strokeDasharray = `${total}`
    // Arc-length at each node: nearest sample to the node's x.
    const lenAt = (x: number) => {
      let best = 0
      let bestD = Infinity
      for (let l = 0; l <= total; l += 4) {
        const pt = path.getPointAtLength(l)
        const d = Math.abs(pt.x - x)
        if (d < bestD) {
          bestD = d
          best = l
        }
      }
      return best
    }
    const stops = [...NODE_X, GATE_X].map(lenAt)
    let cur = { x: NODE_X[0], y: 130 }

    const toPx = (x: number, y: number): Anchor => {
      const r = s.getBoundingClientRect()
      return { x: (x / VB_W) * r.width, y: (y / VB_H) * r.height }
    }

    const setProgress = (p: number) => {
      const tr = travel(p)
      const l0 = stops[tr.segment]
      const l1 = stops[tr.segment + 1]
      const l = l0 + (l1 - l0) * tr.t
      const pt = path.getPointAtLength(l)
      cur = { x: pt.x, y: pt.y }
      objEl.current?.setAttribute('transform', `translate(${pt.x} ${pt.y})`)
      const drawTo = tr.blocked ? stops[5] + (stops[6] - stops[5]) * BLOCK_AT : Math.min(total, l + 40)
      path.style.strokeDashoffset = `${total - drawTo}`
      ringEls.current.forEach((r, i) => {
        if (!r) return
        const reached = tr.segment >= i
        r.setAttribute('stroke', i === 5 && tr.blocked ? '#c9203a' : reached ? '#2b6cf6' : '#a3aebf')
        labelEls.current[i]?.setAttribute('fill', i === 5 && tr.blocked ? '#c9203a' : reached ? '#102337' : '#8a97ab')
      })
      rimEl.current?.setAttribute('stroke', tr.blocked ? '#c9203a' : '#2b6cf6')
      gateEl.current?.setAttribute('stroke', tr.blocked ? '#c9203a' : tr.segment === 5 ? '#102337' : '#a3aebf')
    }

    apiRef.current = {
      setProgress,
      anchor: (target) => {
        if (target === 'object') return toPx(cur.x, cur.y)
        if (target === 'gate') return toPx(GATE_X, 130)
        return toPx(NODE_X[target as NodeIndex], 130)
      },
      dispose: () => {
        apiRef.current = null
      },
    }
    setProgress(0)
    return () => {
      apiRef.current = null
    }
  }, [apiRef])

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="h-full w-full"
      role="img"
      aria-label={`${amount} moves from Razorpay through the ledger, AI proposal, evidence, policy and verifier toward closure, and is stopped at the verifier.`}
    >
      <path ref={pathEl} d={PATH_D} fill="none" stroke="#102337" strokeOpacity="0.22" strokeWidth="1.5" />
      {NODE_X.map((x, i) => (
        <g key={NODES[i]}>
          <circle ref={(e) => { ringEls.current[i] = e }} cx={x} cy={130} r={13} fill="#fff" stroke="#a3aebf" strokeWidth="2" />
          <text
            ref={(e) => { labelEls.current[i] = e }}
            x={x}
            y={i % 2 === 0 ? 176 : 96}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#8a97ab"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.06em"
          >
            {NODES[i].toUpperCase()}
          </text>
        </g>
      ))}
      <g ref={gateEl} stroke="#a3aebf" strokeWidth="2.5" fill="none" strokeLinecap="round">
        <path d={`M ${GATE_X} 95 L ${GATE_X} 165`} />
        <path d={`M ${GATE_X - 8} 95 L ${GATE_X + 8} 95`} />
        <path d={`M ${GATE_X - 8} 165 L ${GATE_X + 8} 165`} />
      </g>
      <text x={GATE_X} y={190} textAnchor="middle" fontSize="11" fontWeight="600" fill="#8a97ab" fontFamily="system-ui, sans-serif" letterSpacing="0.06em">
        CLOSE
      </text>
      <g ref={objEl} transform={`translate(${NODE_X[0]} 130)`}>
        <ellipse cx="0" cy="24" rx="30" ry="5" fill="#102337" fillOpacity="0.08" />
        <circle ref={rimEl} r="29" fill="#ffffff" stroke="#2b6cf6" strokeWidth="2.5" />
        <text y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#102337" fontFamily="system-ui, sans-serif">
          {amount}
        </text>
      </g>
    </svg>
  )
}
