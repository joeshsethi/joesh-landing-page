# ARCHITECTURE.md — agents, data flow, Supabase

> Companion to CLAUDE.md. Plain text = certain (built this session). **[INFERRED]** /
> **TODO: confirm with Joesh** as marked. All file paths are under the repo
> `github.com/joeshsethi/joesh-landing-page`.

## The agents (all use `claude-sonnet-4-6` + `web_search_20250305`)

> Why `web_search_20250305` and NOT `web_search_20260209`: the newer tool runs
> code-execution "dynamic filtering" which requires a `container_id` to be threaded
> across pause_turn continuations; long runs hit a fatal `400 container_id is required`.
> The 2025 tool has no code-execution, so that whole failure mode is gone. **Do not
> switch to the 2026 web tools without re-solving the container handling.**

### News pipeline (`agent/run.js`) — v2, shipped 2026-06-28

**1. Beat workers (×4, RUN IN PARALLEL via `Promise.allSettled`)**
- Defined in `agent/prompt.js` as `BEATS`: `frontier` (Frontier models & research),
  `funding` (Funding, VC & emerging companies), `hardware` (Hardware, compute &
  semiconductors), `japan` (Japan AI).
- Each worker: `buildWorkerPrompt(beat)` system + `buildWorkerInstruction(beat)` user;
  tools = `web_search` with `max_uses = AIDB_MAX_SEARCHES` (default **8** per worker).
- **Input:** the beat focus + `preferences.md` + the prior edition's headlines
  (anti-repetition).
- **Output:** a JSON object `{ "candidates": [ <item>, ... ] }`, ~5-7 items each
  (region forced to the beat's region). An item ≈ `{region, cat, source, time,
  headline, dek, analysis:{happening,now,future}, sources:[{name,title,url}], tags}`.
- **Resilience:** `gatherBeat()` retries a worker once; if it still fails, that beat is
  **dropped** and the editor proceeds with the rest. (So a flaky beat can't sink the run.)

**2. Editor (×1, SEQUENTIAL after the workers — this is the MERGE step)**
- `buildEditorSystemPrompt()` + `buildEditorInstruction({candidates, ...})`.
- **No web tools** — it works purely from the pooled ~28 candidates the workers
  returned. THIS is how parallel outputs get merged: all candidates → one editor call.
- **Job:** select ~5 global + 3-4 Japan, dedupe/merge near-duplicates, **tighten** each
  story (summary 3-5 sentences ≤130 words; analysis paragraphs ≤55 words each, focused on
  Joesh's preferences), keep source URLs verbatim, write `meta` (greeting "Good morning,
  Joesh.", brandLabel, intro, briefingTitle, summary, footers) + the `gaps` tracker
  (Japan-vs-frontier, 4 entries 0-100).
- **Output:** one schema-valid `briefing.json` (schema v1, `schema/briefing.schema.json`).
- Observed first run: 28 candidates → 10 stories. (Target is ~8-9; it ran slightly over.
  **TODO: confirm with Joesh** whether to hard-cap at ~9.)

**3. Grounding (`enforceWorkingSources`, SEQUENTIAL after editor)**
- Pings every source URL. "Broken" = HTTP 404/410 OR DNS/connection failure, **re-checked
  once** (transient blips don't count). 401/403/429/451 (paywall/bot-block) and 5xx/
  timeout are KEPT.
- Up to 2 repair rounds: asks the agent (tools on, `GROUNDING_SYSTEM`) to re-find a real
  working link or remove just that link.
- Final: strips still-broken links but **keeps every story** (schema allows 0 sources).

**4. Emit + publish**
- `emit()` writes `briefing.json` + `briefing-YYYY-MM-DD.json` (JST date via
  `editionDateParts`) + regenerates `editions.json` (list of dated files) into
  `public/AiDailyBriefing/`. `store.archiveBriefing()` (S3 in `aws` mode, else no-op).
  `logRun()` appends a line to `decisions.md`.
- `runLiveWithRetry()` wraps the whole `runLive` (3 attempts) for transient failures
  (e.g. `terminated` = mid-stream connection drop).
- The workflow then `git add` + commit + push → Vercel deploys.

### Japan grid supplier finder (`agent/japan-grid.js`) — SEPARATE, NOT merged with news
- **One agent** (not parallel). `web_search` with `max_uses = AIDB_GRID_MAX_SEARCHES`
  (default **16** — it's on-demand, so a generous budget).
- **Input:** the sourcing prompt (Japanese grid + data-center power manufacturers, major
  AND smaller, for US import/representation/brokering).
- **Output:** `public/JapanGrid/suppliers.json` (schema `schema/japan-grid.schema.json`).
- **Grounding is STRICTER than news:** every supplier's official website must resolve;
  a supplier whose site can't be verified is **dropped** (you can't contact a company you
  can't verify). Never fabricates personal contacts — only verified official sites/pages.
- Page: `public/JapanGrid/index.html` (static, groups by size: major/mid/smaller).

### Support modules (not standalone agents)
- `agent/prompt.js` — all prompt builders + `BEATS`.
- `agent/verify-sources.js` — link checker; `verifySources()` returns per-URL
  `{status, category: ok|blocked|dead|unknown}`.
- `agent/validate.js` — AJV validation against the briefing schema (uses `ajv/dist/2020.js`).
- `agent/mock.js` — dry-run generator (template freshen when no API key).
- `agent/store.js` — storage abstraction `file | aws` (DynamoDB+S3). **NOTE: this is
  leftover from an earlier AWS-storage decision that was SUPERSEDED by Supabase for
  feedback.** The daily run uses the `file` backend (archives are just the git-committed
  dated files). The `aws` DynamoDB backend is effectively unused. **Do not confuse this
  with the Supabase feedback store** (which is `api/feedback.js`, not `store.js`).
- `agent/review.js` — the "lite supervisor." **Currently reads a LOCAL
  `data/feedback.jsonl` via `store.js`, NOT Supabase.** Aggregates thumbs by region/cat/
  tag (joining `story_id` against dated editions), writes `preferences.proposed.md` +
  appends to `decisions.md`. It does deterministic counting only — **no LLM summarization
  of the free-text notes yet.** This is the seam the feedback agent must replace/extend
  (see ROADMAP.md).

## Supabase schema (verbatim — the SQL run in the Supabase SQL editor)

Project ref: `mydpyajfixytsjqjerqs` → URL `https://mydpyajfixytsjqjerqs.supabase.co`

