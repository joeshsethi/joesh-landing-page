// Japan grid + data-center-power supplier finder — a SEPARATE cycle from the news.
//
//   node agent/japan-grid.js     (needs ANTHROPIC_API_KEY)
//
// One agent: researches real Japanese manufacturers/distributors of grid equipment AND
// data-center-relevant power/electrical equipment (major AND smaller players), verifies
// every official website resolves, and writes a vetted target list to suppliers.json.
// Purpose: a US-based reader who wants to import, represent, distribute, or broker them.
// Re-runnable on demand. Never fabricates contacts — outreach is via verified official sites.

import { writeFile, readFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { verifySources } from "./verify-sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = process.env.AIDB_GRID_OUT_DIR
  ? join(REPO_ROOT, process.env.AIDB_GRID_OUT_DIR)
  : join(REPO_ROOT, "..", "public", "JapanGrid");
const MODEL = process.env.AIDB_MODEL || "claude-sonnet-4-6";
const EFFORT = process.env.AIDB_EFFORT || "medium";
const MAX_SEARCHES = Number(process.env.AIDB_GRID_MAX_SEARCHES || 16); // generous: on-demand run

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY required (this agent does live research).");
    process.exit(1);
  }
  const now = new Date();
  const data = await researchWithRetry(now);

  const { valid, errors } = await validate(data);
  if (!valid) {
    console.error("❌ Supplier list failed schema validation:");
    for (const e of errors) console.error("   - " + e);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "suppliers.json"), JSON.stringify(data, null, 2) + "\n");
  await logRun(data, now);
  console.log(`✅ Wrote ${data.suppliers.length} suppliers to ${OUT_DIR}/suppliers.json`);
}

// Research the list (with whole-run retry on transient failures), then ground websites.
async function researchWithRetry(now, attempts = 3) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const schema = await readFile(join(__dirname, "..", "schema", "japan-grid.schema.json"), "utf8");
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) console.log(`🔁 Research attempt ${attempt}/${attempts}…`);
      const system = buildSystem(schema);
      const messages = [{ role: "user", content: buildInstruction(now) }];
      let raw = await runConversation(client, system, messages, { tools: true });
      let data = tryParseJson(raw);

      if (!data || !(await validate(data)).valid) {
        const reason = data ? (await validate(data)).errors.join("; ") : "not parseable JSON";
        console.warn(`⚠️  First output invalid (${reason}). Requesting a repair…`);
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `That did not validate (${reason}). Reply with ONLY the corrected, complete JSON object — no fences, no commentary. Keep all website/source URLs verbatim.`,
        });
        raw = await runConversation(client, system, messages, { tools: false });
        data = tryParseJson(raw);
      }
      if (!data) throw new Error("Could not parse a supplier list from the model output.");

      return await enforceRealSites(client, data);
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️  Attempt ${attempt}/${attempts} failed: ${e?.message || e}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 15000 * attempt));
    }
  }
  throw lastErr;
}

// Grounding: every supplier's official website must resolve. Unlike the news (where a
// dead link is just stripped), here the website IS the deliverable — a supplier whose
// official site doesn't resolve is dropped (after a repair attempt), since you can't
// contact a company you can't verify.
const GROUNDING_SYSTEM = `You fix a JSON list of Japanese supplier companies. Some official \
website URLs do not resolve. For each, use web_search to find the company's REAL official \
website and copy it exactly, or if you cannot verify the company is real with a working \
official site, remove that supplier entirely. Never invent a company or URL. Output ONLY the \
corrected JSON object.`;

async function enforceRealSites(client, data) {
  for (let round = 1; round <= 2; round++) {
    const bad = await deadWebsites(data);
    if (bad.length === 0) {
      console.log("🔗 All supplier websites resolve.");
      return data;
    }
    console.warn(`⚠️  ${bad.length} supplier website(s) don't resolve — fixing (round ${round})…`);
    const list = bad.map((b) => `  - ${b.name}: ${b.url} [${b.status}]`).join("\n");
    const messages = [
      {
        role: "user",
        content:
          `Here is a supplier list JSON:\n\n${JSON.stringify(data)}\n\n` +
          `These official websites do NOT resolve:\n${list}\n\n` +
          `For each, find the company's real official website via web_search and copy it exactly, ` +
          `or remove that supplier if you can't verify it. Return ONLY the corrected JSON.`,
      },
    ];
    const raw = await runConversation(client, GROUNDING_SYSTEM, messages, { tools: true });
    const next = tryParseJson(raw);
    if (next && (await validate(next)).valid) data = next;
  }
  // Final hard enforcement: drop suppliers whose website still doesn't resolve.
  const badSet = new Set((await deadWebsites(data)).map((b) => b.url));
  if (badSet.size > 0) {
    console.warn(`⚠️  Dropping ${badSet.size} supplier(s) with unverifiable websites.`);
    data.suppliers = data.suppliers.filter((s) => !badSet.has(s.website));
  }
  return data;
}

