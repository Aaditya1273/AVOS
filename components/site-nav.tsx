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
 * The AVOS mark.
 *
 * A plain <img> rather than next/image on purpose. The asset is a fixed 224x256
 * PNG shown at 28px — there is nothing for an optimiser to do, and routing it
 * through /_next/image would light up the image-optimisation surface that
 * docs/DEPLOY.md currently records as unused, which is the surface most of the
 * open Next 14 advisories target. One static file is not worth that trade.
 */
function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above
    <img
      src="/logo-mark.png"
      alt=""
      aria-hidden
      width={224}
      height={256}
      className="h-7 w-auto"
    />
  )
}
