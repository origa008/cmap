// Build-time download of the Tesseract English language model.
// Vercel runs this as the project's buildCommand (see vercel.json) so the
// ~4 MB binary never has to be committed to the repo. The file lands in
// tessdata/eng.traineddata, which api/verify.js loads locally (no CDN fetch
// at cold start). Fails the build loudly if the download is bad — a missing
// model must never ship silently (api/verify.js also falls back to the CDN).

const fs = require("fs");
const https = require("https");
const path = require("path");

const URL =
  "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata";
const DEST = path.join(__dirname, "..", "tessdata", "eng.traineddata");
const MIN_BYTES = 1 * 1024 * 1024; // tessdata_fast eng is ~4 MB

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { "User-Agent": "cmap-build" } }, (res) => {
        // Follow one redirect (GitHub raw redirects to media storage).
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error("HTTP " + res.statusCode + " for " + url));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

(async () => {
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  if (fs.existsSync(DEST) && fs.statSync(DEST).size >= MIN_BYTES) {
    console.log("[cmap] tessdata already present, skipping download.");
    return;
  }
  console.log("[cmap] Downloading eng.traineddata ...");
  await download(URL, DEST);
  const size = fs.statSync(DEST).size;
  if (size < MIN_BYTES) {
    fs.unlinkSync(DEST);
    throw new Error("Downloaded eng.traineddata too small (" + size + " bytes).");
  }
  console.log("[cmap] eng.traineddata ready (" + size + " bytes).");
})().catch((err) => {
  console.error("[cmap] FATAL: could not fetch tessdata:", err.message);
  process.exit(1);
});
