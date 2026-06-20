// Source-link verifier. Fetches every sources[].url in a briefing and flags
// definitively-dead links BEFORE publish — the last guard against a story that
// cites a URL that 404s.
//
//   import { verifySources } from "./verify-sources.js"   (used by run.js)
//   node agent/verify-sources.js site/AiDailyBriefing/briefing.json   (standalone)
//
// Categories (the distinction matters — reputable outlets block bots):
//   ok       2xx/3xx — reachable.
//   blocked  401/403/429/451 — live but bot-protected/paywalled. Not a problem.
//   dead     404/410 — the URL is wrong. THIS is what we flag/fail on.
//   unknown  5xx / timeout / network error — ambiguous; warn, don't fail.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "Mozilla/5.0 (compatible; AIDailyBriefingBot/1.0; +https://joeshsethi.com)";

/**
 * @param {object} briefing Parsed briefing object.
 * @param {{ timeoutMs?: number, concurrency?: number }} opts
 */
export async function verifySources(briefing, { timeoutMs = 8000, concurrency = 6 } = {}) {
  const targets = [];
  for (const item of briefing.items || []) {
    for (const s of item.sources || []) {
      targets.push({ itemId: item.id, name: s.name, url: s.url });
    }
  }

  const results = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const t = targets[next++];
      results.push(await checkOne(t, timeoutMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  const by = (c) => results.filter((r) => r.category === c);
  return {
    results,
    total: results.length,
    ok: by("ok"),
    blocked: by("blocked"),
    dead: by("dead"),
    unknown: by("unknown"),
  };
}

async function checkOne(t, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(t.url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
    });
    clearTimeout(timer);
    return { ...t, status: res.status, category: categorize(res.status) };
  } catch (e) {
    clearTimeout(timer);
    const status = e?.name === "AbortError" ? "timeout" : "error";
    return { ...t, status, category: "unknown", error: e?.message };
  }
}

function categorize(status) {
  if (status >= 200 && status < 400) return "ok";
  if ([401, 403, 429, 451].includes(status)) return "blocked";
  if ([404, 410].includes(status)) return "dead";
  return "unknown"; // 5xx and anything else
}

// Pretty one-line report; returns the summary object so callers can act on it.
export function reportSourceCheck(summary) {
  const { total, ok, blocked, dead, unknown } = summary;
  console.log(
    `🔗 Source check: ${total} links — ${ok.length} ok, ${blocked.length} blocked(bot/paywall), ` +
      `${dead.length} dead, ${unknown.length} unknown`,
  );
  for (const r of dead) console.error(`   ❌ DEAD (${r.status})  ${r.itemId}  ${r.url}`);
  for (const r of unknown) console.warn(`   ⚠️  ${r.status}  ${r.itemId}  ${r.url}`);
  return summary;
}

// ── CLI ──
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const defaultTarget = join(__dirname, "..", process.env.AIDB_OUT_DIR || "site/AiDailyBriefing", "briefing.json");
  const target = process.argv[2] || defaultTarget;
  const briefing = JSON.parse(await readFile(target, "utf8"));
  const summary = reportSourceCheck(await verifySources(briefing));
  process.exit(summary.dead.length > 0 ? 1 : 0);
}
