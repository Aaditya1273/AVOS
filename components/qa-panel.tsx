'use client'

import { useState } from 'react'
import { Badge, Button, Mono } from '@/components/ui/primitives'
import type { QaAnswer } from '@/lib/ai/qa'

const SUGGESTED = [
  'What explains the fee difference?',
  'Which bank credit landed against this UTR?',
  'Which policy version applied, and why?',
  'Were any refunds or holds netted out?',
]

/**
 * Settlement Q&A — the one surface an injected instruction can reach.
 *
 * The verdict line renders separately from the model's answer, and it is copied
 * verbatim from the deterministic result. That separation is visible in the UI
 * on purpose: a reviewer can see which sentence was computed and which was
 * written, and only one of them is load-bearing.
 */
export function QaPanel({ caseId }: { caseId: string }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<(QaAnswer & { using_mock: boolean }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, question: trimmed }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'question failed')
      setAnswer(json)
    } catch (e) {
      setError((e as Error).message)
      setAnswer(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Ask about this settlement
        </h4>
        <Badge variant="outline">AI · cited</Badge>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(question)
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="e.g. why is there a ₹120 gap?"
          className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" disabled={busy || question.trim() === ''}>
          {busy ? '…' : 'Ask'}
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => {
              setQuestion(s)
              ask(s)
            }}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-[hsl(var(--verdict-failed)/0.4)] bg-[hsl(var(--verdict-failed)/0.08)] px-3 py-2 text-[12px] text-[hsl(var(--verdict-failed))]">
          {error}
        </div>
      ) : null}

      {answer ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="rounded border-l-2 border-primary bg-background/60 px-3 py-2">
            <div className="mb-0.5 text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
              Computed by the verifier — copied, not generated
            </div>
            <div className="tnum text-[12.5px] font-medium">{answer.verdict_line}</div>
          </div>

          <div className="px-1">
            <div className="mb-0.5 text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
              Written by the model {answer.using_mock ? '(offline mock)' : ''}
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/90">{answer.answer}</p>
          </div>

          {answer.citations.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              <span className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
                Cited
              </span>
              {answer.citations.map((c) => (
                <Mono key={c}>{c}</Mono>
              ))}
            </div>
          ) : null}

          {answer.injection_detected ? (
            <div className="px-1 text-[11px] text-[hsl(var(--verdict-uncertain))]">
              This settlement&rsquo;s evidence contains instruction-shaped text in a free-text cell.
              It reached this prompt as delimited data and reached the verifier not at all.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
