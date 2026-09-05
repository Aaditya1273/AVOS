/**
 * The top bar, shared by the landing page and the console.
 *
 * Deliberately thin. A finance tool's chrome should be the least interesting
 * thing on screen — it exists so a reader always knows where they are and how to
 * get to the working surface, and then gets out of the way.
 */

import Link from 'next/link'

export function SiteNav({ active }: { active?: 'home' | 'console' }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded" aria-label="AVOS home">
          <Logo />
          <span className="text-base font-bold tracking-tight">AVOS</span>
          <span className="hidden text-mini text-muted-foreground sm:inline">
            Settlement assurance
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/" current={active === 'home'}>
            Overview
          </NavLink>
          <Link
            href="/console"
            className={
              'ml-1 inline-flex h-8 items-center rounded-md px-3 text-compact font-semibold transition-colors ' +
              (active === 'console'
                ? 'bg-secondary text-foreground'
                : 'bg-primary text-primary-foreground hover:bg-primary/90')
            }
          >
            {active === 'console' ? 'Console' : 'Open console'}
          </Link>
        </nav>
      </div>
    </header>
  )
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string
  current?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={
        'rounded-md px-2.5 py-1.5 text-compact transition-colors ' +
        (current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')
      }
    >
      {children}
    </Link>
  )
}

/**
 * A mark, not a logo: a ledger column with one row struck out. It is the
 * product in one glyph — most things pass, one is stopped.
 */
function Logo() {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="M3 4.5h10M3 8h10M3 11.5h6" />
        <path d="M10.5 13.5L14 10" />
      </svg>
    </span>
  )
}
