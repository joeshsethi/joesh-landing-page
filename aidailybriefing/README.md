# Daily AI Briefing — research agent + site

A daily AI news service for one reader. A **research agent** runs every morning,
gathers and verifies the most important global + Japan AI developments, and writes
`briefing.json`. A **static front end** fetches that file and renders it. It lives
at `joeshsethi.com/AiDailyBriefing` so you can read it without opening Claude Code.

This repo is the back end + deploy bundle for the finished front end that shipped
in this folder (`Daily AI Briefing.dc.html`). See [HANDOFF.md](HANDOFF.md) for the
original spec.

---

## The one idea that makes this simple

**The only moving file is `briefing.json`.** Everything reduces to:

```
agent writes briefing.json  →  host serves it  →  page fetches & renders it
```

Get that contract right and the rest is plumbing. The contract is
[`schema/briefing.schema.json`](schema/briefing.schema.json); the page is
data-driven and falls back to an embedded edition if the fetch ever fails, so it
never breaks.

```
┌─────────────────┐   06:30 JST    ┌──────────────┐   commit    ┌──────────────┐
│ GitHub Actions  │ ─────cron────▶ │ agent/run.js │ ──────────▶ │ git repo     │
│ (scheduler)     │                │ Claude + web │  briefing   │              │
└─────────────────┘                │ search/fetch │   .json     └──────┬───────┘
                                   └──────────────┘                     │ deploy
                                                                        ▼
   reader ◀──── fetches briefing.json ◀──── joeshsethi.com/AiDailyBriefing (Vercel)
      │                                                                  ▲
      └──── 👍/👎/★ ──▶ /api/feedback ──▶ (store) ──▶ preferences.md ─────┘
                                                      (feedback loop)
```

---

## Repo layout

| Path | What it is |
|---|---|
| `agent/run.js` | Orchestrator: gather → verify → summarize → **validate** → emit. |
| `agent/prompt.js` | The editorial system prompt + `preferences.md` injection. |
| `agent/validate.js` | AJV check against the schema (the anti-"fake story" gate). |
| `agent/mock.js` | Dry-run generator — runs with no API key. |
| `agent/store.js` | Storage interface: `file` backend (local) or `aws` (DynamoDB + S3). |
| `agent/review.js` | **The lite supervisor** — turns feedback into steering + a journal. |
| `schema/briefing.schema.json` | The agent↔page contract (schema v1). |
| `preferences.md` | Plain-English ranking/tone the agent reads each run. |
| `decisions.md` | **The journal** — every run + every review, so you can watch it improve. |
| `site/AiDailyBriefing/` | **The deploy-ready folder** (self-contained). |
| `api/feedback.js` | Vercel function that persists reader 👍/👎/★ to DynamoDB. |
| `infra/` | CloudFormation + walkthrough for the AWS backend. |
| `.github/workflows/daily-briefing.yml` | The 06:30 JST cron (daily edition). |
| `.github/workflows/weekly-review.yml` | Sunday cron — opens a PR with proposed steering. |
| `Daily AI Briefing.dc.html`, `support.js`, `briefing.json` | Original source files (kept as the canonical seed + demo). |

---

## Run it locally

```bash
npm install

# Dry run — no API key needed. Freshens the edition so you can see the loop work.
npm run briefing:dry

# Validate any briefing against the schema (the acceptance check).
npm run validate

# Check every source URL is reachable (flags 404s; bot-blocked sites are fine).
npm run verify:sources
# During a run, add the flag to check before publishing:
#   npm run briefing -- --verify-sources    (warn only)
#   npm run briefing -- --strict-sources    (block publish if any link 404s)

# See the page render the data (serves site/AiDailyBriefing on :4321):
npx serve site/AiDailyBriefing -l 4321   # then open http://localhost:4321

# Run the feedback review (the lite supervisor). Reads data/feedback.jsonl,
# appends to decisions.md, and writes preferences.proposed.md. No API key needed.
npm run review
```

