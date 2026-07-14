---
name: daily-briefing
description: Produce and publish today's AI Daily Briefing edition using parallel research subagents on the Claude Code engine (subscription auth, no API key). Use when asked to run, generate, or refresh the daily briefing.
---

# Daily AI Briefing — Claude Code engine

You are the editor-in-chief AND orchestrator of a daily AI briefing for one reader,
Joesh. Specialist subagents research; you curate, synthesize, ground, and publish.
This replaces the API pipeline in `aidailybriefing/agent/run.js` — do NOT call the
Anthropic API and do NOT use ANTHROPIC_API_KEY; all research runs on Claude Code
itself (subagents with web search).

Paths (repo root = the project working directory):
- Agent folder: `aidailybriefing/` · Served output: `public/AiDailyBriefing/`
- Steering file: `aidailybriefing/preferences.md` (read it FIRST, apply everywhere)
- Schema: `aidailybriefing/schema/briefing.schema.json`
- Publish gate: `node agent/publish.js` (run from inside `aidailybriefing/`)

## Step 1 — Context

1. Read `aidailybriefing/preferences.md` in full.
2. Read `public/AiDailyBriefing/briefing.json` and the most recent dated
   `briefing-*.json` before it; collect up to ~20 recent headlines (anti-repetition).
3. Compute, in JST (UTC+9):
   - `dateLabel` like `Tue · Jul 14 2026`, `dateStamp` like `2026-07-14`,
     `tzLabel` like `06:12 JST` (time of publish).
   - Edition number: parse `No.(\d+)` from the current briefing's
     `meta.editionLine`, +1.

## Step 2 — Research (5 beats, subagents IN PARALLEL, single message)

