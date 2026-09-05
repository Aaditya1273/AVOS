'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

/**
 * The console's top-level navigation.
 *
 * Each panel is rendered on the server and handed in as a node, so this file
 * carries no data and no fetching — it only decides which of five already-built
 * surfaces is visible. That keeps the whole evaluation on the server where the
 * verifier runs, and keeps the client bundle to a tab list.
 *
 * Five tabs rather than one page because the depth was previously invisible:
 * the isolation checks, the acceptance gates and the adversarial suite all
 * existed and none of them had anywhere to be seen.
 */

export interface ConsoleTab {
  id: string
  label: string
  hint?: string
  content: React.ReactNode
}

export function ConsoleShell({ tabs, initial }: { tabs: ConsoleTab[]; initial?: string }) {
  return (
    <Tabs.Root defaultValue={initial ?? tabs[0]?.id} className="flex flex-col">
      <Tabs.List
        className="scroll-x-clean -mx-4 flex gap-1 border-b border-border px-4 sm:mx-0 sm:px-0"
        aria-label="Console sections"
      >
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t.id}
            value={t.id}
            className={cn(
              'group relative shrink-0 whitespace-nowrap px-3.5 py-2.5 text-compact font-medium',
              'text-muted-foreground transition-colors hover:text-foreground',
              'data-[state=active]:text-foreground',
              'focus-visible:outline-none focus-visible:ring-0',
            )}
          >
            {t.label}
            {t.hint ? (
              <span className="tnum ml-1.5 text-mini text-muted-foreground/70">{t.hint}</span>
            ) : null}
            {/* The active marker sits on the border line rather than under the
                label, so switching tabs moves one 2px rule instead of shifting
                every label by its own underline. */}
            <span
              aria-hidden
              className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary opacity-0 transition-opacity group-data-[state=active]:opacity-100"
            />
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id} className="pt-5 focus-visible:outline-none">
          {t.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}
