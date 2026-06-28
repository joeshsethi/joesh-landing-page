# CLAUDE.md — AI Daily Briefing (start here)

> Handoff written 2026-06-28 at the end of a long build session, while full context
> was available. Companion files: **ARCHITECTURE.md** (agents + data flow + Supabase
> schema) and **ROADMAP.md** (the next build: the feedback agent). Also see the
> original **README.md** in this folder, and **decisions.md** (the run journal).
> Markers: plain text = certain (built/observed this session); **[INFERRED]** = my
> read of Joesh's intent; **TODO: confirm with Joesh** = genuinely unknown.

## Project purpose

A daily AI-news briefing for one reader (Joesh), plus a separate Japan grid-equipment
supplier finder. It is also explicitly a **learning project** — Joesh's stated goals
(first message, quoted): *"get experience in developing a website/app with full front
and back end services"*, *"get experience in utilizing agents"*, *"better understand
the usecases of a full front/backend application and how i can use claude code to
develop it"*, and to be *"fed up to date news and current events on global AI
developments, both technical and financial markets"* with *"a specific Japan section"*
that *"analyses gaps and opportunities where AI developments are behind in Japan."*

Joesh is a full-stack developer (Accenture; the Comcast "garage" project), most
comfortable with AWS. He wants the briefing to eventually help him *"create/ pitch/ or
better understand"* AI opportunities — especially in Japan, where he'll be for ~1 month
(as of late June 2026).

## Where everything lives

- **Repo (local):** `/Users/joeshsethi/Claude/Joesh_Consulting_LandingPage`
- **Repo (remote):** `github.com/joeshsethi/joesh-landing-page` (a Vite + React site on Vercel)
- **The agent:** this folder, `aidailybriefing/` (its own `package.json`, NOT part of the Vite build)
- **The news page (served):** `public/AiDailyBriefing/` → live at **joeshsethi.com/AiDailyBriefing**
- **The grid page (served):** `public/JapanGrid/` → live at **joeshsethi.com/JapanGrid**
- **Feedback function:** `api/feedback.js` (repo root → Vercel serverless `/api/feedback`)
- **Feedback DB:** Supabase, project ref `mydpyajfixytsjqjerqs`, table `feedback`

## Joesh's research preferences (reconstructed, with his phrasing)

These live in `preferences.md` (the agent reads it every run). Key points and the
corrections he's given me across this session:

- **Investor lens + engineer lens.** Wants who's raising/shipping/winning, valuations,
  capex, public-market read-throughs — not just tech.
- **Emerging > giants (his sharpest steer).** He found pure frontier-giant coverage
  repetitive and, quote: *"eventually becomes pretty useless for me specifically,
  because i do not have any influence or ability to change/ make a play on any of these
  actions when billions of dollars are being involved."* He wants *"information that
  pretains to the smaller, new, up and comping companies"* and to *"look into investors
  portfolios or being aware of where money is flowing throughout newyork or
  sanfransisco"* — same lens for Japan (*"new investment companies moving to japan and
  starting to fund many small startups"*). End goal (quote): *"I want to see all the new
  ideas, and eventually this should be a way that i get inspired to create something for
  myself or have new ideas to pitch."* → preferences.md reserves **2-3 stories/edition
  for emerging/early-stage + follow-the-money**.
- **Japan, always.** 3-4 Japan items + the gaps tracker. Semiconductors (Rapidus, TSMC
  dependence), METI policy, Sakana/sovereign models, and **new VC/funds entering Japan +
  funded startups**.
- **Anti-repetition.** Quote: *"the last few days news have been pretty repetitive."*
  → run.js feeds the prior edition's headlines into the workers; don't rehash the same
  OpenAI/Anthropic/Nvidia storyline day-to-day unless materially new.
- **Sources / "better than Google."** Quote: *"I want something that provides me better
  news than what a simple google search would do."* The differentiation comes from
  per-beat depth + synthesis (see ARCHITECTURE). **[INFERRED]** he'd value a curated
  high-signal source list (The Information, Stratechery, Bloomberg/Reuters/Nikkei, lab
  blogs, arXiv, Crunchbase/VC firms) — proposed but NOT yet added. **TODO: confirm with
  Joesh** whether to add an explicit source list to preferences.md.
- **Links MUST be real (a hard correction he made twice).** Quote: *"without the links
  or without real data its pointing to, i and viewers can only assume the agent is
  making up its own bullshit... which makes this entire project useless."* Then the
  refinement that governs the current grounding rule, quote: *"you can still have the
  research shown and summaries shown as long as its true and from verified sources, even
  if the link cannot be proven to exist. BUT if you are going to put a link in there,
  just make sure its real and viewable! I dont want to lose information or have less news
  because the link isnt accessible for viewers (especially if the case is just because
  403 and not 404)."* → **Rule: never drop a STORY over a link; strip only links that
  404/dead-domain (re-checked); keep 403/paywalled links (real, just gated).**
- **Output: succinct.** Wants *"more + deeper searches"* but the synthesis to *"still be
  succinct and better thought out, as well as more focused towards me."* Editor targets:
  meta.summary 3-5 sentences; each analysis paragraph ≤55 words. Tone: plain, honest, no
  hype, real numbers, always the caveat/reality check.
