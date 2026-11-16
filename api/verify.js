// cmap — POST /api/verify
// Receives a JazzCash payment screenshot, OCRs it with Tesseract.js (WASM,
// bundled — no external API), and checks four things against the expected
// payment: amount at least Rs 999 (overpayment passes — Kaleem, 2026-11-16),
// recipient "Shahzada Danish Kaleem", account
// 03295363198, and a date/time within the last 60 minutes.
//
// Verdicts:
//   pass   — all four checks matched → signed 24h files-page token is issued
//            and the Notion lead (ref) is marked Paid.
//   fail   — positive evidence of a WRONG payment (an amount below Rs 999 or a
//            different account number found). No token.
//   review — something could not be read (missing fields, stale screenshot,
//            low OCR confidence). No token; the screenshot is attached to the
//            Notion lead so a human can check it.
//
// Env vars (Vercel, never hardcoded):
//   PAYMENT_SECRET        HMAC key for files-page tokens (required)
//   NOTION_TOKEN          Integration token (for Paid status + screenshot attach)
//   NOTION_DATA_SOURCE_ID / NOTION_DATABASE_ID (not used here; kept for parity)

const fs = require("fs");
const path = require("path");
const { issueToken } = require("../lib/tokens");

const EXPECTED_AMOUNT = 999;
const EXPECTED_NAME = "Shahzada Danish Kaleem";
const EXPECTED_ACCOUNT = "03295363198";
const FRESH_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000; // clock skew
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // Vercel request cap is 4.5 MB
const LOW_CONFIDENCE = 50;

const NOTION_VERSION = "2025-09-03";

/* ------------------------------------------------------------------ */
/* Tesseract worker (module-level singleton — survives warm invocations) */
/* ------------------------------------------------------------------ */

let workerPromise = null;

function getWorker() {
  if (!workerPromise) workerPromise = createWorkerInstance();
  return workerPromise;
}

