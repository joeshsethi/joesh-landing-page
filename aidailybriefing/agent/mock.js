// Dry-run generator. When there's no ANTHROPIC_API_KEY (or --dry-run is passed),
// the agent produces a briefing from a template instead of calling Claude.
//
// This exists so the *whole pipeline* — generate -> validate -> write dated copy
// -> deploy -> page re-fetches -> feedback — can be exercised end to end today,
// before any API keys or hosting are wired up. It freshens the timestamp/labels
// of an existing briefing so you can see the edition change on a refresh.

import { readFile } from "node:fs/promises";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Produce a freshened briefing object from a template file (defaults to the
 * current published briefing.json). Bumps generatedAt, dateLabel, and the
 * edition number so a browser refresh visibly shows a new edition.
 *
 * @param {{ templatePath: string, now?: Date }} opts
 */
export async function generateMockBriefing({ templatePath, now = new Date() }) {
  const template = JSON.parse(await readFile(templatePath, "utf8"));

  const dateLabel = `${DAY[now.getUTCDay()]} · ${MON[now.getUTCMonth()]} ${now.getUTCDate()} ${now.getUTCFullYear()}`;
  const prevEdition = parseEdition(template?.meta?.editionLine);
  const nextEdition = prevEdition + 1;
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;

  return {
    ...template,
    generatedAt: now.toISOString(),
    meta: {
      ...template.meta,
      dateLabel,
      editionLine: `EDITION No.${nextEdition} · SYNCED ${hhmm} UTC · DRY RUN`,
      intro:
        "DRY-RUN edition — generated from the previous template without live research. " +
        "Add ANTHROPIC_API_KEY to produce a real briefing. " +
        (template.meta?.intro || ""),
    },
  };
}

function parseEdition(editionLine) {
  const m = /No\.?\s*(\d+)/i.exec(editionLine || "");
  return m ? parseInt(m[1], 10) : 412;
}
