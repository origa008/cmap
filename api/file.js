// cmap — GET /api/file?id=1..9&token=...
// Serves one of the nine roadmap PDFs. Roadmaps 1–6 are free and need no
// token. Roadmaps 7–9 (Evolving Skills, Remote & Sponsored Jobs, Skills vs
// Degree) are premium: they need the HMAC access token issued by /api/verify
// after a successful Rs 999 payment check. The PDFs live in the repo under
// files/ (bundled via vercel.json includeFiles) — they are NOT public static
// files, so the premium URLs cannot be guessed or shared around the lock.
// Add &download=1 for a download instead of an inline preview.

const fs = require("fs");
const path = require("path");
const { verifyToken } = require("../lib/tokens");

const FILES = {
  1: { file: "cmap-roadmap-1-stream-choice.pdf", title: "Stream Choice" },
  2: { file: "cmap-roadmap-2-pre-medical.pdf", title: "Pre-Medical" },
  3: { file: "cmap-roadmap-3-pre-engineering.pdf", title: "Pre-Engineering" },
  4: { file: "cmap-roadmap-4-cs-it.pdf", title: "CS / IT" },
  5: { file: "cmap-roadmap-5-commerce.pdf", title: "Commerce" },
  6: { file: "cmap-roadmap-6-ai-potential-impact.pdf", title: "AI Potential & Impact" },
  7: { file: "cmap-roadmap-7-evolving-skills.pdf", title: "Evolving Skills" },
  8: { file: "cmap-roadmap-8-remote-sponsored-jobs.pdf", title: "Remote & Sponsored Jobs" },
  9: { file: "cmap-roadmap-9-skills-vs-degree.pdf", title: "Skills vs Degree" },
};

// Premium roadmaps (locked for Rs 999, unlocked together by one payment).
const PREMIUM_IDS = new Set(["7", "8", "9"]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const id = String((req.query && req.query.id) || "");
  const entry = FILES[id];
  if (!entry) {
    return res.status(404).json({ ok: false, error: "Roadmap not found." });
  }

  // Free roadmaps (1–6) need no token and no secret. Premium roadmaps (7–9)
  // need a valid token; the secret is only required for that check.
  if (PREMIUM_IDS.has(id)) {
    const secret = process.env.PAYMENT_SECRET;
    if (!secret) {
      console.error("[cmap] Missing env: PAYMENT_SECRET not set.");
      return res.status(500).json({ ok: false, error: "Unlocks are not configured yet." });
    }
    const token = String((req.query && req.query.token) || "");
    if (!verifyToken(secret, token)) {
      return res.status(403).json({
        ok: false,
        error: "This roadmap is locked. Unlock all 3 premium roadmaps for Rs 999 on the files page.",
      });
    }
  }

  const filePath = path.join(process.cwd(), "files", entry.file);
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch (_) {
    console.error("[cmap] Roadmap file missing from bundle:", entry.file);
    return res.status(500).json({ ok: false, error: "Roadmap file is unavailable." });
  }

  const download = String((req.query && req.query.download) || "") === "1";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", data.length);
  res.setHeader(
    "Content-Disposition",
    (download ? "attachment" : "inline") + '; filename="' + entry.file + '"'
  );
  // Premium content: never let a CDN or browser cache serve it to someone else.
  // (Free roadmaps keep the same headers for simplicity — traffic is tiny.)
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  return res.status(200).send(data);
};