- **Model:** Stay on **`claude-sonnet-4-6`**. He explicitly declined Opus 4.8 (quote:
  *"dont want to flip to opus 4.8 so lets remove that idea"*) — don't switch without asking.
- **Feedback he's given me on HOW to work (important):** I shipped code untested twice
  and it broke in CI; he was rightly frustrated (*"this... shouldve been fixed the last
  time i told you to"*). **Rule: always test the agent locally before pushing** (see
  Deploy below). Verify, don't assume.

## How to deploy updates (the workflow we use)

Everything ships through git → Vercel. Steps that have worked reliably this session:

1. **Edit** agent code in `aidailybriefing/` or page files in `public/`.
2. **Test locally BEFORE pushing** (non-negotiable). Run the agent against a scratch
   output dir so you don't clobber the live files, e.g.:
   ```bash
   cd aidailybriefing
   AIDB_OUT_DIR=tmp/test node --env-file=<path-to-.env-with-key> agent/run.js
   # then inspect tmp/test/briefing.json; verify links: node agent/verify-sources.js tmp/test/briefing.json
   ```
   The `.env` with the real `ANTHROPIC_API_KEY` used this session is at
   `/Users/joeshsethi/Claude/AI developments research agent/.env`. **TODO: confirm with
   Joesh** — for a clean setup, create `aidailybriefing/.env` from `.env.example` with
   the key (it's currently NOT in this folder).
3. **Commit only after a clean test.** Then sync + push:
   ```bash
   git -C <repo> pull --rebase --autostash origin main   # the daily bot commits to main; you'll be behind
   git -C <repo> add <files> && git -C <repo> commit -m "..."
   git -C <repo> push origin main
   ```
4. Vercel auto-deploys on push to `main`. Hard-refresh the page (⌘+Shift+R) — the page
   caches; the JSON updates underneath.

### Git gotchas learned this session (will bite a fresh session)
- The **home directory `~` is itself a stray git repo** — NEVER run git from there or let
  `git add` run against it. Always `git -C <repo>` on the project path explicitly.
- Installed **git is old (2.24)** — `git init -b <branch>` is unsupported (use plain init).
- Pushing **workflow files** (`.github/workflows/*`) needs a PAT with the **`workflow`**
  scope, not just `repo`.
- The bot commits editions to `main` daily, so **rebase before every push**.
- Harness quirk: the command-output capture sometimes errors ("temp filesystem full");
  workaround used all session = redirect output to a file and Read it.

## How cron + the agents work, and continuous updates via Claude Code

- **Cron (GitHub Actions, runs on GitHub's servers — no laptop/Claude Code needed):**
  - `daily-briefing.yml` — **20:00 UTC = 05:00 JST**. Runs `npm run briefing`, commits
    the new `briefing.json` + dated archive + `editions.json`, pushes → Vercel deploys.
    (Moved earlier from 21:30 UTC so it finishes before a ~07:00 JST read; a run takes
    ~30-70 min for v2.)
  - `weekly-review.yml` — Sunday; runs `review.js`. **Currently reads a local file, NOT
    Supabase — not functional for the real feedback loop yet** (see ROADMAP).
  - `japan-grid.yml` — on-demand (Run workflow) + weekly Monday.
- **Each run is independent, fresh research** — nothing is cached; a manual run now and
  tomorrow's cron both do brand-new searches.
- **Editions are dated/labeled in JST** (the 05:00 JST run is "today" in JST even though
  it's the prior day in UTC — `editionDateParts()` in run.js handles this).
- **How the agents research:** the agent is Claude (`claude-sonnet-4-6`) + the
  `web_search_20250305` tool (a general web index) + prompts. v2 runs 4 parallel
  specialist "beat" workers that each search deeply, then an editor synthesizes. See
  ARCHITECTURE.md.
- **Continuous updates via Claude Code:** you (a future session) edit files here, test
  locally, commit, push — Vercel redeploys. Tuning that needs NO code: GitHub repo
  **Variables** `AIDB_MODEL`, `AIDB_EFFORT`, `AIDB_MAX_SEARCHES`, `AIDB_GRID_MAX_SEARCHES`
  (all optional; empty = code defaults). Editorial tuning: edit `preferences.md`.

## Cost (observed/estimated this session)
- v2 daily run on Sonnet: roughly **$0.50–$1.50/run** (~32 searches across 4 workers +
  editor synthesis). Tunable down via `AIDB_MAX_SEARCHES` (per worker, default 8).
- Grid run: occasional/on-demand, ~16 searches.
- Keys/billing are on Joesh's Anthropic console (prepaid credits).

## Quick status (as of 2026-06-28)
- ✅ Daily briefing live + reliable (retry-hardened), v2 parallel agents shipped.
- ✅ Past-editions archive (`?date=` + picker), JST dating.
- ✅ Link grounding enforced (real/reachable links; stories never dropped).
- ✅ Feedback capture → Supabase (thumbs/save + free-text note widget). **Captured but
  NOT yet consumed by any agent.**
- ✅ Japan grid supplier finder at /JapanGrid (14 verified suppliers, separate cycle).
- ⏭️ Next: the **feedback agent** (ROADMAP.md).
- Open UX question: add a link from the briefing page to /JapanGrid? (I asked; unanswered.)
  **TODO: confirm with Joesh.**
