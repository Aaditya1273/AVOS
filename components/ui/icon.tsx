/**
 * One icon set, drawn here.
 *
 * The interface previously used text glyphs as icons — ✓ ✕ ⛔ ⚑ – → — which is
 * the single most reliable tell that a UI was assembled rather than designed.
 * Glyphs render at whatever weight and baseline the user's font stack decides,
 * so a tick and a cross that are meant to be siblings arrive at different sizes
 * on different machines and sit off the text baseline on all of them.
 *
 * These are geometric, share a 16px grid and a 1.75 stroke, and inherit
 * `currentColor` so a verdict colour applies to the icon and its label together.
 * `aria-hidden` throughout: every one sits beside text that already says what it
 * means, and an icon that repeats its own label is noise to a screen reader.
 */
import { cn } from '@/lib/utils'

type IconProps = { className?: string; strokeWidth?: number }

function Svg({ children, className, strokeWidth = 1.75 }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0', className)}
    >
      {children}
    </svg>
  )
}

/** VERIFIED / CLOSED. */
export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="M3 8.5 6.2 11.7 13 4.9" /></Svg>
)

/** FAILED / EXCEPTION. */
export const IconCross = (p: IconProps) => (
  <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>
)

/** UNCERTAIN / REFUSED TO CLOSE — a held state, not an error. */
export const IconHold = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5.2v3.4M8 10.9h.01" /></Svg>
)

/** A skipped check. */
export const IconDash = (p: IconProps) => (
  <Svg {...p}><path d="M4 8h8" /></Svg>
)

/** Attacker-controlled text found in a free-text cell. */
export const IconFlag = (p: IconProps) => (
  <Svg {...p}><path d="M4 14V2.8h7.6l-1.5 2.6 1.5 2.6H4" /></Svg>
)

/** Replay / re-evaluate under another epoch. */
export const IconReplay = (p: IconProps) => (
  <Svg {...p}><path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" /><path d="M13.6 2.4v3.2h-3.2" /></Svg>
)

/** Progressive disclosure. */
export const IconChevron = (p: IconProps) => (
  <Svg {...p}><path d="M6 3.5 10.5 8 6 12.5" /></Svg>
)

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}><path d="M3 8h10M9.2 4.2 13 8l-3.8 3.8" /></Svg>
)
