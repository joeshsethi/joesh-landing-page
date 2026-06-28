// Daily AI Briefing — research agent entrypoint.
//
//   node agent/run.js            live run (needs ANTHROPIC_API_KEY)
//   node agent/run.js --dry-run  freshen the template, no API call
//
// Pipeline (HANDOFF.md §3): gather -> verify -> summarize -> validate -> emit.
// Gather+verify+summarize happen inside one Claude run with web_search/web_fetch;
// validation and emit happen here. On a validation failure we give the model one
// chance to repair before failing the run (so a bad edition never ships).

import { writeFile, readFile, readdir, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateBriefing } from "./validate.js";
import { generateMockBriefing } from "./mock.js";
import { getStore } from "./store.js";
import { verifySources, reportSourceCheck } from "./verify-sources.js";
import {
  loadPreferences,
  loadSchema,
  BEATS,
  buildWorkerPrompt,
  buildWorkerInstruction,
  buildEditorSystemPrompt,
  buildEditorInstruction,
} from "./prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const OUT_DIR = process.env.AIDB_OUT_DIR
  ? join(REPO_ROOT, process.env.AIDB_OUT_DIR)
  : join(REPO_ROOT, "site", "AiDailyBriefing");
// Cost knobs (override via env / GitHub secrets):
//   AIDB_MODEL       claude-sonnet-4-6 (default) — ~40% cheaper than Opus, plenty
//                    capable for news. Set to claude-opus-4-8 for max quality.
//   AIDB_EFFORT      medium (default) — lower effort = fewer searches + less thinking.
//   AIDB_MAX_SEARCHES cap on web_search/web_fetch calls per run (default 8). The
//                    biggest lever: it was running ~48 searches/run.
const MODEL = process.env.AIDB_MODEL || "claude-sonnet-4-6";
const EFFORT = process.env.AIDB_EFFORT || "medium";
const MAX_SEARCHES = Number(process.env.AIDB_MAX_SEARCHES || 8);

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// This is a "06:30 JST morning" product, so label and file editions in JST — not UTC.
// (The 06:30 JST run fires at 21:30 UTC the previous day; UTC stamping made it look a
// day behind and made the morning edition appear missing.)
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function editionDateParts(now) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS); // shift, then read UTC fields = JST wall-clock
  const pad = (n) => String(n).padStart(2, "0");
  return {
    dateLabel: `${DAY[jst.getUTCDay()]} · ${MON[jst.getUTCMonth()]} ${jst.getUTCDate()} ${jst.getUTCFullYear()}`,
    dateStamp: jst.toISOString().slice(0, 10),
    tzLabel: `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())} JST`,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.env.ANTHROPIC_API_KEY;
  const now = new Date();

  if (dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.log("ℹ️  No ANTHROPIC_API_KEY found — running in dry-run mode (template freshen).");
  } else if (dryRun) {
    console.log("ℹ️  --dry-run passed — skipping the live research call.");
  }

  const briefing = dryRun ? await runDryRun(now) : await runLiveWithRetry(now);

  // ── Validate before writing anything (the gate). ──
  const { valid, errors, warnings } = await validateBriefing(briefing);
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (!valid) {
    console.error("❌ Generated briefing failed schema validation:");
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }

  // ── Optional: check every source URL is reachable before publishing. ──
  //    --verify-sources  report dead/unknown links (warn only)
  //    --strict-sources  also block the publish if any link is definitively dead
  const wantVerify = process.argv.includes("--verify-sources") || process.argv.includes("--strict-sources");
  if (wantVerify) {
    const summary = reportSourceCheck(await verifySources(briefing));
    if (process.argv.includes("--strict-sources") && summary.dead.length > 0) {
      console.error(`❌ ${summary.dead.length} dead source link(s) — refusing to publish (--strict-sources).`);
      process.exit(1);
    }
  }

  const { dateStamp } = editionDateParts(now);
  await emit(briefing, dateStamp);

  // Durable archive (S3 in aws mode; no-op in file mode since the dated copy is
  // already committed) + a journal entry so every run is visible in decisions.md.
  const store = getStore();
  await store.archiveBriefing(dateStamp, JSON.stringify(briefing, null, 2) + "\n");
  await logRun({ briefing, now, dryRun, store: store.backend });

  const japan = briefing.items.filter((i) => i.region === "japan").length;
  console.log(`✅ Wrote ${briefing.items.length} stories (${japan} from Japan) to ${OUT_DIR}`);
}