For a **live** run, create `.env` from `.env.example` and add `ANTHROPIC_API_KEY`:

```bash
npm run briefing      # Claude researches, verifies, and writes a real briefing.json
```

The agent uses Claude (`claude-opus-4-8`) with the `web_search` and `web_fetch`
server tools to gather and verify, then emits JSON. `run.js` validates it and, if
it doesn't pass, asks the model once to repair it before failing — so a malformed
edition never ships.

---

## Going live (your stack: GitHub Actions → Vercel)

1. **Push this repo to GitHub.**
2. **Add the secret:** repo → Settings → Secrets and variables → Actions →
   `ANTHROPIC_API_KEY`. (Without it, the cron still runs but produces a dry-run.)
3. **Wire up hosting** — two options:
   - **Drop-in (simplest):** copy `site/AiDailyBriefing/` into your existing
     joeshsethi.com repo under `public/AiDailyBriefing/`. It serves at
     `joeshsethi.com/AiDailyBriefing` with no config. Point the cron at that repo,
     or have this repo's Action commit there.
   - **Standalone:** deploy *this* repo as its own Vercel project. `vercel.json`
     rewrites `/AiDailyBriefing` to the folder and sets `no-store` on the JSON.
4. The Action commits a new `briefing.json` each morning; Vercel auto-deploys on
   push; a browser refresh re-fetches the newest edition.

Trigger a run by hand anytime from the **Actions** tab (workflow_dispatch).

---

## The feedback loop — how it actually improves

This is the part that makes it more than a news ticker. Three pieces, all built:

1. **Capture.** The page POSTs your 👍/👎/★ to `/api/feedback`, which persists each
   signal to DynamoDB (or a local `data/feedback.jsonl` in `file` mode).
2. **Review.** `npm run review` (and the Sunday workflow) reads the week's signals,
   **joins each one to the story it was about** (by region / category / tag using the
   dated editions), and produces plain-English steering — e.g. *"lean into funding
   stories; reader engages most with Japan items."*
3. **Steer + record.** It writes those into `preferences.proposed.md` (which the
   agent would read next run) and appends a dated entry to [`decisions.md`](decisions.md)
   — **the journal where you watch the agent change over time.**

It stays **manual-to-start**: the review *proposes* (opens a PR); you approve by
copying the proposal over `preferences.md`. Once you trust it, run `npm run review
--apply` (or flip the workflow) to let it update preferences automatically. That's
the "supervisor managing it the way you do, then better."

Every daily run also logs a line to `decisions.md`, so the journal answers
"what has this thing been doing, and how is it changing?" without any black box.

See [`infra/README.md`](infra/README.md) to stand up the DynamoDB + S3 backend.

---

## What's deferred (and why)

- **AI-written preference edits.** The supervisor currently derives steering from
  feedback *deterministically* (counts by region/category/tag) — inspectable and
  free. A natural next step is to also have Claude read the journal + recent
  editions and propose richer, prose-level preference changes. Easy to add to
  `agent/review.js` once you trust the deterministic version.
- **Audio/video brief.** The hero player was removed; the page leads with the text
  `meta.summary`. Revisit only after the written summary is consistently strong.

---

## If you'd rather learn this on AWS

You chose GitHub Actions + Vercel (fastest credible path). The same shapes map
cleanly onto AWS if you want the practice that lines up with your Comcast/Accenture
background:

| This repo | AWS equivalent |
|---|---|
| GitHub Actions cron | **EventBridge Scheduler** rule (cron) → **Lambda** |
| `agent/run.js` | The Lambda handler (same code; bundle `node_modules`) |
| Commit `briefing.json` | `PutObject` to an **S3** bucket |
| Vercel static hosting | **S3 + CloudFront** (set `Cache-Control: no-store` on the JSON) |
| `api/feedback.js` | **API Gateway → Lambda → DynamoDB** |
| GitHub secret | **Secrets Manager** / SSM Parameter Store |

The agent code doesn't change — only where it runs and where the file lands.
