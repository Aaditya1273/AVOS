'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { IconCross } from '@/components/ui/icon'

/**
 * A drawer. Right-hand panel on wide screens, full-width sheet on small ones.
 *
 * The context behind it stays visible: that is the point of a drawer over a
 * page. Escape closes it, the backdrop closes it, focus moves into it on open
 * and back to the opener on close, and the page behind stops scrolling while
 * it is up. Motion is transform and opacity over 180ms, and nothing else.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  wide?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
      document.body.style.overflow = prev
      ;(opener.current as HTMLElement | null)?.focus?.()
    }
  }, [open, onClose])

  return (
    <div
      className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}
      aria-hidden={!open}
    >
      <div
        className={cn('absolute inset-0 bg-foreground/25 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'absolute flex flex-col bg-card shadow-raised transition-transform duration-200 ease-out',
          'inset-x-0 bottom-0 max-h-[92svh] rounded-t-xl',
          'sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:rounded-none sm:border-l sm:border-border',
          wide ? 'sm:w-[min(760px,92vw)]' : 'sm:w-[min(560px,92vw)]',
          open ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-x-full sm:translate-y-0',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconCross className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{open ? children : null}</div>
      </div>
    </div>
  )
}
