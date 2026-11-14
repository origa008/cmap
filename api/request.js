// cmap — POST /api/request
// Receives a roadmap request from the landing-page form and creates a row in
// the Notion database "cmap – Roadmap Requests".
//
// Env vars (set in Vercel, never hardcoded):
//   NOTION_TOKEN            Integration token (secret_...)
//   NOTION_DATA_SOURCE_ID   Data source UUID of the requests table (preferred)
//   NOTION_DATABASE_ID      Database page UUID (fallback, legacy parent form)
//
// Notion API: POST https://api.notion.com/v1/pages
// Current API versions (2025-09-03+) parent database rows via
//   parent: { type: "data_source_id", data_source_id: "<uuid>" }
// The older form parent: { database_id: "<uuid>" } is still accepted by some
// API versions, so this handler retries with it once if the data-source form
// is rejected. See README.md for the full reasoning.

const NOTION_API = "https://api.notion.com/v1/pages";
const NOTION_VERSION = "2025-09-03";

const VALID_CLASSES = ["Matric", "Inter"];
const VALID_TRACKS = [
  "Stream choice",
  "Pre-Medical",
  "Pre-Engineering",
  "CS/IT",
  "Commerce",
];

// Pakistani mobile numbers: 03XX-XXXXXXX, 92 3XX XXXXXXX, +92 3XX XXXXXXX.
// Spaces and dashes are stripped before matching.
const PK_MOBILE = /^(?:\+?92|0)?3\d{9}$/;

function normalisePhone(raw) {
  const cleaned = String(raw || "").replace(/[\s\-()]/g, "");
  if (!PK_MOBILE.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+?92/, "").replace(/^0/, ""); // 3XXXXXXXXX
  return "+92 " + digits.slice(0, 3) + " " + digits.slice(3);
}

function textProp(content) {
  return [{ type: "text", text: { content } }];
}

function buildPayload(parent, { name, phone, className, track, marks }) {
  const properties = {
    Name: { title: textProp(name) },
    "WhatsApp Number": { phone_number: phone },
  };
  if (className) properties.Class = { select: { name: className } };
  if (track) properties.Track = { select: { name: track } };
  if (marks) properties.Marks = { rich_text: textProp(marks) };
  // Status is NOT set here — the database defaults it to "New".
  return { parent, properties };
}

async function createNotionPage(token, payload) {
  const res = await fetch(NOTION_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // Non-JSON error body; keep data null and handle by status below.
  }
  return { res, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || (!dataSourceId && !databaseId)) {
    console.error("[cmap] Missing env: NOTION_TOKEN and/or NOTION_DATA_SOURCE_ID (or NOTION_DATABASE_ID) not set.");
    return res.status(500).json({
      ok: false,
      error: "Server is not configured yet. Please try again later.",
    });
  }

  // Vercel parses JSON bodies automatically; tolerate a raw string body too.
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ ok: false, error: "Invalid request body." });
    }
  }
  body = body && typeof body === "object" ? body : {};

  const name = String(body.name || "").trim();
  const phone = normalisePhone(body.whatsapp || body.phone || "");
  const className = String(body.class || "").trim();
  const track = String(body.track || "").trim();
  const marks = String(body.marks || "").trim();

  if (!name || name.length < 2 || name.length > 100) {
    return res.status(400).json({ ok: false, error: "Please enter your name." });
  }
  if (!phone) {
    return res.status(400).json({
      ok: false,
      error: "Please enter a valid Pakistani WhatsApp number (03XX-XXXXXXX).",
    });
  }
  if (className && !VALID_CLASSES.includes(className)) {
    return res.status(400).json({ ok: false, error: "Please choose Matric or Inter." });
  }
  if (track && !VALID_TRACKS.includes(track)) {
    return res.status(400).json({ ok: false, error: "Please choose a valid track." });
  }
  if (marks.length > 200) {
    return res.status(400).json({ ok: false, error: "Marks field is too long." });
  }

  const fields = { name, phone, className: className || null, track: track || null, marks: marks || null };

  // Attempt 1: current API form — parent by data source.
  const attempts = [];
  if (dataSourceId) {
    attempts.push({ type: "data_source_id", data_source_id: dataSourceId });
  }
  // Attempt 2 (fallback): legacy form — parent by database.
  if (databaseId) {
    attempts.push({ database_id: databaseId });
  }

  let lastError = null;
  for (const parent of attempts) {
    try {
      const { res: notionRes, data } = await createNotionPage(
        token,
        buildPayload(parent, fields)
      );

      if (notionRes.ok) {
        return res.status(200).json({ ok: true });
      }

      lastError = { status: notionRes.status, code: data && data.code, message: data && data.message };
      console.error("[cmap] Notion error:", notionRes.status, data && data.code, data && data.message);

      // Only retry with the legacy parent form on a validation error —
      // auth/permission/rate-limit errors would fail the same way twice.
      const isParentValidationError =
        notionRes.status === 400 && data && data.code === "validation_error";
      if (!isParentValidationError) break;
    } catch (err) {
      console.error("[cmap] Notion request failed:", err && err.message);
      lastError = { status: 0, code: "network_error" };
      break;
    }
  }

  // Map Notion failures to safe, user-facing messages (never leak internals).
  if (lastError && lastError.status === 401) {
    return res.status(502).json({
      ok: false,
      error: "Could not save your request (Notion auth failed). Please try again later.",
    });
  }
  if (lastError && (lastError.status === 403 || lastError.status === 404)) {
    return res.status(502).json({
      ok: false,
      error: "Could not save your request (Notion database not shared with the integration). Please try again later.",
    });
  }
  if (lastError && lastError.status === 429) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({
      ok: false,
      error: "Too many requests right now. Please wait a minute and try again.",
    });
  }
  return res.status(502).json({
    ok: false,
    error: "Something went wrong saving your request. Please try again.",
  });
};