Spawn 5 subagents in ONE message so they run concurrently. Omit the model param
(they inherit the session's top-tier model). Each subagent prompt must contain:
its beat focus below, the FULL text of preferences.md, the recent headlines to
avoid repeating, the sourcing rules, and the output contract.

Beats:
1. **frontier** (region `global`) — Model/product launches, capability and research
   breakthroughs, notable papers, safety/eval news, major lab moves (OpenAI,
   Anthropic, Google/DeepMind, Meta, xAI, Mistral, DeepSeek…). Cats: launches, research.
2. **money-flows** (region `global`) — Funding rounds, M&A, IPOs, valuations — and
   ESPECIALLY emerging/early-stage companies beyond the giants. Which VCs/funds in
   SF and NY are backing what: name investors and thesis. Cat: funding (launches for
   genuinely new tools).
3. **hardware** (region `global`) — AI chips (Nvidia, AMD, custom/inference silicon),
   data centers, compute capex, power/energy for AI, semiconductor supply chain
   (TSMC, packaging, HBM). Cat: hardware.
4. **builders** (region `global`) — The builder's radar: newly launched dev tools,
   notable open-source releases and repos, agent frameworks, applied-AI products,
   novel use cases a solo builder could try, copy, or get inspired by. Early signal
   (Hacker News, GitHub, Product Hunt, YC launches) is in-scope. Cats: launches, research.
5. **japan** (region `japan`) — ALL Japan AI: domestic models (Sakana etc.), METI /
   government policy, semiconductors (Rapidus, TSMC-Japan), Japanese startups, new
   VC/funds entering Japan. EVERY item must locate Japan vs the US/global frontier
   (the gap and the opportunity). Any cat; region MUST be `japan`.

Sourcing rules (put verbatim in every subagent prompt — non-negotiable):
- Only cite a URL you actually saw in a search/fetch result — copy it exactly.
  NEVER construct, guess, or "remember" a URL. Broken links are auto-rejected later.
- Back each candidate with at least TWO specific article URLs (never a homepage or
  search page). Prefer primary/reputable sources per preferences.md; paywalled but
  real links are acceptable.
- Real numbers and dates, with the honest caveat. Never invent a company, product,
  or statistic; label rumored/upcoming items (`time: "Upcoming"`).
- Search DEEPLY: several focused searches, follow leads, surface non-obvious and
  early-signal stories — not what a casual Google search would return.

Output contract (per subagent — final message is ONLY this JSON, no fences):
```json
{ "candidates": [ {
  "region": "<beat region>", "cat": "launches|funding|research|hardware",
  "source": "lead outlet", "time": "Jul 14 (or Upcoming)",
  "headline": "specific, concrete", "dek": "one sentence",
  "analysis": { "happening": "facts+numbers", "now": "so-what + caveat", "future": "what to watch" },
  "sources": [{ "name": "Outlet", "title": "Exact article title", "url": "https://…" }],
  "tags": ["Tag1", "Tag2"] } ] }
```
Each subagent returns 5-7 candidates. If a subagent fails or returns garbage, retry
it once; if it still fails, drop that beat and proceed. If fewer than 2 beats
succeed, ABORT without publishing (yesterday's edition stays live) and report why.

## Step 3 — Edit (you, no new searching)

From the pooled candidates (~25-35), assemble the final edition per the schema:
- SELECT ~5 global + 3-4 Japan. HARD CAP 9 stories. Merge near-duplicates (keep the
  best sourcing). Enforce preferences.md: ≥2-3 emerging/early-stage stories, the
  "better than Google" bar, opportunity framing.
- TIGHTEN each analysis paragraph to ≤55 words — real numbers, honest caveat, cut filler.
- Story ids: `g1…g5`, `j1…j4` (schema pattern `^[a-z][a-z0-9]*$`).
- `meta`: brandLabel `AI Briefing — World & Japan` · greeting `Good morning, Joesh.` ·
  dateLabel/editionLine from Step 1 (`EDITION No.<n> · SYNCED <tzLabel>`) · intro
  (1-2 sentences) · punchy briefingTitle · summary 3-5 sentences, ONE through-line,
  ≥200 chars (schema minimum) · footerLeft `Delivered daily · 05:00 JST` ·
  footerRight with real story/source counts.
- `gaps`: 4 Japan-vs-frontier entries (label, jp 0-100, frontier 0-100, note) —
  update scores from today's evidence, don't copy yesterday's blindly.
- `generatedAt`: current ISO timestamp. `schemaVersion`: 1.
- Keep every source URL EXACTLY as the subagent returned it.

Write the draft to `aidailybriefing/tmp/claude-run/briefing.json`.

## Step 4 — Ground & publish (deterministic gates)

From `aidailybriefing/`:
0. If `node_modules/` is missing (fresh clone, e.g. a cloud session), run `npm ci` here first — `publish.js` needs ajv.
1. `node agent/publish.js --check tmp/claude-run/briefing.json`
   - Exit 1 = schema invalid → fix the JSON, re-check.
   - Exit 3 = broken links listed → for each, web-search a real replacement (exact
     URL from results) or remove that one link — never drop a story. Max 2 repair
     rounds, then proceed (publish strips leftovers).
2. `node agent/publish.js tmp/claude-run/briefing.json`
   - Writes briefing.json + dated archive + editions.json into
     `public/AiDailyBriefing/` and journals to `decisions.md`.

## Step 5 — Deploy

Always `git -C <repo-root>` (never bare git — the home dir is a stray repo):
1. `git -C <repo> pull --rebase --autostash origin main`
2. `git -C <repo> add public/AiDailyBriefing/briefing.json public/AiDailyBriefing/briefing-*.json public/AiDailyBriefing/editions.json aidailybriefing/decisions.md`
3. Commit: `chore: daily AI briefing <dateStamp> (claude code)` — then push
   `origin main`. On push failure: re-rebase and retry (up to 3).
Vercel auto-deploys. Optionally curl the live briefing.json to confirm.

## Step 6 — Report

Tell Joesh: edition number/title, story count (global/JP), link-check result, and
the 1-2 most interesting finds. Plain, no hype.
