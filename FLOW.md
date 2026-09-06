# AVOS — Demo Flow

**How to record a demo that proves AVOS is really talking to Razorpay.**

The whole video exists to land two claims, in this order:

1. **The Razorpay connection is real.** A transaction created by hand on
   `dashboard.razorpay.com` appears inside AVOS seconds later, with the same
   `pay_…` id, because AVOS fetched it over the API with the merchant's own key.
2. **The verifier is independent.** The AI proposes a closure; AVOS recomputes
   the money from evidence and *refuses* it. Money stays put.

Claim 1 is the part judges are sceptical about, so it goes first and it is shown
live, not narrated. Claim 2 is the product.

Target length: **3:30–4:30**. Anything longer and the refusal lands after
attention is gone.

---

## 0. What is actually true (read this before you script anything)

Say these things and you will never be caught out:

| Fact | Status |
| --- | --- |
| AVOS authenticates against the Razorpay API with a real test key | ✅ verified live — 5 requests, all HTTP 200 |
| AVOS reads settlements, recon, payments and refunds over 4 GET endpoints | ✅ `lib/connectors/razorpay.ts` |
| A test payment created on the dashboard shows up in AVOS on the next sync | ✅ this is the demo |
| AVOS returns **0 settlements** in test mode | ✅ true, and it is Razorpay's behaviour, not a bug |
| The AI agent runs on a real provider on the deployment | ✅ Groq · `openai/gpt-oss-120b`, probed per sync |
| The verifier never imports a model, clock, network or filesystem | ✅ 16 isolation checks in CI |

**Razorpay test mode does not produce settlements.** Razorpay's own docs say
"No real money is used in the test mode", and the settlement cycle is documented
only for Live Mode. So there is nothing for the T+2 cycle to settle. AVOS shows
`0` and says why. **Do not fake a settlement.** The moment a judge sees an
invented `setl_…` id, both claims die.

This is not a weakness to hide — it is the strongest 20 seconds in the video.
See Scene 7.

---

## 1. Pre-flight (do this 30 minutes before recording)

### 1.1 Confirm the deployment is live and connected

```bash
curl -s https://avos-razorpay.vercel.app/api/razorpay/sync \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['connection']['state'], d['mode'], d['counts'], d['agent']['state'], d['agent']['model'])"
```

Expected right now:

```
CONNECTED test {'settlements': 0, 'recon_rows': 0, 'payments': 0, 'refunds': 0} available openai/gpt-oss-120b
```

If `state` is anything but `CONNECTED`, fix that before you record — check
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in Vercel → Settings → Environment
Variables, then **Redeploy** (env changes do not apply to an existing build).

If `agent.state` is `unavailable`, check `AVOS_LLM_API_KEY`,
`AVOS_LLM_BASE_URL` (`https://api.groq.com/openai/v1`) and `AVOS_LLM_MODEL`
(`openai/gpt-oss-120b`).

### 1.2 Confirm the counts start at zero

They should all be `0`. A zero start is what makes the jump to `1` legible on
camera. If your test account already has payments, either use a fresh test
account or accept that the number goes `7 → 8` and point at the id instead.

### 1.3 Log in to the Razorpay Dashboard in **Test Mode**

`dashboard.razorpay.com` → flip the **Test Mode** toggle. Confirm the banner
says test mode before you record a single frame.

### 1.4 Security check on your own screen

- **Never show `RAZORPAY_KEY_SECRET`.** Not in a terminal, not in Vercel's env
  page, not in `.env.local`.
- The **key ID** (`rzp_test_…`) is safe to show — it is the public half — but
  AVOS only ever prints the `rzp_test_` prefix anyway, so there is no reason to
  open the keys page on camera at all.
- Close every unrelated tab. Clear terminal scrollback (`clear`) so no earlier
  command containing a key is one scroll away.

### 1.5 Screen layout

Record at **1920×1080**, browser at ~1600px wide so the console's two-column
layout is intact.

Two windows you will switch between:

| Window | Contents |
| --- | --- |
| **A — Browser** | Tab 1: `avos-razorpay.vercel.app/console` · Tab 2: `dashboard.razorpay.com` |
| **B — Terminal** | one shell, cleared, in the repo |

Do **not** use a split screen for the whole video. Switch. A full-width console
reads; a 50% console does not.

---

## 2. Scene-by-scene

Timings are targets, not a metronome.

### Scene 1 — Cold open: an empty, honest console `0:00 – 0:25`

**Screen:** AVOS console, Overview.

**Do:** land on the page. Let it sync. Point the cursor at the status block.

**On screen:** `Razorpay Test API · Connected · Read-only` and beneath it
`Last sync … · 0 settlements · 0 recon rows · 0 payments · 0 refunds`.

**Say:**

> "This is AVOS, connected to a live Razorpay test account, read-only. Right
> now it has nothing, and it says so. Nothing is mocked, nothing is filled in.
> Watch what happens when I create one real transaction."

Why this opening: every other demo opens on a full dashboard, which is exactly
what a fabricated dashboard also looks like. Opening on zero is a claim nobody
fakes.