// Append a one-line run record to decisions.md (the journal).
async function logRun({ briefing, now, dryRun, store }) {
  const decisions = join(REPO_ROOT, "decisions.md");
  const japan = briefing.items.filter((i) => i.region === "japan").length;
  const line =
    `- ${now.toISOString()} — ${dryRun ? "DRY-RUN" : "live"} run · ` +
    `${briefing.items.length} stories (${japan} JP) · ` +
    `${briefing.meta?.editionLine || "?"} · model ${MODEL} · store ${store}\n`;
  try {
    if (!existsSync(decisions)) {
      await writeFile(decisions, "# Decisions log\n\n## Daily runs\n");
    }
    await appendFile(decisions, line);
  } catch {
    // Logging is best-effort; never fail a run over the journal.
  }
}

// ── Dry run: freshen the current/template briefing. ──
async function runDryRun(now) {
  const current = join(OUT_DIR, "briefing.json");
  const fallback = join(REPO_ROOT, "briefing.json"); // original sample shipped in the package
  const templatePath = existsSync(current) ? current : fallback;
  return generateMockBriefing({ templatePath, now });
}

// ── Live run (v2): parallel beat workers → editor → grounding. ──
async function runLive(now) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY

  const [preferences, schema] = await Promise.all([loadPreferences(), loadSchema()]);
  const { dateLabel, tzLabel } = editionDateParts(now);
  const editionNumber = await nextEditionNumber();
  const recentHeadlines = await loadRecentHeadlines(); // for anti-repetition

  // 1. Specialist workers each go deep on their beat, in parallel. A worker that
  //    fails entirely is dropped; the editor proceeds with the rest.
  console.log(`🔎 Researching ${BEATS.length} beats in parallel…`);
  const settled = await Promise.allSettled(
    BEATS.map((beat) => gatherBeat(client, beat, { preferences, recentHeadlines })),
  );
  const candidates = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      candidates.push(...res.value);
      console.log(`   ✅ ${BEATS[i].label}: ${res.value.length} candidates`);
    } else {
      console.warn(`   ⚠️  ${BEATS[i].label} failed: ${res.reason?.message || res.reason}`);
    }
  });
  if (candidates.length === 0) throw new Error("All beat workers failed — no candidates gathered.");

  // 2. Editor selects, dedupes, and tightens into the final briefing (no web tools —
  //    it works purely from the candidates the workers verified).
  console.log(`✍️  Editor assembling from ${candidates.length} candidates…`);
  const editorSystem = buildEditorSystemPrompt({ preferences, schema });
  const editorMsg = [
    { role: "user", content: buildEditorInstruction({ candidates, dateLabel, tzLabel, editionNumber, nowIso: now.toISOString() }) },
  ];
  let raw = await runConversation(client, editorSystem, editorMsg, { tools: false });
  let parsed = tryParseJson(raw);
  if (!parsed || !(await validateBriefing(parsed)).valid) {
    const reason = parsed ? (await validateBriefing(parsed)).errors.join("; ") : "the response was not parseable JSON";
    console.warn(`⚠️  Editor output invalid (${reason}). Requesting a repair…`);
    editorMsg.push({ role: "assistant", content: raw });
    editorMsg.push({
      role: "user",
      content: `That did not validate (${reason}). Reply with ONLY the corrected, complete JSON object — no commentary, no fences. Keep all source URLs verbatim.`,
    });
    raw = await runConversation(client, editorSystem, editorMsg, { tools: false });
    parsed = tryParseJson(raw);
  }
  if (!parsed) throw new Error("Editor could not produce a parseable JSON briefing.");

  // 3. Grounding: every shown link must resolve (stories are never dropped).
  parsed = await enforceWorkingSources(client, parsed);
  return parsed;
}