```sql
create table if not exists feedback (
  id          bigint generated always as identity primary key,
  story_id    text,                    -- e.g. "g1", "j2"; NULL for daily free-text notes
  signal      text not null,           -- 'save' | 'feedback' | 'note'
  value       text,                    -- 'up' | 'down' | 'true' | 'false' (null for notes)
  note        text,                    -- free-text daily note (null for thumbs/save)
  edition     text,                    -- e.g. "EDITION No.421 · SYNCED 22:40 UTC"
  created_at  timestamptz not null default now()
);

-- RLS on with NO policies → only the server-side service_role key can read/write.
-- (The browser never touches Supabase directly; it POSTs to /api/feedback.)
alter table feedback enable row level security;
```

### What writes to this table, and when
- **NOT the daily run.** The daily news/grid runs do NOT write to Supabase.
- **`api/feedback.js`** (Vercel serverless `/api/feedback`) writes **one row per reader
  action**, when the page POSTs:
  - thumbs/save (React app): `{ story_id, signal: "save"|"feedback", value, note: null, edition }`
  - daily note (the bottom-left "✍ Note on today" widget): `{ story_id: null,
    signal: "note", value: null, note: <text>, edition }`
  - `created_at` defaults in the DB.
  - Needs Vercel env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (the service_role key).
    Confirmed working end-to-end 2026-06-28 (test rows landed).

### ⚠️ Populated but NOT read by any agent (the gap)
- **The entire `feedback` table is write-only right now.** Every column (`story_id`,
  `signal`, `value`, `note`, `edition`, `created_at`) is being captured but **no agent
  reads it.** `review.js` reads a local file, not Supabase. Closing this is the next
  build (ROADMAP.md).

## End-to-end data flow

```
TRIGGER
  ├─ daily-briefing.yml cron (20:00 UTC / 05:00 JST) or manual workflow_dispatch
  │
  ▼ RESEARCH (run.js)
  4 beat workers IN PARALLEL ──► ~28 candidates
        │
        ▼ MERGE
  editor agent (no tools) ──► selects/dedupes/tightens ──► briefing.json (schema v1)
        │
        ▼ GROUND
  enforceWorkingSources ──► every shown link resolves (stories kept, 403s kept)
        │
        ▼ EMIT + PUBLISH
  write briefing.json + briefing-<JST date>.json + editions.json
        │  git commit + push to main
        ▼ DEPLOY
  Vercel rebuilds ──► joeshsethi.com/AiDailyBriefing (page fetches briefing.json, no-store)
        │
        ▼ READ + FEEDBACK
  Joesh reads; taps 👍/👎/★ or writes a note
        │  page POST ──► /api/feedback (Vercel fn) ──► Supabase `feedback` table
        ▼
  [NOT YET BUILT] feedback agent reads Supabase ──► tunes preferences.md ──► next run
```

Separate, parallel cycle (NOT merged into the above):
```
japan-grid.yml (on-demand / weekly) ──► japan-grid.js (1 agent) ──► ground websites
  ──► suppliers.json ──► commit/push ──► Vercel ──► joeshsethi.com/JapanGrid
```

## Env vars / secrets / variables (reference)
- **GitHub Actions secret:** `ANTHROPIC_API_KEY` (used by all workflows).
- **GitHub repo Variables (optional tuning, empty = code default):** `AIDB_MODEL`,
  `AIDB_EFFORT`, `AIDB_MAX_SEARCHES`, `AIDB_GRID_MAX_SEARCHES`.
- **Vercel env:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (for `api/feedback.js`).
- **For the future feedback agent to READ Supabase:** it will need `SUPABASE_URL` +
  a Supabase key (service_role, or a read-only key) as **GitHub Actions secrets** (the
  service key currently lives only in Vercel). See ROADMAP.md.
- **Local dev:** `aidailybriefing/.env` with `ANTHROPIC_API_KEY` (+ optional
  `AIDB_OUT_DIR`). Currently the real key's local copy is in the *other* folder
  `/Users/joeshsethi/Claude/AI developments research agent/.env`.
