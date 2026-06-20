// The "lite supervisor" — the piece that makes the agent IMPROVE and lets you SEE it.
//
//   node agent/review.js            analyze feedback, append a journal entry to
//                                    decisions.md, and write a preferences proposal
//   node agent/review.js --apply     also overwrite preferences.md with the proposal
//
// What it does (no API key required):
//   1. Reads persisted feedback (👍/👎/★) via the storage interface.
//   2. Joins each signal to the story it was about, using recent dated editions,
//      so it can aggregate by region / category / tag.
//   3. Writes a human-readable recommendation into decisions.md — your journal of
//      how the agent is being steered over time. THIS is "where you see it."
//
// Default is propose-only (manual approval), matching the "manual to start" plan.
// Run with --apply once you trust it, or let the weekly workflow open a PR.

import { readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SITE_DIR = process.env.AIDB_OUT_DIR
  ? join(REPO_ROOT, process.env.AIDB_OUT_DIR)
  : join(REPO_ROOT, "site", "AiDailyBriefing");
const DECISIONS = join(REPO_ROOT, "decisions.md");
const PREFS = join(REPO_ROOT, "preferences.md");
const PREFS_PROPOSED = join(REPO_ROOT, "preferences.proposed.md");

async function main() {
  const apply = process.argv.includes("--apply");
  const store = getStore();
  const signals = await store.readFeedback({ sinceDays: 30 });
  const itemIndex = await buildItemIndex();

  const stats = aggregate(signals, itemIndex);
  const recommendations = recommend(stats);
  const nowIso = new Date().toISOString();

  // 1. Append a journal entry — this is the visible record of iteration.
  await appendDecision({ nowIso, store: store.backend, signals, stats, recommendations });

  // 2. Write a proposed preferences.md (current + an auto-generated guidance block).
  const proposal = await buildProposal(recommendations);
  await writeFile(PREFS_PROPOSED, proposal);

  console.log(`📓 Logged a review entry to decisions.md (${signals.length} signals, last 30 days).`);
  console.log(`📝 Wrote a preferences proposal to preferences.proposed.md.`);

  if (apply) {
    await writeFile(PREFS, proposal);
    console.log("✅ --apply: preferences.md updated from the proposal.");
  } else {
    console.log("ℹ️  Review preferences.proposed.md; copy it over preferences.md to accept, or run with --apply.");
  }
}

// Build id -> { region, cat, tags, headline } from recent dated editions.
async function buildItemIndex() {
  const index = new Map();
  if (!existsSync(SITE_DIR)) return index;
  const files = (await readdir(SITE_DIR)).filter((f) => /^briefing-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  // Also include the current edition.
  files.push("briefing.json");
  for (const f of files) {
    const data = safeJson(await readFile(join(SITE_DIR, f), "utf8").catch(() => ""));
    for (const item of data?.items || []) {
      index.set(item.id, {
        region: item.region,
        cat: item.cat,
        tags: item.tags || [],
        headline: item.headline,
      });
    }
  }
  return index;
}

function aggregate(signals, itemIndex) {
  const byDim = () => ({ saves: 0, up: 0, down: 0 });
  const region = {};
  const cat = {};
  const tag = {};
  let savesTotal = 0;
  let upTotal = 0;
  let downTotal = 0;

  for (const s of signals) {
    const meta = itemIndex.get(s.id);
    const kind = s.signal === "save" ? (s.value ? "saves" : null) : s.value === "up" ? "up" : s.value === "down" ? "down" : null;
    if (!kind) continue;
    if (kind === "saves") savesTotal++;
    if (kind === "up") upTotal++;
    if (kind === "down") downTotal++;
    if (!meta) continue;
    bump(region, meta.region, kind, byDim);
    bump(cat, meta.cat, kind, byDim);
    for (const t of meta.tags) bump(tag, t, kind, byDim);
  }
  return { region, cat, tag, totals: { saves: savesTotal, up: upTotal, down: downTotal } };
}

function bump(obj, key, kind, init) {
  if (!key) return;
  obj[key] = obj[key] || init();
  obj[key][kind]++;
}

// Turn the aggregates into plain-English steering recommendations.
function recommend(stats) {
  const recs = [];
  const score = (d) => (d.saves + d.up) - d.down;

  const topCat = top(stats.cat, score);
  const botCat = bottom(stats.cat, score);
  if (topCat) recs.push(`Lean into "${topCat.key}" stories — strongest positive signal (${fmt(topCat.v)}).`);
  if (botCat && score(botCat.v) < 0) recs.push(`Pull back on "${botCat.key}" stories — net-negative signal (${fmt(botCat.v)}).`);

  const topRegion = top(stats.region, score);
  if (topRegion) recs.push(`Reader engages most with "${topRegion.key}" items (${fmt(topRegion.v)}).`);

  const topTags = Object.entries(stats.tag)
    .map(([k, v]) => ({ k, s: score(v) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.k);
  if (topTags.length) recs.push(`Favored tags: ${topTags.join(", ")}.`);

  if (!recs.length) recs.push("Not enough feedback yet to steer — keep collecting signals.");
  return recs;
}

async function buildProposal(recommendations) {
  const base = existsSync(PREFS) ? await readFile(PREFS, "utf8") : "# Reader Preferences\n";
  const marker = "<!-- AUTO-REVIEW BLOCK -->";
  const block = [
    marker,
    "## Auto-generated guidance (from feedback — review/edit freely)",
    `_Last updated ${new Date().toISOString().slice(0, 10)} by agent/review.js_`,
    "",
    ...recommendations.map((r) => `- ${r}`),
    "",
  ].join("\n");

  // Replace any existing auto block, else append.
  if (base.includes(marker)) {
    return base.replace(new RegExp(`${marker}[\\s\\S]*$`), block);
  }
  return base.trimEnd() + "\n\n" + block;
}

async function appendDecision({ nowIso, store, signals, stats, recommendations }) {
  if (!existsSync(DECISIONS)) {
    await writeFile(DECISIONS, decisionsHeader());
  }
  const entry = [
    ``,
    `## ${nowIso.slice(0, 10)} — feedback review`,
    `- Store: ${store} · signals (30d): ${signals.length} ` +
      `(★${stats.totals.saves} 👍${stats.totals.up} 👎${stats.totals.down})`,
    `- Recommendations:`,
    ...recommendations.map((r) => `  - ${r}`),
    `- Action: wrote preferences.proposed.md for review.`,
    ``,
  ].join("\n");
  await appendFile(DECISIONS, entry);
}

function decisionsHeader() {
  return `# Decisions log

This is the agent's journal — a human-readable record of every meaningful event:
each daily run, and each feedback review with the recommendations it produced.
It answers "how is this thing changing over time, and why" without a black box.

- Daily runs are appended by \`agent/run.js\`.
- Feedback reviews are appended by \`agent/review.js\`.
`;
}

// ── helpers ──
const fmt = (d) => `★${d.saves} 👍${d.up} 👎${d.down}`;
function top(obj, score) {
  const e = Object.entries(obj).sort((a, b) => score(b[1]) - score(a[1]))[0];
  return e ? { key: e[0], v: e[1] } : null;
}
function bottom(obj, score) {
  const e = Object.entries(obj).sort((a, b) => score(a[1]) - score(b[1]))[0];
  return e ? { key: e[0], v: e[1] } : null;
}
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("❌ Review failed:", err?.message || err);
  process.exit(1);
});
