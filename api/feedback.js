// Feedback endpoint (Vercel serverless function → /api/feedback).
//
// The front end POSTs { id, signal, value, edition, ts } when the reader taps
// Useful / Not for me / Save (see the page's postSignal()). This persists those
// signals to DynamoDB so agent/review.js can read them and steer preferences.md.
//
// Config (Vercel project env vars):
//   AWS_REGION, AIDB_DDB_TABLE, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
// Without them it just logs and 200s, so the page never breaks during setup.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || typeof body.id !== "string" || typeof body.signal !== "string") {
    return res.status(400).json({ error: "expected { id, signal, value, edition, ts }" });
  }

  const ts = Number(body.ts) || Date.now();
  const record = {
    id: body.id,
    signal: body.signal, // "save" | "feedback"
    value: body.value ?? null, // boolean (save) | "up"/"down" (feedback)
    edition: body.edition ?? null,
    ts,
  };

  const table = process.env.AIDB_DDB_TABLE;
  const region = process.env.AWS_REGION;
  if (table && region && process.env.AWS_ACCESS_KEY_ID) {
    try {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      const { DynamoDBDocumentClient, PutCommand } = await import("@aws-sdk/lib-dynamodb");
      const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
      await doc.send(
        new PutCommand({
          TableName: table,
          Item: { pk: "signal", sk: `${String(ts).padStart(13, "0")}#${record.id}`, ...record },
        }),
      );
    } catch (e) {
      console.error("DynamoDB write failed:", e?.message || e);
      // Don't fail the reader's request over a storage hiccup.
    }
  } else {
    console.log("[aidb feedback]", JSON.stringify(record));
  }

  return res.status(200).json({ ok: true });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