// One specialist worker: deep-searches its beat and returns candidate items.
// Retries once on a transient failure; if it still fails, the caller drops this beat.
async function gatherBeat(client, beat, { preferences, recentHeadlines }) {
  const system = buildWorkerPrompt(beat, { preferences });
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const messages = [{ role: "user", content: buildWorkerInstruction(beat, { recentHeadlines }) }];
      const raw = await runConversation(client, system, messages, { tools: true });
      const candidates = tryParseJson(raw)?.candidates;
      if (!Array.isArray(candidates)) throw new Error("worker returned no candidates array");
      // Force the beat's region (workers occasionally drift on this field).
      return candidates.map((c) => ({ ...c, region: beat.region }));
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        console.warn(`   ↻ ${beat.label} attempt ${attempt} failed (${e?.message || e}); retrying…`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }
  throw lastErr;
}

// Grounding gate: we never SHOW a broken link, but we never drop a STORY over one.
// Pings every source; for any that 404 / dead-domain, asks the agent to replace it with
// a real one (or just remove that link) while keeping the story. After up to 2 repair
// rounds, strips any still-broken links — and keeps every story regardless of how many
// links remain (the summary stands on the verified research). Paywalled/403 links are
// real and are kept.
const GROUNDING_SYSTEM = `You fix broken source links in a news-briefing JSON. Use web_search \
to find real, working replacement article URLs (copy them exactly from results), or remove a \
link that can't be verified. NEVER drop a story, NEVER invent a URL. Keep paywalled/403 links \
(they're real). Output ONLY the corrected JSON object.`;

async function enforceWorkingSources(client, briefing) {
  for (let round = 1; round <= 2; round++) {
    const bad = await deadSources(briefing);
    if (bad.length === 0) {
      console.log("🔗 All shown source links resolve (paywalled/403 kept as valid).");
      return briefing;
    }
    console.warn(`⚠️  ${bad.length} broken source link(s) — fixing (round ${round})…`);
    const list = bad.map((b) => `  - story ${b.itemId}: ${b.url}  [${b.status}]`).join("\n");
    const messages = [
      {
        role: "user",
        content:
          `Here is a briefing JSON whose links need fixing:\n\n${JSON.stringify(briefing)}\n\n` +
          `These source links do NOT resolve (404 / dead / no-such-host):\n${list}\n\n` +
          `For EACH: find a real, working replacement via web_search and copy its exact URL, ` +
          `or remove that one link. Keep every story. Return ONLY the complete corrected JSON.`,
      },
    ];
    const raw = await runConversation(client, GROUNDING_SYSTEM, messages, { tools: true });
    const next = tryParseJson(raw);
    if (next && (await validateBriefing(next)).valid) briefing = next;
  }

  // Final enforcement: strip links that still don't resolve — but keep every story.
  const badSet = new Set((await deadSources(briefing)).map((b) => b.url));
  if (badSet.size > 0) {
    console.warn(`⚠️  Stripping ${badSet.size} still-broken link(s); stories kept intact.`);
    briefing.items = briefing.items.map((it) => ({
      ...it,
      sources: (it.sources || []).filter((s) => !badSet.has(s.url)),
    }));
  }
  return briefing;
}

// Links that genuinely don't resolve: HTTP 404/410, or a DNS/connection failure that
// persists on re-check (a fabricated or dead domain). Kept as valid: 2xx/3xx, 401/403/
// 429/451 (real but gated — e.g. paywalls), 5xx and timeouts (transient). The re-check
// avoids stripping a real link over a one-off network blip.
async function deadSources(briefing) {
  const { results } = await verifySources(briefing, { timeoutMs: 9000, concurrency: 6 });
  const isBroken = (r) => r.category === "dead" || r.status === "error";
  const candidates = results.filter(isBroken);
  if (candidates.length === 0) return [];

  const definite = candidates.filter((r) => r.category === "dead"); // 404/410 — no recheck needed
  const networkErrs = candidates.filter((r) => r.category !== "dead"); // DNS/connection — recheck
  if (networkErrs.length === 0) return definite;

  const recheck = await verifySources(
    { items: [{ id: "recheck", sources: networkErrs.map((r) => ({ name: "x", title: "x", url: r.url })) }] },
    { timeoutMs: 9000, concurrency: 6 },
  );
  const stillBroken = new Set(recheck.results.filter(isBroken).map((r) => r.url));
  return [...definite, ...networkErrs.filter((r) => stillBroken.has(r.url))];
}

