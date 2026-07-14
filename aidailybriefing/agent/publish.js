// Publish a finished briefing JSON — engine-agnostic (used by the Claude Code
// /daily-briefing skill; run.js has its own inlined copy of this logic).
//
//   node agent/publish.js <briefing.json>              validate → strip dead links → publish
//   node agent/publish.js --check <briefing.json>      validate + link report only (no writes)
//   node agent/publish.js --no-journal <briefing.json> publish without a decisions.md entry
//
// Exit codes: 0 ok · 1 schema invalid · 2 usage · 3 (--check only) broken links found.
//
// Grounding rule (same as run.js): never SHOW a broken link, never DROP a story.
// "Dead" = HTTP 404/410, or a DNS/connection failure that persists on a re-check.
// Paywalled/blocked (401/403/429/451) and 5xx/timeouts are real-but-gated: KEPT.
//
// Output dir: ../public/AiDailyBriefing (the served dir) unless AIDB_OUT_DIR is set
// (relative to the aidailybriefing folder — e.g. AIDB_OUT_DIR=tmp/test for tests).

import { writeFile, readFile, readdir, mkdir, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { validateBriefing } from "./validate.js";
import { verifySources } from "./verify-sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = join(__dirname, "..");
const OUT_DIR = process.env.AIDB_OUT_DIR
  ? join(AGENT_ROOT, process.env.AIDB_OUT_DIR)
  : join(AGENT_ROOT, "..", "public", "AiDailyBriefing");

// Editions are dated in JST (this is a 05:00-JST-morning product; see run.js).
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const jstDateStamp = (now) => new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

// Links that genuinely don't resolve: HTTP 404/410, or a DNS/connection failure
// that persists on re-check. (Same logic as run.js deadSources.)
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

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const noJournal = args.includes("--no-journal");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node agent/publish.js [--check] [--no-journal] <briefing.json>");
    process.exit(2);
  }

  const briefing = JSON.parse(await readFile(resolve(file), "utf8"));

  // ── Gate 1: schema. A bad edition never ships. ──
  const { valid, errors, warnings } = await validateBriefing(briefing);
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (!valid) {
    console.error("❌ Schema validation failed:");
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log("✅ Schema valid.");

  // ── Gate 2: grounding. ──
  const bad = await deadSources(briefing);
  if (checkOnly) {
    if (bad.length === 0) {
      console.log("🔗 All source links resolve (paywalled/403 kept as valid).");
      process.exit(0);
    }
    console.log(`⚠️  ${bad.length} broken link(s) — replace via fresh search or remove; re-run --check:`);
    for (const b of bad) console.log(`   - story ${b.itemId}: ${b.url}  [${b.status}]`);
    process.exit(3);
  }

  if (bad.length > 0) {
    const badSet = new Set(bad.map((b) => b.url));
    console.warn(`⚠️  Stripping ${badSet.size} still-broken link(s); stories kept intact.`);
    briefing.items = briefing.items.map((it) => ({
      ...it,
      sources: (it.sources || []).filter((s) => !badSet.has(s.url)),
    }));
  } else {
    console.log("🔗 All shown source links resolve (paywalled/403 kept as valid).");
  }

  // ── Emit: briefing.json + dated archive + regenerated editions index. ──
  const now = new Date();
  const dateStamp = jstDateStamp(now);
  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(briefing, null, 2) + "\n";
  await writeFile(join(OUT_DIR, "briefing.json"), json);
  await writeFile(join(OUT_DIR, `briefing-${dateStamp}.json`), json);
  const files = await readdir(OUT_DIR);
  const dates = files
    .map((f) => (f.match(/^briefing-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
    .filter(Boolean)
    .sort()
    .reverse();
  await writeFile(join(OUT_DIR, "editions.json"), JSON.stringify(dates, null, 2) + "\n");

  // ── Journal (best-effort; never fail a publish over it). ──
  const japan = briefing.items.filter((i) => i.region === "japan").length;
  if (!noJournal) {
    const line =
      `- ${now.toISOString()} — live run · ${briefing.items.length} stories (${japan} JP) · ` +
      `${briefing.meta?.editionLine || "?"} · engine claude-code · store file\n`;
    try {
      await appendFile(join(AGENT_ROOT, "decisions.md"), line);
    } catch {}
  }

  console.log(`✅ Published ${briefing.items.length} stories (${japan} JP) to ${OUT_DIR} (edition ${dateStamp}).`);
}

main().catch((err) => {
  console.error("❌ Publish failed:", err?.message || err);
  process.exit(1);
});
