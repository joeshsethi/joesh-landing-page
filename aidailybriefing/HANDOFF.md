# Daily AI Briefing — Build & Deploy Handoff

This package contains a finished **front-end** (`Daily AI Briefing.dc.html`, plus a
self-contained `Daily AI Briefing.html`) and a sample data file (`briefing.json`).

The front end is **data-driven**: on load it fetches `briefing.json` from the same
directory and renders it. If the fetch fails it shows an embedded fallback edition, so
the page never breaks. Your job (ideal for Claude Code) is to build the two missing
pieces:

1. **A daily research agent** that produces a fresh `briefing.json`.
2. **Hosting + a scheduler** so it runs every morning and the page lives at
   `joeshsethi.com/AiDailyBriefing`.

Optionally, **3. a feedback endpoint** to capture the reader's 👍/👎/★ signals and feed
them back into the agent for personalization.

---

## 1. How the front end consumes data

- The page fetches `briefing.json` (no-store) on load and on the **Refresh** button.
- `?date=YYYY-MM-DD` in the URL makes it fetch `briefing-YYYY-MM-DD.json` instead — this
  is the archive hook (a date-picker can be added later; the mechanism already works).
- Reader signals (**Useful / Not for me / Save**) persist to `localStorage` and, if
  `window.AIDB_FEEDBACK_URL` is defined, are POSTed there too (see §4).

**So the daily job's only hard requirement is: overwrite `briefing.json` each morning.**
Keep the standalone `Daily AI Briefing.html` only as an offline demo — the live page
should be the un-bundled build (or re-bundle with a fetch shim) so it can fetch JSON.

### Deployment shape (recommended)
```
joeshsethi.com/AiDailyBriefing/
  index.html            ← the briefing front end (from Daily AI Briefing.dc.html build)
  support.js            ← required runtime (ships beside the .dc.html)
  briefing.json         ← overwritten daily by the agent  ← THE ONLY MOVING FILE
  briefing-2026-06-18.json   ← optional dated archive copies
```
A static host (the same one serving joeshsethi.com, or Vercel/Netlify/GitHub Pages on a
subpath) serves these files. Browser refresh re-fetches `briefing.json` → newest news.

---

## 2. The `briefing.json` schema

