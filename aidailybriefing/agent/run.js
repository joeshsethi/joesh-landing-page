// Daily AI Briefing — research agent entrypoint.
//
//   node agent/run.js            live run (needs ANTHROPIC_API_KEY)
//   node agent/run.js --dry-run  freshen the template, no API call
//
// Pipeline (HANDOFF.md §3): gather -> verify -> summarize -> validate -> emit.
// Gather+verify+summarize happen inside one Claude run with web_search/web_fetch;
// validation and emit happen here. On a validation failure we give the model one
// chance to repair before failing the run (so a bad edition never ships).

import { writeFile, readFile, mkdir, appendFile } from "node:fs/promises";
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
  buildSystemPrompt,
  buildUserInstruction,
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

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.env.ANTHROPIC_API_KEY;
  const now = new Date();

  if (dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.log("ℹ️  No ANTHROPIC_API_KEY found — running in dry-run mode (template freshen).");
  } else if (dryRun) {
    console.log("ℹ️  --dry-run passed — skipping the live research call.");
  }

  const briefing = dryRun ? await runDryRun(now) : await runLive(now);

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

  const dateStamp = now.toISOString().slice(0, 10);
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

// ── Live run: Claude + web tools, one repair retry on invalid JSON. ──
async function runLive(now) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY

  const [preferences, schema] = await Promise.all([loadPreferences(), loadSchema()]);
  const system = buildSystemPrompt({ preferences, schema });
  const dateLabel = `${DAY[now.getUTCDay()]} · ${MON[now.getUTCMonth()]} ${now.getUTCDate()} ${now.getUTCFullYear()}`;
  const editionNumber = await nextEditionNumber();

  const messages = [
    {
      role: "user",
      content: buildUserInstruction({
        dateLabel,
        editionNumber,
        nowIso: now.toISOString(),
        tzLabel: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")} UTC`,
      }),
    },
  ];

  let raw = await runConversation(client, system, messages);
  let parsed = tryParseJson(raw);

  // One repair pass if the model returned something that isn't clean JSON or
  // doesn't validate — feed the error back and ask for a corrected object only.
  if (!parsed || !(await validateBriefing(parsed)).valid) {
    const reason = parsed
      ? (await validateBriefing(parsed)).errors.join("; ")
      : "the response was not parseable JSON";
    console.warn(`⚠️  First output invalid (${reason}). Requesting a repair...`);
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        `That response did not validate against the schema (${reason}). ` +
        `Reply with ONLY the corrected, complete JSON object — no commentary, no fences. ` +
        `Do not drop any verified stories; just fix the structure.`,
    });
    raw = await runConversation(client, system, messages, { tools: false });
    parsed = tryParseJson(raw);
  }

  if (!parsed) {
    console.error("❌ Could not parse a JSON briefing from the model output.");
    process.exit(1);
  }
  return parsed;
}

// Runs one streamed Claude turn, handling server-tool pause_turn continuations,
// and returns the concatenated text of the final assistant message.
async function runConversation(client, system, messages, { tools = true } = {}) {
  // Cap tool calls so the agent can't run away searching — the main cost driver.
  const tooling = tools
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: MAX_SEARCHES },
      ]
    : undefined;

  // Cache the (large, stable) system prompt so it isn't re-billed on every
  // tool round / pause_turn continuation within a run.
  const cachedSystem = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];

  let convo = messages;
  for (let i = 0; i < 8; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system: cachedSystem,
      messages: convo,
      ...(tooling ? { tools: tooling } : {}),
    });
    const message = await stream.finalMessage();

    // Server-side tools (web search/fetch) can pause after 10 internal
    // iterations; re-send to let the server resume where it left off.
    if (message.stop_reason === "pause_turn") {
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
}

main().catch((err) => {
  console.error("❌ Agent run failed:", err?.message || err);
  process.exit(1);
});
