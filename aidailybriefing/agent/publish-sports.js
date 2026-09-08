// Publish the Sports Watch strip that renders under the daily AI briefing.
//
//   node agent/publish-sports.js <sports.json>           validate → strip dead links → publish
//   node agent/publish-sports.js --check <sports.json>   validate + link report only (no writes)
//
// Exit codes: 0 ok · 1 schema invalid · 2 usage · 3 (--check only) broken links found.
//
// Same grounding rule as the briefing: never SHOW a broken link. Unlike the
// briefing there is no dated archive — this is a rolling watchlist, not an
// edition, and it is DELIBERATELY allowed to be a few days stale (the page
// prints the scan date so a stale strip is honest rather than misleading).

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import Ajv from "ajv/dist/2020.js"; // draft 2020-12 meta-schema support
import addFormats from "ajv-formats";
import { verifySources } from "./verify-sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = join(__dirname, "..");
const SCHEMA_PATH = join(AGENT_ROOT, "schema", "sports.schema.json");
const OUT_DIR = process.env.AIDB_OUT_DIR
  ? join(AGENT_ROOT, process.env.AIDB_OUT_DIR)
  : join(AGENT_ROOT, "..", "public", "AiDailyBriefing");

async function validateSports(data) {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);
  return {
    valid,
    errors: valid ? [] : (validate.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`),
  };
}

// Wikis are rejected outright, even though they resolve fine. Joesh's steer:
// "prioritize sites like ESPN which gives you the overview already, instead of wiki
// links. more reliable." A wiki page lags anything in progress (leaderboards, draws,
// fixtures) — exactly what this strip is for. Enforced here, not just in the prompt.
const WIKI_HOST = /(^|\.)(wikipedia\.org|m\.wikipedia\.org|wikiwand\.com|fandom\.com|wikimedia\.org)$/i;
function wikiSources(doc) {
  const hits = [];
  for (const item of doc.items || []) {
    for (const s of item.sources || []) {
      let host = "";
      try { host = new URL(s.url).hostname; } catch { continue; }
      if (WIKI_HOST.test(host)) hits.push({ itemId: item.id, url: s.url, status: "wiki" });
    }
  }
  return hits;
}

// 404/410, or a DNS/connection failure that persists on a re-check.
async function deadSources(doc) {
  const { results } = await verifySources(doc, { timeoutMs: 9000, concurrency: 6 });
  const isBroken = (r) => r.category === "dead" || r.status === "error";
  const candidates = results.filter(isBroken);
  if (candidates.length === 0) return [];

  const definite = candidates.filter((r) => r.category === "dead");
  const networkErrs = candidates.filter((r) => r.category !== "dead");
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
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node agent/publish-sports.js [--check] <sports.json>");
    process.exit(2);
  }

  const doc = JSON.parse(await readFile(resolve(file), "utf8"));

  const { valid, errors } = await validateSports(doc);
  if (!valid) {
    console.error("❌ Sports schema validation failed:");
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log("✅ Sports schema valid.");

  const bad = [...(await deadSources(doc)), ...wikiSources(doc)];
  if (checkOnly) {
    if (bad.length === 0) {
      console.log("🔗 All sports links resolve and none are wikis (paywalled/403 kept as valid).");
      process.exit(0);
    }
    console.log(`⚠️  ${bad.length} rejected link(s) — replace with ESPN/BBC/tour coverage, then re-run --check:`);
    for (const b of bad) console.log(`   - item ${b.itemId}: ${b.url}  [${b.status}]`);
    process.exit(3);
  }

  if (bad.length > 0) {
    const badSet = new Set(bad.map((b) => b.url));
    console.warn(`⚠️  Stripping ${badSet.size} rejected link(s) (dead or wiki); items kept intact.`);
    doc.items = doc.items.map((it) => ({
      ...it,
      sources: (it.sources || []).filter((s) => !badSet.has(s.url)),
    }));
  } else {
    console.log("🔗 All shown sports links resolve (paywalled/403 kept as valid).");
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "sports.json"), JSON.stringify(doc, null, 2) + "\n");
  console.log(`✅ Published ${doc.items.length} sports item(s) to ${OUT_DIR}.`);
}

main().catch((err) => {
  console.error("❌ Sports publish failed:", err?.message || err);
  process.exit(1);
});