`briefing.json` is the contract between the agent and the page. Match it exactly.
A valid example ships in this package. Shape:

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-18T06:58:00+09:00",   // ISO 8601
  "meta": {
    "brandLabel":   "AI Briefing — World & Japan",
    "dateLabel":    "Thu · Jun 18 2026",
    "editionLine":  "EDITION №412 · SYNCED 06:58 JST",
    "greeting":     "Good morning.",
    "intro":        "Nine developments worth your time …",        // 1–2 sentences, in the masthead
    "briefingTitle":"What the headlines aren't telling you",       // headline of the highlights card
    "summary":      "Today's frontier news is really about …",      // 3–5 sentence highlights blurb (the dark card)
    "footerLeft":   "Delivered daily · 07:00 JST",
    "footerRight":  "9 stories · 25 sources linked"
  },
  "gaps": [              // Japan-vs-frontier tracker (0–100 each)
    { "label": "Compute capacity", "jp": 32, "frontier": 95, "note": "…" }
  ],
  "items": [             // the story cards
    {
      "id": "g1",                         // stable, unique per story
      "region": "global",                 // "global" | "japan"
      "cat": "research",                  // "launches" | "funding" | "research" | "hardware"
      "source": "OpenAI",                 // lead outlet shown on the card
      "time": "Jun 16",                   // short date label, or "Upcoming"
      "headline": "…",
      "dek": "1-sentence summary",
      "analysis": {
        "happening": "What happened, with concrete facts/numbers.",
        "now":       "Why it matters now — the 'so what', incl. honest caveats.",
        "future":    "What's next / what to watch."
      },
      "sources": [                        // 2–4 SPECIFIC article links (never a homepage)
        { "name": "OpenAI", "title": "Exact article title", "url": "https://…" }
      ],
      "tags": ["OpenAI", "AI Safety", "Evaluation"]
    }
  ]
}
```

**Rules that keep quality high (learned the hard way):**
- `meta.summary` is the only "editorial voice" field now (the audio/video player was removed). Keep it to **3–5 plain sentences** that connect the day's stories into one through-line.
- Every `sources[].url` must be a **specific article**, not a homepage or a search query.
- Prefer **primary / reputable** sources (company blog, Bloomberg, CNBC, Reuters, Nikkei,
  the lab's own post). Aggregators only when nothing better exists.
- Put **real numbers and dates** in `analysis`, and include the **caveat / reality check**
  (pass rates, open questions) — that honesty is the whole value.
- Never invent a product, company, or stat. If a story is rumored/upcoming, label it
  (`time: "Upcoming"`) and say so in `happening`.
- Always include the **Japan** angle: 3–4 Japan items + keep the `gaps` tracker current.

---

## 3. The daily research agent (spec)

A scheduled script (Python or Node) that runs ~06:30 JST and writes `briefing.json`.

**Pipeline:**
1. **Gather** — pull the last ~24–48h of AI news. Options: an LLM with web search /
   tool use (Claude with web search, or a search API like Brave/Tavily/SerpAPI feeding
   the LLM), RSS from chosen outlets, the OpenAI/Anthropic/Google/Sakana/Rapidus blogs.
2. **Filter & rank** — keep ~5 global + ~3–4 Japan stories. Bias toward: model/product
   launches, funding/deals, research breakthroughs, hardware/compute (the reader's
   chosen categories). Apply the **preferences file** (§4) as ranking instructions.
3. **Verify** — for each kept story, confirm it against ≥2 sources and capture the exact
   article URLs. Drop anything you can't source. (This is the step that prevents the
   "fake story / Google-search link" failure.)
4. **Summarize** — write `analysis.{happening,now,future}` per the rules above, the 3–5
   sentence `meta.summary` highlights blurb, and refresh `gaps`.
5. **Emit** — write `briefing.json` (and a dated copy `briefing-<date>.json`), validate
   against the schema, then deploy/commit.

**Suggested agent system-prompt seed** (Claude Code can drop this into the script):
> You are the editor of a daily AI briefing for one reader who wants to stay informed,
> with a deliberate spotlight on Japan's AI developments and its gaps vs the global
> frontier. Each morning, select the most important AI developments from the last 24–48
> hours: ~5 global + ~3–4 Japan. For each, verify against at least two reputable sources
> and record the exact article URLs (never homepages or search links). Write three short
> analytical paragraphs — what's happening, why it matters now (with honest caveats and
> real numbers), and what's next. Then write a 3–5 sentence `meta.summary` that connects
> the day's stories into one through-line. Maintain the
> Japan-vs-frontier gap scores. Output strictly valid JSON matching schema v1. Apply the
> reader's preferences file as ranking and tone guidance. Never fabricate.

**Audio/video — deferred.** The hero audio/video player was removed; the page now leads
with the short text `meta.summary`. Revisit a narrated/video brief only after the written
summary has been iterated on and is consistently strong (the reader's explicit call).

---

## 4. Feedback loop → personalization (optional but recommended)

The front end already emits signals. To capture them:

1. Set `window.AIDB_FEEDBACK_URL = "https://…/feedback"` (inline script in `index.html`).
2. The page POSTs JSON: `{ id, signal: "save"|"feedback", value, edition, ts }`.
3. A tiny endpoint (cloud function + a row store / KV / a flat JSONL file) appends these.
4. Each morning, the agent reads aggregated signals and updates a **`preferences.md`**
   file in plain English, e.g.:
   > Joesh consistently saves Japan hardware + policy stories and marks generic US
   > funding "not for me." Lead with Japan; go deeper on semiconductors and METI policy;
   > keep funding to one item unless it's >$1B or Japan-related; investor lens preferred.
5. The agent reads `preferences.md` at step 2 (filter & rank) and step 4 (tone). That's
   the adaptation loop — concrete and inspectable, not a black box.

**Honest note for the reader:** the deployed page does **not** retrain itself. It gets
better in two ways — (a) the preferences file above, updated daily from your signals, and
(b) periodic human-in-the-loop tuning of the agent's prompt + source list. Schedule a
~monthly review to refine both.

---

## 5. Suggested stack (fastest credible path)
- **Repo + schedule:** GitHub repo; **GitHub Actions** cron (`schedule:` cron at 21:30
  UTC = 06:30 JST) runs the agent script.
- **Agent:** Node or Python script calling Claude (with web search/tool use) + a search
  API for breadth; validates JSON with a schema check before writing.
- **Publish:** Action commits `briefing.json` to the `AiDailyBriefing/` path, or uploads
  to the host serving joeshsethi.com. (If joeshsethi.com is on a platform like
  Vercel/Netlify, deploy the folder there under that route.)
- **Feedback:** one serverless function + KV store; or skip at first and rely on
  localStorage-only, adding the endpoint later.
- **Secrets:** API keys live in the CI/host secret store — never in the page.

## 6. Acceptance checks
- [ ] `briefing.json` validates against schema v1 (no `chapters`/`transcript`); `items`
      non-empty; `meta.summary` is 3–5 sentences; every `sources[].url` is a reachable
      specific article.
- [ ] Page at `/AiDailyBriefing` loads, plays audio, filters, expands, Save/feedback work.
- [ ] Refreshing after a new run shows the new edition (check `meta.editionLine`).
- [ ] Japan section + gaps render; 3–4 Japan items present.
- [ ] No fabricated entities or stats (spot-check against the cited sources).