### Scene 2 — Show the API is actually being called `0:25 – 0:45`

**Do:** click **API activity this sync · 5 requests** to expand it.

**On screen:**

```
GET  /v1/settlements                 200 OK   count 0
GET  /v1/settlements/recon/combined  200 OK   count 0
GET  /v1/settlements/recon/combined  200 OK   count 0
GET  /v1/payments                    200 OK   count 0
GET  /v1/refunds                     200 OK   count 0
```

**Say:**

> "Five GET requests to api.razorpay.com, every one of them 200. This list is
> the *only* thing that decides whether AVOS says 'Connected' — it is not
> inferred from an environment variable being set."

### Scene 3 — Create a real transaction on Razorpay `0:45 – 1:40`

**Screen:** switch to the Razorpay Dashboard tab. Make the Test Mode toggle
visible in frame for a beat.

**Do**, per Razorpay's documented flow:

1. **PAYMENT PRODUCTS → Payment Links → + Create Payment Link**
2. Amount: **₹1,234.56** — an odd number is easier to recognise later than a
   round one.
3. *Payment For:* `AVOS demo settlement`
4. Create. You get a `https://rzp.io/rzp/…` link.
5. Open the link, pay with Razorpay's documented test card:

   | Field | Value |
   | --- | --- |
   | Card | `4100 2800 0000 1007` |
   | Expiry | any future date |
   | CVV | any random 3 digits |
   | OTP | any random 4–10 digit number (that is what makes it succeed) |

6. Success screen. Go back to **Transactions → Payments**.

**On screen:** the new payment, `captured`, `₹1,234.56`, with its id `pay_…`.

**Do:** select the row so the full payment id is readable. Hold for 2 seconds —
the viewer needs to memorise the last 4–5 characters.

**Say:**

> "A real payment link, Razorpay's own test card, Razorpay's own checkout. This
> payment now exists in the merchant account — id `pay_…`. AVOS did not create
> it and cannot: it only holds GET permissions."

### Scene 4 — The peak: the same id appears inside AVOS `1:40 – 2:20`

**Screen:** back to AVOS. **Do not reload.**

**Do:** click **Sync Razorpay**.

**On screen, in this order:**

1. The button spins.
2. The counts line changes: `… · 0 payments · …` → **`… · 1 payments · …`**
3. Expand API activity: `GET /v1/payments  200 OK  count 1`

**Say:**

> "One click. Same key, same endpoint — and the count moved from zero to one."

**Then switch to the terminal** for the shot that removes all doubt:

```bash
curl -s https://avos-razorpay.vercel.app/api/razorpay/sync \
  | python3 -m json.tool | grep -A6 '"payments"' | head -20
```

or, if you have `jq`:

```bash
curl -s https://avos-razorpay.vercel.app/api/razorpay/sync | jq '.unsettled.payments'
```

**On screen:**

```json
[
  {
    "id": "pay_XXXXXXXXXXXXXX",
    "amount_paise": 123456,
    "currency": "INR",
    "status": "captured",
    "captured": true,
    "method": "card",
    "created_at": "2026-…"
  }
]
```

**Say — this is the line the whole video is built around:**

> "That is the same payment id that is on the Razorpay dashboard behind this
> window, and the same ₹1,234.56, in paise, as an integer. AVOS didn't store it,
> didn't seed it, didn't cache it. It asked Razorpay, thirty seconds ago."

If you can, **alt-tab once** between the dashboard row and this JSON so the two
ids are seen back to back. That single cut is worth more than any diagram.

### Scene 5 *(optional, +20s)* — Refund, to prove it is a live read not a one-off

Razorpay's documented dashboard flow: **Transactions → Payments** → select the
payment (must be `captured`) → **Issue Full Refund**.

Back in AVOS → **Sync Razorpay** → counts read `1 payments · 1 refunds`, and the
activity log shows `GET /v1/refunds  200 OK  count 1`.

Cut this scene first if you are over time.

### Scene 6 — Where the settlement is `2:20 – 2:45`

**Screen:** AVOS Overview, on the empty state.

**On screen:**

> **No settlement data yet**
> Razorpay Test API is connected, but this account currently has no settlement
> records. Test-mode payments are simulated and nothing settles. Nothing has
> been substituted.

**Say:**

> "The payment is there. The settlement is not — because Razorpay's test mode
> moves no real money, so there is nothing for the settlement cycle to settle.
> A demo that showed you a settlement here would have invented it. AVOS shows
> zero and tells you why. That is the same instinct the rest of the product is
> built on: never assert what you cannot evidence."

This is the credibility hinge. Deliver it as a feature, because it is one.

### Scene 7 — The verifier at full strength `2:45 – 4:00`

You still have to show what AVOS *does* with a settlement. Switch the source.

**Do:** click **Evaluation dataset** in the source switch.

**Say the label out loud — do not skip this:**

