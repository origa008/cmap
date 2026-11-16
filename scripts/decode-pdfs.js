// Build-time decode of the roadmap PDFs.
// The GitHub snapshot-push connector only accepts UTF-8 text, so the nine
// PDFs are stored in the repo as base64 text (assets-b64/*.pdf.b64). Vercel
// runs this as part of the buildCommand (see vercel.json) to restore the real
// PDFs into files/, where api/file.js serves them (bundled via includeFiles).
// Fails the build loudly if any file is missing or decodes to garbage — a
// half-built files/ directory must never ship silently.

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "assets-b64");
const DEST = path.join(__dirname, "..", "files");

const EXPECTED = [
  "cmap-roadmap-1-stream-choice.pdf",
  "cmap-roadmap-2-pre-medical.pdf",
  "cmap-roadmap-3-pre-engineering.pdf",
  "cmap-roadmap-4-cs-it.pdf",
  "cmap-roadmap-5-commerce.pdf",
  "cmap-roadmap-6-ai-potential-impact.pdf",
  "cmap-roadmap-7-evolving-skills.pdf",
  "cmap-roadmap-8-remote-sponsored-jobs.pdf",
  "cmap-roadmap-9-skills-vs-degree.pdf",
];

fs.mkdirSync(DEST, { recursive: true });

for (const name of EXPECTED) {
  const src = path.join(SRC, name + ".b64");
  const dest = path.join(DEST, name);
  if (!fs.existsSync(src)) {
    console.error("[cmap] FATAL: missing base64 source: " + src);
    process.exit(1);
  }
  const b64 = fs.readFileSync(src, "utf8").replace(/\s+/g, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 1024 || buf.slice(0, 4).toString() !== "%PDF") {
    console.error("[cmap] FATAL: " + name + " did not decode to a valid PDF.");
    process.exit(1);
  }
  fs.writeFileSync(dest, buf);
  console.log("[cmap] decoded " + name + " (" + buf.length + " bytes).");
}
console.log("[cmap] All 9 roadmap PDFs ready in files/.");
