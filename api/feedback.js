// Feedback endpoint (Vercel serverless function → /api/feedback).
//
// The page POSTs reader signals here:
//   • thumbs/save: { id, signal: "save"|"feedback", value, edition, ts }
//   • daily note:  { signal: "note", note: "<free text>", edition, ts }
// We persist them to Supabase (Postgres) so the feedback-driven summary agent can
// read them later. No SDK dependency — uses Supabase's PostgREST endpoint via fetch.
//
// Config (Vercel project env vars — server-side only):
//   SUPABASE_URL          e.g. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (NEVER expose to the browser)
// Without them it just logs and 200s, so the page never breaks during setup.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || typeof body.signal !== "string") {
    return res.status(400).json({ error: "expected { signal, ... }" });
  }

  // Map the page payload → the feedback table columns.
  const row = {
    story_id: typeof body.id === "string" ? body.id : null, // g1, j2… (null for daily notes)
    signal: body.signal, // "save" | "feedback" | "note"
    value: body.value != null ? String(body.value) : null, // "up"/"down"/"true"/"false"
    note: typeof body.note === "string" ? body.note.slice(0, 4000) : null, // free-text
    edition: body.edition != null ? String(body.edition) : null,
  };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (url && key) {
    try {
      const resp = await fetch(`${url}/rest/v1/feedback`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        console.error("Supabase insert failed:", resp.status, detail.slice(0, 300));
      }
    } catch (e) {
      // Never fail the reader's request over a storage hiccup.
      console.error("Supabase insert error:", e?.message || e);
    }
  } else {
    console.log("[aidb feedback]", JSON.stringify(row));
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
