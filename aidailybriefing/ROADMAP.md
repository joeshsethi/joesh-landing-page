# ROADMAP.md — next builds

## ✅ DONE (2026-07-14): engine migration to Claude Code
Daily research moved from API credits to the Max plan — COMPLETE, same day:
- `/daily-briefing` skill + `agent/publish.js` + preferences v3 shipped (ed6ad7a).
- First engine run published edition No.432 (9 stories, 30/30 links verified
  first pass) — restoring the page after the API cron had FAILED silently since
  Jul 6 (exhausted API credits; 8 days stale).
- Scheduled task `daily-ai-briefing` created: daily 05:04 local (JST). NOTE: it
  is an app-local schedule — runs while the Claude Code app is open; if closed
  at fire time it runs on next launch. First run may pause on tool approvals;
  approvals persist to future runs afterward.
- `daily-briefing.yml` cron DISABLED (0f259d6); workflow_dispatch kept as the
  API fallback (needs a funded ANTHROPIC_API_KEY to work).

# Next build after that: the feedback agent

> Companion to CLAUDE.md + ARCHITECTURE.md. Plain text = certain; **[INFERRED]** =
> my read of Joesh's intent; **TODO: confirm with Joesh** = decide before building.

## The next build

A **feedback agent** that reads the stored Supabase feedback and tunes the research
agents toward Joesh's preferences over daily runs. Right now feedback is **captured but
never consumed** (see ARCHITECTURE.md → "Populated but NOT read"). This closes the loop.

Joesh's framing for the loop (quotes across the session):
- *"manual to start, and then eventually can be AI driven once i feel confident in the
  agents capabilities"* (first message).
- On the free-text note feature: *"have the agent summarize that to then update the
  preference.md accordingly... instead of it just being the light thumbs up or down mark."*
- He wants the loop to make it *"more focused towards me"* and to learn *"whats useful to
  me"* — but he also wants **human approval first** (the existing weekly-review workflow
  opens a PR for him to approve, matching "manual to start").

## The open design decision

**Does the feedback agent (A) edit the research agents' prompts/config — i.e.
`preferences.md` — or (B) store learned weights back in Supabase?**

- **Joesh's expressed leaning → (A), edit `preferences.md`, human-approved.** He said
  feedback should *"update the preference.md accordingly,"* and the whole architecture so
  far treats `preferences.md` as the single, inspectable steering file the workers + editor
  read every run. The existing `review.js` already writes `preferences.proposed.md` and
  opens a PR via `weekly-review.yml`. So the natural path: feedback agent → propose
  `preferences.md` edits → Joesh approves via PR → next run reflects them.
- **(B) "learned weights in Supabase" is NOT what he's asked for** and would be a black
  box (counter to the "concrete and inspectable, not a black box" value baked into the
  design). **[INFERRED]** he'd reject opaque weights. Treat (B) as **undecided / not
  preferred** unless Joesh says otherwise. **TODO: confirm with Joesh** before building
  if you're tempted toward (B).
- **TODO: confirm with Joesh:** when does it go from "propose + approve" to "auto-apply"?
  (He said auto only "once i feel confident.")

## The exact interface gap it must fill

The agent is essentially an **upgrade of `agent/review.js`**. Today `review.js`:
- READS a **local** `data/feedback.jsonl` (via `store.js`) — NOT Supabase.
- Aggregates thumbs **deterministically** by region/category/tag (joining `story_id`
  against the dated `briefing-*.json` editions to get each story's metadata).
- Does **no LLM summarization of the free-text `note` rows** — it only counts thumbs/saves.
- WRITES `preferences.proposed.md` + appends a section to `decisions.md`.

To close the loop, the feedback agent must:

1. **READ from Supabase** instead of the local file. Source table: **`feedback`**
   (project `mydpyajfixytsjqjerqs`). Columns to read: `story_id`, `signal`, `value`,
   `note`, `edition`, `created_at`. Query the last N days (e.g. 7-30).
   - Read path (mirror `api/feedback.js`'s write): `GET ${SUPABASE_URL}/rest/v1/feedback
     ?created_at=gte.<iso>&select=*` with headers `apikey` + `Authorization: Bearer
     <key>`. No new dependency needed (use `fetch`, like `api/feedback.js`).
   - **Needs `SUPABASE_URL` + a Supabase key as GitHub Actions secrets** — the
     service_role key currently lives only in Vercel. Add it (or a read-only key) to the
     repo's Actions secrets for `weekly-review.yml`. (RLS is on with no policies, so anon
     won't read — a service_role/secret key is required.) **TODO: confirm with Joesh** —
     add the existing service_role key as a GitHub secret, or mint a read-scoped key.

2. **Aggregate thumbs** (keep the existing region/cat/tag join against dated editions).

3. **Summarize the free-text `note` rows with an LLM** — this is new. A small
   `claude-sonnet-4-6` call: input = the week's notes + the thumb aggregates + current
   `preferences.md`; output = proposed concrete edits to `preferences.md` ("more X, less
   Y, go deeper on Z"). This is exactly the "agent summarizes my note → updates
   preferences" feature Joesh asked for.

4. **WRITE back:**
   - `preferences.proposed.md` (the proposal) — already the pattern.
   - Append a dated entry to `decisions.md` (the journal — "what changed and why").
   - On approval (PR merge), `preferences.md` is updated → workers + editor read it next run.
   - **Does NOT write to Supabase** (per leaning A). If Joesh later wants an audit trail of
     applied changes, that could be a new Supabase table — but undecided. **TODO.**

5. **Wire the schedule:** `weekly-review.yml` already exists and runs `review.js` weekly +
   opens a PR via `peter-evans/create-pull-request`. Point it at the upgraded agent and
   give it the Supabase secrets. **[INFERRED]** weekly cadence is fine (notes accumulate
   slowly); confirm.

## Prerequisite before building
- **Let real feedback accumulate first.** As of 2026-06-28 the table is essentially
  empty (only the verified test rows, since deleted). The agent's recommendations are only
  as good as the data. Joesh should use the 👍/👎/★ and the note box for a week or two
  before this is worth building. (Stated this session; he agreed.)

## Other backlog items (lower priority, noted this session)
- **Curated source list** in `preferences.md` (The Information, Stratechery, Bloomberg/
  Reuters/Nikkei, lab blogs, arXiv, Crunchbase/VC firms) to push "better than Google."
  Proposed, not done. **TODO: confirm with Joesh.**
- **Editor story cap** — v2 produced 10 stories vs the ~8-9 target; consider a hard cap.
- **Link from the briefing page → /JapanGrid** (asked; unanswered). **TODO.**
- **Grid agent category buckets** — the seed `suppliers.json` has verbose `category`
  strings (generated before the short-bucket prompt fix); the next grid run will use short
  buckets. Cosmetic.
- **`store.js` cleanup** — the unused AWS/DynamoDB backend is leftover scaffolding now that
  feedback is on Supabase; could be removed to reduce confusion. **[INFERRED]** safe to
  delete once the feedback agent reads Supabase directly; confirm.
- **Grid agent v2 (optional)** — if the single-agent grid list is thin on smaller players,
  parallelize by category like the news v2. Joesh chose "one agent" for v1.