> "This is the AVOS Evaluation Dataset: 120 synthetic, seeded, labelled
> settlements. It is not Razorpay data, it is labelled as evaluation data
> everywhere it appears, and it exists because you cannot prove a verifier
> catches errors without knowing where the errors are."

**Do:** open **Settlements** → the top exception, `S-10092`, **₹94,385.56**.

**On screen, in the detail panel:**

- **₹94,385.56**
- `FAILED — NOT CLOSED`
- `₹120.00 fee mismatch`
- Expected `₹94,505.56` · Observed `₹94,385.56` · Difference `₹120.00`
- `Agent proposal RECONCILED · 95% confidence — recorded, not used as proof.`

**Say:**

> "The AI read the evidence and proposed closing this: RECONCILED, 95%
> confidence. AVOS recomputed the money from the evidence rows and found
> ₹120 that the rate card in force does not account for. Verdict: failed.
> The AI's confidence had no vote."

**Do:** click **View why**.

**On screen:** the drawer — agent proposal (struck through), source, financial
proof, policy `finance-policy-v13`, the failed check `arithmetic_reconciles`,
and what would make it closeable.

**Say:**

> "Every refusal comes with the arithmetic, the policy version in force at
> decision time, the exact check that failed, and what evidence would clear it.
> 21 checks ran. One failed. That is the whole product: the AI proposes, the
> evidence decides."

### Scene 8 — Close `4:00 – 4:20`

**Screen:** back to Overview, or the Evaluation tab showing `0%` false closure.

**Say:**

> "Real Razorpay API on the product path. A real model proposing. And a
> deterministic verifier that imports nothing, trusts nothing, and refused a
> closure the AI was 95% sure about. Zero false closures across 120 labelled
> settlements. AVOS."

---

## 3. The one-line summary of the flow

```
Razorpay Dashboard (test mode)
  └─ create Payment Link → pay with test card 4100 2800 0000 1007
       └─ payment pay_XXXX exists in the merchant account
            └─ AVOS: click "Sync Razorpay"
                 └─ GET /v1/payments  (merchant key, read-only)  → HTTP 200, count 1
                      └─ normalizeRazorpay → integer paise + provenance stamp
                           └─ counts show "1 payments"; /api/razorpay/sync returns pay_XXXX
                                └─ settlements still 0 — test mode settles nothing, and AVOS says so
                                     └─ switch to Evaluation Dataset for the verifier's refusal
```

---

## 4. Recording checklist

**Before**

- [ ] `curl … /api/razorpay/sync` returns `CONNECTED`, agent `available`
- [ ] All four counts are `0`
- [ ] Razorpay Dashboard is in **Test Mode**, logged in, on Payment Links
- [ ] Terminal cleared; no key or secret anywhere in scrollback
- [ ] Unrelated tabs, notifications, Slack, email all closed
- [ ] 1920×1080, browser ≥1600px wide
- [ ] Payment link already created **if** you want to save 40 seconds — you can
      create it before recording and only *pay* it on camera

**During**

- [ ] Test Mode toggle visible for at least one beat
- [ ] Payment id held on screen ≥2s on the dashboard
- [ ] Counts `0 → 1` visible in the same frame as the "Sync Razorpay" button
- [ ] Dashboard id and JSON id shown back to back
- [ ] The phrase "evaluation dataset, not Razorpay data" is actually spoken

**Never**

- [ ] ❌ Show the key secret
- [ ] ❌ Call the evaluation dataset "Razorpay data"
- [ ] ❌ Present a settlement in test mode
- [ ] ❌ Edit the video so a count appears to change without a sync

---

## 5. Troubleshooting on the day

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Not configured` | env vars missing on Vercel | Add both Razorpay vars → **Redeploy** |
| `Authentication failed` | wrong key/secret pair, or a live key with a test secret | Regenerate the pair in the dashboard, both from the same mode |
| `Unavailable` | network or Razorpay outage | AVOS already retried once; try again, it is logged honestly |
| Sync ran but count still 0 | payment not `captured` (OTP under 4 digits fails it) | Re-pay the link with a 4–10 digit OTP |
| Agent shows `unavailable` | `AVOS_LLM_*` wrong or model retired | `npm run test:agent:live` prints the model ids the key can actually reach |
| Everything is zero and you are on camera | wrong Razorpay account/mode | Confirm Test Mode and that the dashboard account matches the key |

---

## 6. If you want an actual settlement (post-hackathon)

There is exactly one honest route: **Live Mode**. A real payment of a small
amount on a live key, then Razorpay's settlement cycle credits your bank and
`GET /v1/settlements` starts returning rows. AVOS needs no code change — it is
the same four endpoints, and `mode` in the payload flips to `live` on its own.

Until then, `0` is the correct answer and the product says so.

---

## 7. Backup plan: no network at the venue

Record the Razorpay half **in advance** and play it as a clip. Do not attempt
Scenes 3–5 on venue wifi live. Keep the console demo (Scene 7) live, since it
runs on committed data and needs nothing but the page.

Have `docs/razorpay-tab.png` and `docs/proof-card-failed.png` open in tabs as a
last resort.
