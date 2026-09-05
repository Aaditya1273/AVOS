'use client'

import { useEffect, useRef } from 'react'
import { BLOCK_AT, travel, type Anchor, type NodeIndex, type StageApi } from './stage'

/**
 * The WebGL stage: one settlement moving through six nodes toward a gate.
 *
 * Everything on it is a financial state, not decoration. Six thin rings are
 * the stages the settlement passes through. A disc is the settlement, carrying
 * its amount. A thin frame past the verifier is the close gate — the thing
 * the disc approaches and, for this settlement, never passes. The path draws
 * itself ahead of the disc (drawRange on one line geometry), which is cheaper
 * and more honest than an overlay: the path a reader sees is the path the
 * object is on.
 *
 * Budget: 6 rings + disc + rim + label + shadow + gate (3 boxes) + 1 line,
 * two lights, no post-processing, one 512×128 canvas texture, DPR ≤ 1.5, and
 * a render only when progress changes. Disposed on unmount.
 */

const NAVY = 0x102337
const BLUE = 0x2b6cf6
const RED = 0xc9203a
const MUTED = 0xa3aebf

export function ThreeStage({
  amount,
  apiRef,
  onReady,
}: {
  amount: string
  apiRef: React.MutableRefObject<StageApi | null>
  onReady?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false

    void import('three').then((THREE) => {
      if (cancelled) return

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setClearColor(0x000000, 0)
      el.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
      scene.add(new THREE.HemisphereLight(0xffffff, 0xdde4ee, 1.15))
      const key = new THREE.DirectionalLight(0xffffff, 0.8)
      key.position.set(3, 6, 5)
      scene.add(key)

      // Six stages and a gate, on a shallow S-curve receding for depth.
      // The path rises and falls: a journey with height, not a line. Ledger
      // and Evidence sit high (things are added), the verifier sits low (things
      // are checked), the gate is level.
      const nodePts = [
        new THREE.Vector3(-3.6, -0.55, -0.4),
        new THREE.Vector3(-2.2, 0.55, 0.2),
        new THREE.Vector3(-0.8, -0.25, -0.3),
        new THREE.Vector3(0.6, 0.7, 0.3),
        new THREE.Vector3(1.9, -0.45, -0.2),
        new THREE.Vector3(3.1, 0.15, 0.3),
      ]
      const gatePt = new THREE.Vector3(4.4, 0.15, 0)
      const allPts = [...nodePts, gatePt]
      const curve = new THREE.CatmullRomCurve3(allPts, false, 'centripetal', 0.6)
      const SAMPLES = 240
      const pathPts = curve.getPoints(SAMPLES)
      const pathGeom = new THREE.BufferGeometry().setFromPoints(pathPts)
      const pathMat = new THREE.LineBasicMaterial({ color: NAVY, transparent: true, opacity: 0.22 })
      const path = new THREE.Line(pathGeom, pathMat)
      pathGeom.setDrawRange(0, 2)
      scene.add(path)

      const ringGeom = new THREE.TorusGeometry(0.26, 0.02, 12, 48)
      const rings = nodePts.map((p) => {
        const m = new THREE.MeshStandardMaterial({ color: MUTED, roughness: 0.6, metalness: 0.05 })
        const ring = new THREE.Mesh(ringGeom, m)
        ring.position.copy(p)
        ring.rotation.x = Math.PI / 2
        scene.add(ring)
        return ring
      })

      // The close gate: a thin frame the object must pass through to close.
      const gateMat = new THREE.MeshStandardMaterial({ color: MUTED, roughness: 0.6, metalness: 0.05 })
      const post = new THREE.BoxGeometry(0.035, 1.15, 0.035)
      const bar = new THREE.BoxGeometry(0.035, 0.035, 1.1)
      const gate = new THREE.Group()
      const left = new THREE.Mesh(post, gateMat)
      const right = new THREE.Mesh(post, gateMat)
      const top = new THREE.Mesh(bar, gateMat)
      left.position.set(0, 0.55, -0.5)
      right.position.set(0, 0.55, 0.5)
      top.position.set(0, 1.1, 0)
      gate.add(left, right, top)
      gate.position.copy(gatePt)
      // Turned a little toward the camera, so a frame reads as a frame rather
      // than collapsing edge-on into one post.
      gate.rotation.y = -0.55
      scene.add(gate)

      // The settlement.
      const discGeom = new THREE.CylinderGeometry(0.66, 0.66, 0.07, 64)
      const discMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.08 })
      const disc = new THREE.Mesh(discGeom, discMat)
      const rimGeom = new THREE.TorusGeometry(0.66, 0.03, 12, 72)
      const rimMat = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.4, metalness: 0.1 })
      const rim = new THREE.Mesh(rimGeom, rimMat)
      rim.rotation.x = Math.PI / 2
      rim.position.y = 0.032
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 128
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#102337'
        ctx.font = '700 64px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(amount, 256, 66)
      }
      const labelTex = new THREE.CanvasTexture(canvas)
      const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), labelMat)
      // The label is its own object, so it can step clear of the gate at the
      // block instead of swinging with the disc's turn.
      const object = new THREE.Group()
      object.add(disc, rim)
      scene.add(object)
      scene.add(label)
      const shadowMat = new THREE.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 0.07 })
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.76, 48), shadowMat)
      shadow.rotation.x = -Math.PI / 2
      scene.add(shadow)

      // Segment boundaries along the curve, as arc-length fractions, so the
      // object's travel maps onto the same path the line draws.
      const segU = allPts.map((p) => {
        let best = 0
        let bestD = Infinity
        for (let i = 0; i <= SAMPLES; i++) {
          const d = pathPts[i].distanceToSquared(p)
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
        return best / SAMPLES
      })

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
        setProgress(current, true)
      })
      ro.observe(el)

      let current = 0
      const tmp = new THREE.Vector3()
      const objPos = new THREE.Vector3()
      const render = () => renderer.render(scene, camera)

      const setProgress = (p: number, force = false) => {
        if (!force && Math.abs(p - current) < 0.0008) return
        current = p
        const tr = travel(p)
        const u0 = segU[tr.segment]
        const u1 = segU[tr.segment + 1]
        const u = u0 + (u1 - u0) * tr.t
        curve.getPointAt(u, tmp)
        objPos.copy(tmp)
        object.position.set(tmp.x, tmp.y + 0.14, tmp.z)
        shadow.position.set(tmp.x, tmp.y - 0.1, tmp.z)
        object.rotation.y = u * Math.PI * 1.4
        // The label faces the reader, and steps left of the gate once blocked
        // so the amount is never hidden behind the frame that stopped it.
        label.position.set(tmp.x + (tr.blocked ? -0.95 : 0), tmp.y + 0.86, tmp.z)
        label.lookAt(camera.position)

        // The path draws just ahead of the object, and the last stretch to the
        // gate is never completed for this settlement: at the block it breaks.
        const drawTo = tr.blocked ? segU[5] + (segU[6] - segU[5]) * BLOCK_AT : Math.min(1, u + 0.06)
        pathGeom.setDrawRange(0, Math.max(2, Math.floor(drawTo * SAMPLES)))
        pathMat.opacity = tr.blocked ? 0.16 : 0.22

        rings.forEach((r, i) => {
          const m = r.material as InstanceType<typeof THREE.MeshStandardMaterial>
          const reached = tr.segment > i || (tr.segment === i && tr.t < 0.05) || tr.segment >= i
          m.color.setHex(reached ? BLUE : MUTED)
          if (i === 5 && tr.blocked) m.color.setHex(RED)
        })
        rimMat.color.setHex(tr.blocked ? RED : BLUE)
        gateMat.color.setHex(tr.blocked ? RED : MUTED)

        // Camera: follows the settlement closely, so the object is large and
        // its progress reads as travel, with a gentle push-in at the conflict.
        // Nothing that would move the reader's stomach: one axis of drift, one
        // slow dolly, no roll.
        const push = tr.segment === 5 ? tr.t / BLOCK_AT : 0
        const lead = tr.segment === 5 ? 0.9 : 0.45
        camera.position.set(objPos.x * 0.82 + lead, objPos.y * 0.5 + 1.4 - push * 0.3, 8.4 - push * 1.2)
        camera.lookAt(objPos.x * 0.82 + lead, objPos.y * 0.5, 0)
        render()
      }

      const project = (v: InstanceType<typeof THREE.Vector3>): Anchor => {
        const w = el.clientWidth
        const h = el.clientHeight
        const s = v.clone().project(camera)
        return { x: ((s.x + 1) / 2) * w, y: ((1 - s.y) / 2) * h }
      }

      apiRef.current = {
        setProgress,
        anchor: (target) => {
          if (target === 'object') return project(objPos)
          if (target === 'gate') return project(gatePt)
          return project(nodePts[target as NodeIndex])
        },
        dispose: () => {
          ro.disconnect()
          ;[pathGeom, ringGeom, discGeom, rimGeom, label.geometry, shadow.geometry, post, bar].forEach((g) => g.dispose())
          ;[pathMat, discMat, rimMat, labelMat, shadowMat, gateMat].forEach((m) => m.dispose())
          rings.forEach((r) => (r.material as { dispose: () => void }).dispose())
          labelTex.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        },
      }
      setProgress(0, true)
      onReady?.()
    })

    return () => {
      cancelled = true
      apiRef.current?.dispose()
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount])

  return <div ref={host} className="absolute inset-0" aria-hidden />
}