async function createWorkerInstance() {
  // eslint-disable-next-line global-require
  const { createWorker } = require("tesseract.js");
  const base = process.cwd(); // '/var/task' on Vercel — never __dirname
  const localLang = path.join(base, "tessdata", "eng.traineddata");
  const hasLocal = fs.existsSync(localLang) && fs.statSync(localLang).size > 1024 * 1024;

  if (hasLocal) {
    // Bundled paths: no CDN fetch at cold start (see wine_rec recipe).
    return createWorker("eng", 1 /* OEM.LSTM_ONLY */, {
      corePath: path.join(base, "node_modules/tesseract.js-core"),
      workerPath: path.join(
        base,
        "node_modules/tesseract.js/src/worker-script/node/index.js"
      ),
      langPath: path.join(base, "tessdata"),
      gzip: false,
      cacheMethod: "none",
      workerBlobURL: false,
    });
  }

  // Fallback: let tesseract.js fetch core + language data from its CDN.
  // Slower cold start (~5–10 s) but the endpoint still works.
  console.warn("[cmap] tessdata missing locally, using CDN language data.");
  return createWorker("eng", 1 /* OEM.LSTM_ONLY */);
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function normalizeText(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[‐‑–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Fix common OCR digit confusions inside digit runs (O→0, l/I→1).
function fixDigits(s) {
  return String(s || "").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");
}

/* ------------------------------------------------------------------ */
/* The four checks (pure functions — unit-testable)                    */
/* ------------------------------------------------------------------ */

function checkAmount(text) {
  const candidates = [];
  // Rs/PKR-prefixed amounts.
  const rsRe = /(?:rs\.?|pkr)\s*(\d[\d,]*\.?\d*)/gi;
  let m;
  while ((m = rsRe.exec(text)) !== null) {
    const v = parseFloat(fixDigits(m[1]).replace(/,/g, ""));
    if (Number.isFinite(v) && v >= 100 && v < 1000000) candidates.push(v);
  }
  // Decimal amounts (999.00 style) without a currency prefix.
  const decRe = /(\d[\d,]*\.\d{2})/g;
  while ((m = decRe.exec(text)) !== null) {
    const v = parseFloat(fixDigits(m[1]).replace(/,/g, ""));
    if (Number.isFinite(v) && v >= 100 && v < 1000000 && !candidates.includes(v)) {
      candidates.push(v);
    }
  }
  // Overpayment passes (Kaleem, 2026-11-16): any amount >= 999 is ok.
  const paid = candidates.find((v) => v >= EXPECTED_AMOUNT);
  if (paid !== undefined) {
    return { status: "ok", found: paid };
  }
  if (candidates.length > 0) {
    return { status: "fail", found: candidates[0] };
  }
  // Last resort: a standalone 999 not glued to another digit or comma
  // (guards against "1,999" and "1999" false positives).
  if (/(?:^|[^\d,])999(?:\.00)?(?![\d])/.test(text)) {
    return { status: "ok", found: EXPECTED_AMOUNT };
  }
  return { status: "unknown", found: null };
}

function checkName(text) {
  const norm = normalizeText(text).replace(/[^a-z0-9 ]/g, " ");
  if (/danish\s+kaleem/.test(norm)) return { status: "ok" };
  if (/shahzada/.test(norm) || /danish/.test(norm) || /kaleem/.test(norm)) {
    return { status: "unknown", note: "partial name only" };
  }
  return { status: "unknown", note: "name not found" };
}

function checkAccount(text) {
  const runs = (text.match(/[0-9][0-9 \-.]{8,}[0-9]/g) || []).map((r) =>
    fixDigits(r.replace(/[\s\-.]/g, ""))
  );
  const targets = ["03295363198", "923295363198"];
  for (const r of runs) {
    if (targets.includes(r) || r.includes("03295363198") || r.includes("923295363198")) {
      return { status: "ok" };
    }
  }
  const otherPk = runs.find((r) => /^03\d{9}$/.test(r) || /^92\d{10}$/.test(r));
  if (otherPk) return { status: "fail", found: otherPk };
  return { status: "unknown", note: "account number not found" };
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_NAMES = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";

function parseReceiptDateTime(text) {
  let y;
  let mo;
  let d;
  let m;

  // 15 Nov 2026 / 15-Nov-2026 / 15 Nov, 2026
  m = text.match(
    new RegExp("(\\d{1,2})\\s+(" + MONTH_NAMES + ")[a-z]*\\s*,?\\s*(\\d{4})", "i")
  );
  if (m) {
    d = parseInt(m[1], 10);
    mo = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? MONTHS[m[2].toLowerCase()];
    y = parseInt(m[3], 10);
  }
  // Nov 15, 2026
  if (y === undefined) {
    m = text.match(
      new RegExp("(" + MONTH_NAMES + ")[a-z]*\\s+(\\d{1,2}),?\\s*(\\d{4})", "i")
    );
    if (m) {
      mo = MONTHS[m[1].toLowerCase().slice(0, 3)] ?? MONTHS[m[1].toLowerCase()];
      d = parseInt(m[2], 10);
      y = parseInt(m[3], 10);
    }
  }
  // 2026-11-15
  if (y === undefined) {
    m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      y = parseInt(m[1], 10);
      mo = parseInt(m[2], 10) - 1;
      d = parseInt(m[3], 10);
    }
  }
  // 15/11/2026 (Pakistan uses day-first)
  if (y === undefined) {
    m = text.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      let yy = parseInt(m[3], 10);
      if (yy < 100) yy += 2000;
      if (a > 12) {
        d = a;
        mo = b - 1;
      } else if (b > 12) {
        d = b;
        mo = a - 1;
      } else {
        d = a; // day-first
        mo = b - 1;
      }
      y = yy;
    }
  }
  if (y === undefined || mo === undefined || mo < 0 || mo > 11 || d < 1 || d > 31) {
    return null;
  }

  // Time: prefer a match with an AM/PM marker, else the first HH:MM.
  const timeRe = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP][mM])?/g;
  let best = null;
  let first = null;
  let tm;
  while ((tm = timeRe.exec(text)) !== null) {
    if (!first) first = tm;
    if (tm[4]) {
      best = tm;
      break;
    }
  }
  const t = best || first;
  if (!t) return null;
  let hh = parseInt(t[1], 10);
  const mm = parseInt(t[2], 10);
  if (hh > 23 || mm > 59) return null;
  const meridiem = (t[4] || "").toLowerCase();
  if (meridiem === "pm" && hh < 12) hh += 12;
  if (meridiem === "am" && hh === 12) hh = 0;

  // Receipt times are Pakistan time (UTC+5, no DST).
  return Date.UTC(y, mo, d, hh - 5, mm);
}

function checkDateTime(text, nowMs) {
  const receiptMs = parseReceiptDateTime(text);
  if (receiptMs === null) {
    return { status: "unknown", note: "date/time not found" };
  }
  const diff = nowMs - receiptMs;
  if (diff < -FUTURE_TOLERANCE_MS) {
    return { status: "unknown", note: "receipt time is in the future" };
  }
  if (diff > FRESH_WINDOW_MS) {
    return { status: "unknown", note: "screenshot older than 60 minutes", stale: true };
  }
  return { status: "ok" };
}

function verdictFromChecks(checks, confidence) {
  const values = [checks.amount, checks.name, checks.account, checks.datetime];
  if (values.some((c) => c.status === "fail")) return "fail";
  if (values.every((c) => c.status === "ok")) {
    if (typeof confidence === "number" && confidence < LOW_CONFIDENCE) return "review";
    return "pass";
  }
  return "review";
}

/* ------------------------------------------------------------------ */
/* Notion side-effects (best-effort — never fail the verdict on these) */
/* ------------------------------------------------------------------ */

function notionHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function markPaid(token, pageId) {
  const res = await fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH",
    headers: notionHeaders(token),
    body: JSON.stringify({
      properties: { Status: { status: { name: "Paid" } } },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("Notion mark-paid failed: " + res.status + " " + body.slice(0, 200));
  }
}

async function attachScreenshot(token, pageId, buffer, mime, filename) {
  // Step 1: create the file upload.
  const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: notionHeaders(token),
    body: JSON.stringify({ filename, content_type: mime }),
    signal: AbortSignal.timeout(8000),
  });
  if (!createRes.ok) throw new Error("file_upload create failed: " + createRes.status);
  const upload = await createRes.json();
  // Step 2: send the bytes.
  const putRes = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: buffer,
    signal: AbortSignal.timeout(15000),
  });
  if (!putRes.ok) throw new Error("file_upload PUT failed: " + putRes.status);
  // Step 3: append a file block to the lead page.
  const blockRes = await fetch(
    "https://api.notion.com/v1/blocks/" + pageId + "/children",
    {
      method: "PATCH",
      headers: notionHeaders(token),
      body: JSON.stringify({
        children: [
          {
            object: "block",
            type: "file",
            file: { type: "file_upload", file_upload: { id: upload.id } },
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!blockRes.ok) throw new Error("append file block failed: " + blockRes.status);
}

function isValidRef(ref) {
  return typeof ref === "string" && /^[0-9a-f-]{32,36}$/i.test(ref);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const secret = process.env.PAYMENT_SECRET;
  const notionToken = process.env.NOTION_TOKEN;
  if (!secret) {
    console.error("[cmap] Missing env: PAYMENT_SECRET not set.");
    return res.status(500).json({
      ok: false,
      error: "Payment verification is not configured yet. Please try again later.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ ok: false, error: "Invalid request body." });
    }
  }
  body = body && typeof body === "object" ? body : {};

  const ref = isValidRef(body.ref) ? body.ref : null;
  const rawImage = String(body.image || "");
  const dataUrl = rawImage.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  const mime = dataUrl ? dataUrl[1] : "image/jpeg";
  const b64 = dataUrl ? dataUrl[2] : rawImage.replace(/^data:[^,]+,/, "");
  let buffer;
  try {
    buffer = Buffer.from(b64, "base64");
  } catch (_) {
    return res.status(400).json({ ok: false, error: "Could not read the screenshot." });
  }
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({
      ok: false,
      error: "Screenshot is too large. Please upload an image under 4 MB.",
    });
  }

  // OCR.
  let text = "";
  let confidence = null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    text = (data && data.text) || "";
    confidence = typeof data.confidence === "number" ? data.confidence : null;
  } catch (err) {
    console.error("[cmap] OCR failed:", err && err.message);
    workerPromise = null; // force a fresh worker next time
    return res.status(502).json({
      ok: false,
      error: "Verification is temporarily unavailable. Please try again.",
    });
  }

  const nowMs = Date.now();
  const checks = {
    amount: checkAmount(text),
    name: checkName(text),
    account: checkAccount(text),
    datetime: checkDateTime(text, nowMs),
  };
  const verdict = verdictFromChecks(checks, confidence);

  if (verdict === "pass") {
    const token = issueToken(secret, ref);
    if (ref && notionToken) {
      try {
        await markPaid(notionToken, ref);
      } catch (err) {
        console.error("[cmap] mark-paid failed (verdict still pass):", err.message);
      }
    }
    return res.status(200).json({
      ok: true,
      verdict: "pass",
      token,
      checks,
      message: "Payment verified — opening your roadmaps.",
    });
  }

  // fail / review: keep the screenshot on the Notion lead for a human check.
  if (ref && notionToken) {
    try {
      const ext = mime.includes("png") ? "png" : "jpg";
      await attachScreenshot(
        notionToken,
        ref,
        buffer,
        mime,
        "payment-" + verdict + "-" + Date.now() + "." + ext
      );
    } catch (err) {
      console.error("[cmap] screenshot attach failed:", err.message);
    }
  }

  let message;
  if (verdict === "fail") {
    if (checks.amount.status === "fail") {
      message =
        "The screenshot shows Rs " + checks.amount.found + ", less than Rs 999. " +
        "Please pay at least Rs 999 and upload the new screenshot.";
    } else if (checks.account.status === "fail") {
      message =
        "The screenshot shows a payment to a different account. " +
        "Please pay Rs 999 to 03295363198 (Shahzada Danish Kaleem) and try again.";
    } else {
      message = "This payment could not be verified. Please check the details and try again.";
    }
  } else {
    message =
      "We could not read everything on this screenshot, so it is saved for a quick " +
      "manual check. You will hear back on WhatsApp shortly — or upload a clearer screenshot.";
  }

  return res.status(200).json({ ok: true, verdict, checks, message });
};

// Exported for local tests (node test scripts require this module).
module.exports.checkAmount = checkAmount;
module.exports.checkName = checkName;
module.exports.checkAccount = checkAccount;
module.exports.checkDateTime = checkDateTime;
module.exports.parseReceiptDateTime = parseReceiptDateTime;
module.exports.verdictFromChecks = verdictFromChecks;
