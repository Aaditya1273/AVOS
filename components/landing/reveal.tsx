'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Fade-and-rise on first entry into the viewport. Transform and opacity only,
 * so it never causes layout; runs once per element; disabled entirely under
 * prefers-reduced-motion by the global transition rule in globals.css, where
 * the element simply appears in place. Content is present in the DOM from the
 * first paint — this is decoration on top of information, never a gate on it.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.dataset.in = '1'
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.dataset.in = '1'
            io.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'translate-y-3 opacity-0 transition-[opacity,transform] duration-500 ease-out data-[in]:translate-y-0 data-[in]:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  )
}
