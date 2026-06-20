// Validates a briefing.json against schema/briefing.schema.json.
//
// Used two ways:
//   1. As a library:  import { validateBriefing } from './validate.js'
//   2. From the CLI:   node agent/validate.js site/AiDailyBriefing/briefing.json
//
// The CLI form is the acceptance check from HANDOFF.md §6. It also runs a few
// "soft" quality checks the JSON Schema can't express (sentence counts, no
// search-query URLs, Japan coverage) and prints them as warnings.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js"; // draft 2020-12 meta-schema support
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "schema", "briefing.schema.json");

let _validator;
async function getValidator() {
  if (_validator) return _validator;
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _validator = ajv.compile(schema);
  return _validator;
}

/**
 * @param {unknown} data Parsed briefing object.
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
export async function validateBriefing(data) {
  const validate = await getValidator();
  const valid = validate(data);
  const errors = valid
    ? []
    : (validate.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);

  const warnings = valid ? softChecks(data) : [];
  return { valid, errors, warnings };
}

// Quality heuristics that go beyond structural validity. These never block a
// publish on their own — they surface things a human reviewer should glance at.
function softChecks(data) {
  const warnings = [];

  const sentences = (data.meta?.summary || "").split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (sentences < 3 || sentences > 5) {
    warnings.push(`meta.summary should be 3-5 sentences (found ~${sentences}).`);
  }

  const japanItems = (data.items || []).filter((i) => i.region === "japan").length;
  if (japanItems < 3) {
    warnings.push(`Expected 3-4 Japan items; found ${japanItems}.`);
  }

  const ids = (data.items || []).map((i) => i.id);
  if (new Set(ids).size !== ids.length) {
    warnings.push("Duplicate item ids detected.");
  }

  for (const item of data.items || []) {
    for (const s of item.sources || []) {
      const url = s.url || "";
      if (/[?&]q=|\/search|google\.com\/search|bing\.com\/search|duckduckgo/.test(url)) {
        warnings.push(`Item ${item.id}: source looks like a search query, not an article: ${url}`);
      }
    }
  }

  return warnings;
}

// ── CLI entrypoint ──
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // Default to the published briefing, honoring AIDB_OUT_DIR so this works from
  // any layout (standalone repo or merged into the landing site under public/).
  const defaultTarget = join(__dirname, "..", process.env.AIDB_OUT_DIR || "site/AiDailyBriefing", "briefing.json");
  const target = process.argv[2] || defaultTarget;
  const data = JSON.parse(await readFile(target, "utf8"));
  const { valid, errors, warnings } = await validateBriefing(data);

  for (const w of warnings) console.warn(`⚠️  ${w}`);

  if (valid) {
    const counts = `${data.items.length} stories, ${data.items.filter((i) => i.region === "japan").length} from Japan`;
    console.log(`✅ ${target} is valid (schema v${data.schemaVersion}, ${counts}).`);
    process.exit(0);
  } else {
    console.error(`❌ ${target} failed schema validation:`);
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }
}
