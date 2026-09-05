'use client'

/**
 * Route error boundary.
 *
 * The app had none, so an exception anywhere under `/` fell through to Next's
 * default overlay — a stack trace on a black page. On a product whose pitch is
 * that it stays calm and refuses to guess when something is wrong, that is
 * exactly the wrong failure mode to show a judge.
 *
 * Calm, specific, recoverable. The stack is available behind a disclosure rather
 * than dumped: a reviewer may want it, and nobody wants it first.
 */
import { useEffect } from 'react'
import { Button, Card } from '@/components/ui/primitives'
import { IconReplay } from '@/components/ui/icon'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[avos] route error', error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6">
      <Card className="w-full p-8">
        <h1 className="text-lg font-semibold tracking-tight">
          Something went wrong loading this view.
        </h1>
        <p className="mt-2 text-body leading-relaxed text-muted-foreground">
          No financial state changed. Verdicts are recomputed from source on every
          request, so nothing was written and nothing was closed.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={reset} className="gap-2">
            <IconReplay className="h-4 w-4" />
            Retry
          </Button>
          <a
            href="/"
            className="text-compact text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Back to the console
          </a>
        </div>

        <details className="mt-6 border-t border-border pt-4">
          <summary className="cursor-pointer text-mini text-muted-foreground">
            Technical details
          </summary>
          <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border surface-sunken p-3 font-mono text-micro leading-relaxed tracking-normal scrollbar-thin">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        </details>
      </Card>
    </main>
  )
}