// Suppliers whose official website is dead (404/410) or fails to resolve (DNS/connection),
// re-checked once to avoid dropping a real company over a transient blip.
async function deadWebsites(data) {
  const probe = {
    items: data.suppliers.map((s) => ({ id: s.name, sources: [{ name: "x", title: "x", url: s.website }] })),
  };
  const isBroken = (r) => r.category === "dead" || r.status === "error";
  const first = (await verifySources(probe, { timeoutMs: 9000, concurrency: 6 })).results.filter(isBroken);
  if (first.length === 0) return [];
  const definite = first.filter((r) => r.category === "dead");
  const netErrs = first.filter((r) => r.category !== "dead");
  if (netErrs.length === 0) return first.map((r) => ({ name: r.itemId, url: r.url, status: r.status }));
  const reprobe = { items: [{ id: "recheck", sources: netErrs.map((r) => ({ name: "x", title: "x", url: r.url })) }] };
  const stillBad = new Set((await verifySources(reprobe, { timeoutMs: 9000, concurrency: 6 })).results.filter(isBroken).map((r) => r.url));
  return [...definite, ...netErrs.filter((r) => stillBad.has(r.url))].map((r) => ({ name: r.itemId, url: r.url, status: r.status }));
}

// ── prompts ──
function buildSystem(schema) {
  return `You are a B2B sourcing researcher building a vetted TARGET LIST of Japanese \
manufacturers (and distributors) of (a) electrical GRID equipment and (b) DATA-CENTER power / \
electrical equipment — for a US-based reader who wants to import, represent, distribute, or \
broker these products in the United States.

COVER BOTH areas:
- Grid: transformers, switchgear, substations, transmission & distribution (T&D) systems, \
protection relays, power electronics, grid-scale storage / inverters, smart-grid gear.
- Data-center power/electrical: UPS, power distribution (PDUs, busways/busduct), data-center \
switchgear, transformers, backup/standby power, and closely related electrical infrastructure.

INCLUDE A MIX of sizes:
- The major OEMs (e.g. Hitachi Energy, Mitsubishi Electric, Toshiba Energy Systems, Fuji \
Electric, Meidensha, Takaoka Toko, Daihen, Nissin Electric).
- AND several SMALLER / lesser-known / niche Japanese makers — search trade directories, JETRO, \
industry associations, and regional manufacturers. The smaller ones are often the best \
representation / brokering opportunities, so don't stop at the household names.

FOR EACH supplier:
- Official website — you MUST have seen it in your web_search results; copy the domain exactly. \
Every website is auto-fetched afterward and any that don't resolve are dropped, so never \
construct or guess a URL.
- What they make (in "products"), HQ location, and a size tier (major | mid | smaller).
- "category" must be a SHORT bucket — exactly one of: "Transformers", "Switchgear & substations", \
"T&D & grid automation", "Power electronics & inverters", "Data-center power / UPS". Pick the \
single best fit; put all the product detail in "products", NOT in "category".
- An official contact / inquiry / sales page URL if you can find one — or the note "inquiry \
form on official site". NEVER invent a personal email or phone number.
- A relevance note: why this company is worth contacting for the reader's import/representation goal.
- 1-3 verifying source links (official site + ideally one second source).

RULES:
- REAL companies only. Verify each via its official website (and ideally a second source). \
Never fabricate a company, product, website, or contact. This list will be used for real \
outreach, so accuracy is everything.
- Aim for ~15-25 suppliers spanning categories and sizes, weighted toward actionable \
opportunities (not only the giants).

OUTPUT: a single valid JSON object and NOTHING else (no fences, no commentary), conforming \
exactly to this JSON Schema:

${schema}`;
}

function buildInstruction(now) {
  const d = now.toISOString().slice(0, 10);
  return `Research and produce the Japan grid + data-center power supplier target list now.
Set: meta.title = "Japan Grid & Data-Center Power Suppliers"; meta.subtitle = "Vetted Japanese \
manufacturers to import, represent, or broker in the US"; meta.note = a one-line reminder that \
contacts should be confirmed via each company's official site before outreach; \
meta.generatedLabel = "${d}"; generatedAt = "${now.toISOString()}".
Search broadly and deeply — include both major OEMs and several smaller/niche makers. Output \
only the JSON.`;
}

// ── shared LLM plumbing (kept local so this cycle is independent of the news pipeline) ──
async function runConversation(client, system, messages, { tools = true } = {}) {
  const tooling = tools ? [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }] : undefined;
  const cachedSystem = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  let convo = messages;
  let container;
  for (let i = 0; i < 12; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system: cachedSystem,
      messages: convo,
      ...(tooling ? { tools: tooling } : {}),
      ...(container ? { container } : {}),
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "pause_turn") {
      if (message.container?.id) container = message.container.id;
      convo = [...convo, { role: "assistant", content: message.content }];
      continue;
    }
    return message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  throw new Error("Conversation did not converge (too many pause_turn continuations).");
}

function tryParseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

let _validator;
async function validate(data) {
  if (!_validator) {
    const schema = JSON.parse(await readFile(join(__dirname, "..", "schema", "japan-grid.schema.json"), "utf8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    _validator = ajv.compile(schema);
  }
  const valid = _validator(data);
  return { valid, errors: valid ? [] : (_validator.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`) };
}

async function logRun(data, now) {
  try {
    const decisions = join(REPO_ROOT, "decisions.md");
    if (existsSync(decisions)) {
      await appendFile(decisions, `- ${now.toISOString()} — japan-grid run · ${data.suppliers.length} suppliers · model ${MODEL}\n`);
    }
  } catch {
    /* best effort */
  }
}

main().catch((err) => {
  console.error("❌ japan-grid run failed:", err?.message || err);
  process.exit(1);
});
