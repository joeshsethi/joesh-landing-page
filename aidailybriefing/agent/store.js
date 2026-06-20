// Storage abstraction for the briefing service.
//
// One interface, two backends — selected by AIDB_STORE:
//   "file" (default) → local/committed files. Zero infra. Runs anywhere.
//   "aws"            → DynamoDB (feedback) + S3 (durable archive). The deploy target.
//
// The agent and the review step only ever call this interface, so the same code
// runs locally and in production — you flip one env var. That's the whole point.
//
// Interface:
//   recordFeedback(signal)         → persist one { id, signal, value, edition, ts }
//   readFeedback({ sinceDays })    → array of signals, newest first
//   archiveBriefing(dateStamp, js) → durable copy of an edition (S3 in aws mode)

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DATA_DIR = join(REPO_ROOT, "data");
const FEEDBACK_FILE = join(DATA_DIR, "feedback.jsonl");

export function getStore() {
  const backend = (process.env.AIDB_STORE || "file").toLowerCase();
  return backend === "aws" ? awsStore() : fileStore();
}

// ── File backend: feedback in data/feedback.jsonl; archives already handled by
//    run.js writing dated files into the site folder (so this is a no-op here). ──
function fileStore() {
  return {
    backend: "file",
    async recordFeedback(signal) {
      await mkdir(DATA_DIR, { recursive: true });
      await appendFile(FEEDBACK_FILE, JSON.stringify(normalize(signal)) + "\n");
    },
    async readFeedback({ sinceDays = 30 } = {}) {
      if (!existsSync(FEEDBACK_FILE)) return [];
      const cutoff = Date.now() - sinceDays * 86400_000;
      const lines = (await readFile(FEEDBACK_FILE, "utf8")).split("\n").filter(Boolean);
      return lines
        .map((l) => safeParse(l))
        .filter((s) => s && Number(s.ts) >= cutoff)
        .sort((a, b) => b.ts - a.ts);
    },
    async archiveBriefing() {
      // No-op: dated copies are written into site/AiDailyBriefing by run.js and
      // committed to git (which the live site serves for the ?date= view).
    },
  };
}

// ── AWS backend: DynamoDB for feedback, S3 for durable archives. ──
function awsStore() {
  const region = process.env.AWS_REGION || "us-east-1";
  const table = process.env.AIDB_DDB_TABLE || "aidb-feedback";
  const bucket = process.env.AIDB_S3_BUCKET;

  // Lazy-imported so file-mode runs never load the AWS SDK.
  let ddb, s3;
  async function ddbDoc() {
    if (ddb) return ddb;
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    return ddb;
  }
  async function s3Client() {
    if (s3) return s3;
    const { S3Client } = await import("@aws-sdk/client-s3");
    s3 = new S3Client({ region });
    return s3;
  }

  return {
    backend: "aws",
    async recordFeedback(signal) {
      const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
      const s = normalize(signal);
      const doc = await ddbDoc();
      await doc.send(
        new PutCommand({
          TableName: table,
          // pk groups all signals; sk sorts by time so we can range-query recent.
          Item: { pk: "signal", sk: `${String(s.ts).padStart(13, "0")}#${s.id}`, ...s },
        }),
      );
    },
    async readFeedback({ sinceDays = 30 } = {}) {
      const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
      const cutoff = Date.now() - sinceDays * 86400_000;
      const doc = await ddbDoc();
      const out = await doc.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :p AND sk >= :since",
          ExpressionAttributeValues: { ":p": "signal", ":since": String(cutoff).padStart(13, "0") },
          ScanIndexForward: false, // newest first
        }),
      );
      return out.Items || [];
    },
    async archiveBriefing(dateStamp, json) {
      if (!bucket) return; // S3 archive is optional
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `briefing-${dateStamp}.json`,
          Body: json,
          ContentType: "application/json",
        }),
      );
    },
  };
}

function normalize(s) {
  return {
    id: String(s.id ?? ""),
    signal: String(s.signal ?? ""),
    value: s.value ?? null,
    edition: s.edition ?? null,
    ts: Number(s.ts) || Date.now(),
  };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
