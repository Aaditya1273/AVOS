# Deploying AVOS to Vercel

**The deployment builds and runs with no keys.** What you see without them is
honest and mostly empty: the Razorpay tab reads **Not configured** and the AI
agent reads **unavailable**; the AVOS Evaluation tab is fully populated because
it runs on committed data. To make the product path do its job, set the three
variables below. Nothing is substituted for a missing one.

---

## Why there is nothing to configure

AVOS has no database and no external calls on its critical path. The evidence
ledger is nine CSV files committed to the repo, and the verdicts are recomputed
from them by `lib/verifier/deterministic.ts` — a file with zero runtime imports,
no clock, no network and no randomness. There is nothing to point at a server
because there is no server to point at.

The AI surfaces (evidence selection, exception narration, Q&A) fall back to a
deterministic offline mock when no key is present. That is not a degraded demo
mode: none of the published numbers depend on a model, so the mock reproduces
them exactly. A reviewer with no API key sees the same figures the README claims.

---

## Deploy

1. Push the repo to GitHub (already done: branch `avos-verify-track04`).
2. On [vercel.com/new](https://vercel.com/new), import the repository.
3. Vercel detects Next.js and fills in the build settings. **Change nothing.**
4. Deploy.

Build command, output directory and install command are all auto-detected. There
is no `vercel.json` in this repo on purpose — every setting it could contain is
either already correct by default or better set in the project UI.

### Two project settings worth changing

| Setting | Value | Why |
| --- | --- | --- |
| **Node.js Version** | 20.x or later | `package.json` declares `engines.node >= 20`. Vercel's current default already satisfies this; set it explicitly if you pin. |
| **Function Region** | `bom1` (Mumbai) | Default is `iad1` (Washington). For judges in India this is the difference between a snappy console and a laggy one. Settings → Functions → Region. |

---

## Environment variables

**All optional.** The app is fully functional with none of them set.

| Variable | Default | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | *(empty)* | Required for the agent on the product path (no stand-in is used there). Optional for the evaluation, which keeps its scripted proposer so its numbers reproduce without a key. **Never changes a verdict** — the verdict path contains no model. |
| `AVOS_LLM_MODEL` | `gpt-4o-mini` | Which model those surfaces use. |
| `AVOS_USE_MOCK` | `0` | Set to `1` to force the mock even when a key is present. Useful for reproducing the committed numbers exactly. |
| `AVOS_RUN_STAMP` | *(now)* | Pins the timestamp in `evals/report.md`. Local eval harness only; irrelevant to a deployment. |
| `RAZORPAY_KEY_ID` | *(empty)* | **The product path.** The console's Razorpay tab calls `/api/razorpay/sync`, which makes read-only GET requests with these. Without them the tab shows *Not configured* and makes no request. |
| `RAZORPAY_KEY_SECRET` | *(empty)* | As above. Server-side only; never reaches the client bundle — verified against the built output by RT08. |

Set the Razorpay pair on Vercel to make the Razorpay tab live. "Connected" on
that tab means every request in the sync returned 2xx; it is never inferred from
the variables being present. Set `OPENAI_API_KEY` to have a model propose claims
on what Razorpay returns; without it the tab shows the evidence and reports *AI
agent unavailable* rather than substituting a scripted proposer.

### Do not set this one

| Variable | Why not |
| --- | --- |
| `AVOS_STANDALONE` | Docker only. It switches the build to `output: 'standalone'`, which is not the shape Vercel's builder expects. Leaving it unset is correct. |

### If you do add `OPENAI_API_KEY`

Add it in Vercel under Settings → Environment Variables, scoped to Production
(and Preview if you want it there). Two honest caveats:

- **It costs money per page interaction** and buys you nothing the judges are
  scored on, because the verdicts are identical either way. The mock is the
  better demo: it is free, instant, and reproducible.
- The live comparison in `evals/raw/metrics.live.json` currently records
  `skipped_no_key`. If you set a key, run `npm run eval:live` locally and commit
  the result rather than leaving the claim untested.

---

## The one Vercel-specific thing that had to be fixed

`lib/data/ledger.ts`, `lib/decisions.ts` and `lib/eval-report.ts` read their
files from disk at request time, using paths built from `process.cwd()`.

Vercel's serverless bundler traces which files each function needs by following
static `import` statements. **It cannot follow a path assembled at runtime.**
Left alone, the build succeeds, the deployment goes green, and every request
404s on its own evidence — a failure that never appears locally, because locally
the whole repo is on disk.

`next.config.mjs` fixes this explicitly:

```js
experimental: {
  outputFileTracingIncludes: {
    '/**': ['./data/**', './evals/raw/**'],
  },
}
```

Two details that are easy to get wrong:

- In **Next 14 this key lives under `experimental`**. It graduates to the top
  level in Next 15. Putting it at the top level here is silently ignored — you
  get a build that works locally and 500s in production, with no warning.
- The glob key is `'/**'`, not a specific route. Every function that touches the
  ledger needs the files, including the ones added later.

Verified against a clean clone: all 9 CSVs, 5 data JSONs and 4 eval JSONs appear
in the trace manifest of `/`, `/api/decision` and `/api/replay`.

---

## Verifying a deployment

Once the URL is live, four checks in about a minute:

```bash
URL=https://your-deployment.vercel.app

# 1. The console renders, server-side, with the evaluation in it.
curl -s $URL/console | grep -c VERIFIED  # expect a non-zero count

# 2. A decision resolves from the traced fixtures.
curl -s "$URL/api/decision?case_id=B001" | head -c 200

# 3. Point-in-time replay recomputes under an older policy epoch.
curl -s -X POST "$URL/api/replay" \
  -H 'content-type: application/json' \
  -d '{"case_id":"B001","as_of":"2026-07-15T00:00:00Z"}' | head -c 200

# 4. The agent proposes a claim the verifier then judges.
curl -s -X POST "$URL/api/agent" \
  -H 'content-type: application/json' \
  -d '{"case_id":"B001"}' | head -c 200
```

If step 2 returns a 404 or 500 while step 1 works, the file tracing regressed —
check that `outputFileTracingIncludes` is still nested under `experimental`.

In the browser, `/` is the landing page and `/console` is the working surface.
The load-bearing thing to confirm is that the console's Reconciliation tab shows
the **FAILED / EXCEPTION — NOT CLOSED** proof card without scrolling. That is the
whole pitch: the agent proposed a closure, the verifier refused it, and the money
stayed put.

---

## Things that are deliberately absent

- **No `vercel.json`.** Nothing in it would be non-default except the region,
  which belongs in project settings where it is visible.
- **No ISR or caching.** `/` is `force-dynamic`. It re-reads and re-parses the
  ledger per request, which measures ~45 ms on a warm function — cheap enough
  that caching would add a staleness failure mode for no gain.
- **No `next/image`, no middleware, no rewrites.** Worth stating because the
  open `npm audit` advisories against Next 14 are confined to exactly those
  three surfaces plus self-hosted image caching, none of which this app uses.
  The pinned `14.2.35` is the latest patch on the 14 line; clearing the
  remaining advisories requires Next 16, a breaking upgrade with no security
  benefit for this application's surface.

---

## Docker, for comparison

The Dockerfile is the self-hosted path and is unrelated to Vercel:

```bash
docker build -t avos .
docker run -p 3000:3000 avos
```

It sets `AVOS_STANDALONE=1` itself. You never set that variable by hand.