// Headlines from the most recent published edition, to discourage repetition.
async function loadRecentHeadlines() {
  try {
    const current = JSON.parse(await readFile(join(OUT_DIR, "briefing.json"), "utf8"));
    return (current.items || []).map((i) => i.headline).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}

// Retry the whole research run on failure. The common failure is a transient
// mid-stream connection drop ("terminated") on the long streaming call — there's
// no partial state to resume, so a clean re-run is the fix. Also covers a one-off
// unparseable generation or an API overload/rate-limit. Attempt 2 almost always
// succeeds; if all attempts fail, we throw and leave yesterday's edition live.
async function runLiveWithRetry(now, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) console.log(`🔁 Research attempt ${attempt}/${attempts}…`);
      return await runLive(now);
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️  Attempt ${attempt}/${attempts} failed: ${e?.message || e}`);
      if (attempt < attempts) {
        const waitMs = 15000 * attempt; // 15s, then 30s backoff
        console.warn(`   retrying in ${waitMs / 1000}s…`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

// Runs one streamed Claude turn, handling server-tool pause_turn continuations,
// and returns the concatenated text of the final assistant message.
async function runConversation(client, system, messages, { tools = true } = {}) {
  // Use the stable web_search that does NOT run code execution. The newer
  // *_20260209 tools do "dynamic filtering" via a code-execution container,
  // which forces a fragile container_id hand-off across pause_turn and was
  // 400-ing every long run. This version can still pause_turn, but resuming
  // it needs no container — so that whole failure mode is gone.
  // max_uses caps searches (the main cost driver).
  const tooling = tools
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }]
    : undefined;

  // Cache the (large, stable) system prompt so it isn't re-billed on every
  // tool round / pause_turn continuation within a run.
  const cachedSystem = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];

  let convo = messages;
  let container; // code-execution container id (web search/fetch dynamic filtering)
  for (let i = 0; i < 12; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      // Generous headroom so adaptive thinking + the full ~9-story JSON never
      // truncate mid-object (you only pay for tokens actually generated).
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system: cachedSystem,
      messages: convo,
      ...(tooling ? { tools: tooling } : {}),
      // Reuse the same container across continuations — required once the search
      // tools' dynamic filtering (code execution) has pending tool uses.
      ...(container ? { container } : {}),
    });
    const message = await stream.finalMessage();

    // Server-side tools (web search/fetch) can pause after 10 internal
    // iterations; re-send to let the server resume where it left off. The
    // container id must be carried forward or the API 400s.
    if (message.stop_reason === "pause_turn") {
      if (message.container?.id) container = message.container.id;
      convo = [...convo, { role: "assistant", content: message.content }];
      continue;
    }
    return message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }
  throw new Error("Conversation did not converge (too many pause_turn continuations).");
}

function tryParseJson(text) {
  if (!text) return null;
  // Tolerate the occasional ```json fence even though we ask for none.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: grab the outermost {...}.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function nextEditionNumber() {
  try {
    const current = JSON.parse(await readFile(join(OUT_DIR, "briefing.json"), "utf8"));
    const m = /No\.?\s*(\d+)/i.exec(current?.meta?.editionLine || "");
    return m ? parseInt(m[1], 10) + 1 : 413;
  } catch {
    return 413;
  }
}

// Write briefing.json (the one moving file) + a dated archive copy.
async function emit(briefing, dateStamp) {
  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(briefing, null, 2) + "\n";
  await writeFile(join(OUT_DIR, "briefing.json"), json);
  await writeFile(join(OUT_DIR, `briefing-${dateStamp}.json`), json);
  await updateEditionsIndex();
}

// Maintain editions.json — the list of available dated editions, newest first.
// The page's "Past editions" picker reads this (a static host can't list files).
// Regenerated from the actual dated files each run, so it self-heals any drift.
async function updateEditionsIndex() {
  const files = await readdir(OUT_DIR);
  const dates = files
    .map((f) => (f.match(/^briefing-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
    .filter(Boolean)
    .sort()
    .reverse();
  await writeFile(join(OUT_DIR, "editions.json"), JSON.stringify(dates, null, 2) + "\n");
}

main().catch((err) => {
  console.error("❌ Agent run failed:", err?.message || err);
  process.exit(1);
});
