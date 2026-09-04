/**
 * shadcn/ui-style primitives.
 *
 * Written out rather than pulled in, because this app needs six of them and a
 * component library would be more configuration than component. Same API
 * conventions (`cn`, `cva` variants, forwarded refs) so anything from shadcn
 * drops in beside them unchanged.
 */

'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// --- Card -------------------------------------------------------------------

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-5', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-base font-semibold tracking-tight', className)} {...props} />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

// --- Button -----------------------------------------------------------------

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        outline: 'border border-border bg-transparent hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        xs: 'h-7 rounded px-2 text-mini',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
)
Button.displayName = 'Button'

// --- Badge ------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-mini font-semibold tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        verified:
          'border-[hsl(var(--verdict-verified)/0.35)] bg-[hsl(var(--verdict-verified)/0.12)] text-[hsl(var(--verdict-verified))]',
        uncertain:
          'border-[hsl(var(--verdict-uncertain)/0.35)] bg-[hsl(var(--verdict-uncertain)/0.12)] text-[hsl(var(--verdict-uncertain))]',
        failed:
          'border-[hsl(var(--verdict-failed)/0.35)] bg-[hsl(var(--verdict-failed)/0.12)] text-[hsl(var(--verdict-failed))]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

// --- Misc -------------------------------------------------------------------

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />
}

/** A labelled figure. Used everywhere a number needs a name next to it. */
export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'verified' | 'uncertain' | 'failed' | 'neutral'
  className?: string
}) {
  const toneClass =
    tone === 'verified'
      ? 'text-[hsl(var(--verdict-verified))]'
      : tone === 'uncertain'
        ? 'text-[hsl(var(--verdict-uncertain))]'
        : tone === 'failed'
          ? 'text-[hsl(var(--verdict-failed))]'
          : 'text-foreground'
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-micro font-medium uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <span className={cn('tnum text-lg font-semibold leading-tight', toneClass)}>{value}</span>
      {hint ? <span className="text-mini leading-tight text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

/** Monospace inline code, for ids, hashes and versions. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-mini', className)}>
      {children}
    </code>
  )
}
