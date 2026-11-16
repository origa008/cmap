# cmap — landing page + freemium files

Career-roadmap landing page for Matric & Inter students in Pakistan.
Static site (plain HTML/CSS/JS) + Vercel serverless functions. The 6 core
roadmaps are FREE (Rs 0); 3 premium guides unlock together for Rs 999.

1. `index.html` form → `api/request.js` writes the lead into the Notion
   database **"cmap – Roadmap Requests"**, then redirects to `/files`.
2. `files.html` lists all 9 roadmaps: 1–6 free (preview + download, no
   token), 7–9 locked. Tapping a locked file opens the unlock modal:
   JazzCash details + screenshot upload → `api/verify.js` OCRs it
   (Tesseract.js, bundled) and checks amount at least Rs 999 (overpayment
   passes) / name / account / fresh date-time.
3. On a pass, a signed 24h token unlocks all 3 premium roadmaps, served
   through the token-gated `api/file.js` (free roadmaps need no token).

- Position: "From your board marks to your first salary."
- Price: Rs 0 (launch offer — the 6 core roadmaps are free). 3 premium guides unlock together for Rs 999, one-time, on the files page.
- Form fields: name, WhatsApp number, class (Matric/Inter), track, marks (optional).

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole page: hero + form, pain stats, how it works, 5-roadmap index, why-not-ChatGPT, 5 tabbed sample roadmaps, price + form, sources, footer |
| `styles.css` | "Calm editorial trust" theme (off-white `#FAFAF8`, forest-black `#0F1F17`, lime `#B5F24B`) |
| `app.js` | Scroll-fade statements, reveal-on-scroll, roadmap tabs, form validation + submit (redirects to `/files` on success), sticky mobile CTA |
| `pay.html` | Retired payment page — redirects to `/files` (meta refresh + `vercel.json` redirect). The upload/verify UI now lives in the files-page unlock modal. `pay.js` was removed locally; its GitHub copy remains as dead code (snapshot-push cannot delete files). |
| `files.html` / `files.js` | Files page: 6 free roadmaps (preview + download, no token) + 3 locked premium roadmaps with an upload/verify unlock modal |
| `api/request.js` | Vercel serverless function: validates input, creates a Notion page, returns its id as `ref` |
| `api/verify.js` | Vercel serverless function: Tesseract.js OCR + 4 payment checks → pass/fail/review, issues token, marks lead Paid, attaches failed screenshots to Notion |
| `api/file.js` | Vercel serverless function: serves one PDF from `files/` — ids 1–6 free, ids 7–9 token-gated; no-store cache headers |
| `lib/tokens.js` | Shared HMAC token issue/verify (used by both `api/verify.js` and `api/file.js`) |
| `scripts/fetch-tessdata.js` | Build-time download of `eng.traineddata` into `tessdata/` (Vercel buildCommand) |
| `scripts/decode-pdfs.js` | Build-time decode of the PDFs from `assets-b64/` into `files/` (Vercel buildCommand) |
| `assets-b64/` | The 9 roadmap PDFs as base64 text — the snapshot-push connector only accepts UTF-8, so the binaries travel this way and are decoded at build time |
| `files/` | The 9 decoded roadmap PDFs (build output, not committed) — served only through `api/file.js` (ids 1–6 free, 7–9 token-gated), never as public static files |
| `vercel.json` | `cleanUrls` + security headers + function config (verify: 60s/2GB, includeFiles for Tesseract + tessdata; file: includeFiles for `files/`) |
| `package.json` / `package-lock.json` | `tesseract.js` dependency |
| `.env.example` | Env vars (no real values) |
| `.gitignore` | Keeps `.env*`, `node_modules/`, `.vercel/`, `tessdata/` out of git |

## Deploy (once Vercel login + Notion token exist)

```bash
cd ~/workspace/cmap-site
npx vercel login          # one-time: sign in to Vercel in the browser
npx vercel --prod         # deploys; first run asks for project name — use "cmap"
```

Or import the folder as a project in the Vercel dashboard (no build command,
no framework — Vercel serves the static files and `api/` automatically).

### Environment variables (Vercel dashboard → Project → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `NOTION_TOKEN` | The integration token (`secret_...`) from notion.so/my-integrations |
| `NOTION_DATA_SOURCE_ID` | `418f63d9-03e3-8130-b73b-000b5891564a` (data source of the requests table) |
| `NOTION_DATABASE_ID` | `418f63d9-03e3-81c9-9d49-d9da35627894` (database page UUID; fallback only) |
| `PAYMENT_SECRET` | Long random string (`openssl rand -hex 32`); HMAC key for files-page tokens |

Set them for **Production** (and Preview if you want the preview deploys to
work too), then redeploy. Changing env vars requires a redeploy to take effect.

### Notion setup — the step everyone misses

A token alone is not enough. The integration must be **invited to the database**
or every API call returns 403:

1. Open the **"cmap – Roadmap Requests"** database in Notion.
2. Click `•••` (top right) → **Add connections** → select your integration.
3. Confirm the integration has **Insert Content** capability (default for new
   integrations).

The database columns must keep these exact names/types, because the function
writes them by name:

| Column | Type | Notes |
| --- | --- | --- |
| Name | title | Student name |
| WhatsApp Number | phone_number | Normalised to `+92 3XX XXXXXXX` |
| Class | select | Matric / Inter |
| Track | select | Stream choice, Pre-Medical, Pre-Engineering, CS/IT, Commerce |
| Marks | rich_text | Optional, free text |
| Status | status | Defaults to New — the function does **not** set it |

## Payment verification — how it works

`api/verify.js` runs Tesseract.js (WASM, bundled in the function — no external
OCR API, no per-check cost). The English model (`tessdata_fast`,
`eng.traineddata` ~4 MB) is downloaded at build time by
`scripts/fetch-tessdata.js` (the `buildCommand` in `vercel.json`) so the binary
never has to be committed; if the local file is missing, the worker falls back
to tesseract.js's CDN language data. The worker is a module-level singleton,
so warm invocations skip the 1–3 s init. `vercel.json` sets `maxDuration` 60
and `memory` 2048 for this function, and `includeFiles` bundles the WASM core,
the worker script and `tessdata/` (Vercel's bundler does not auto-include
`.wasm` files from `node_modules`).

The four checks (pure functions in `api/verify.js`, unit-testable):

| Check | Pass | Fail (positive evidence of a wrong payment) | Review |
| --- | --- | --- | --- |
| Amount | Rs/PKR amount or decimal ≥ 999, or a standalone 999 (overpayment passes) | An amount below Rs 999 found | No amount found |
| Name | "Danish Kaleem" found | — | Name missing/partial |
| Account | 03295363198 (or +92 form) found | A different 03XX number found | No account number found |
| Date/time | Receipt time within the last 60 min (PKT, UTC+5) | — | Missing, stale (>60 min), or in the future |

Verdict: all four pass (and OCR confidence ≥ 50) → **pass**; any fail → **fail**;
anything else → **review**. On pass, the handler issues a signed 24h token
(`lib/tokens.js`, HMAC-SHA256 with `PAYMENT_SECRET`) and marks the Notion lead
Status → Paid. On fail/review it attaches the screenshot to the Notion lead
page (file-upload API) so a human can check it. Notion side-effects are
best-effort — a Notion failure never changes the verdict.

`api/file.js` serves roadmaps 1–6 free and 7–9 only with a valid token, with
`Cache-Control: private, no-store` so the CDN never caches premium content.

**Limits, stated plainly:** OCR reads the screenshot's pixels, not the real
JazzCash transaction — a faked screenshot can pass. That is acceptable for the
Rs 999 test tier; a real payment-gateway check (JazzCash API) is the upgrade
path if fraud appears.

`POST https://api.notion.com/v1/pages`, header `Notion-Version: 2025-09-03`.

**Important — parent form.** The original brief said to parent new rows with
`{"database_id": ...}`. That is the **legacy** form. Current Notion API
versions (2025-09-03+) parent database rows with a **data source**:

```json
{ "parent": { "type": "data_source_id", "data_source_id": "<uuid>" } }
```

The handler tries the data-source form first (using `NOTION_DATA_SOURCE_ID`)
and, only if Notion rejects it with a `validation_error`, retries once with
the legacy `{"database_id": ...}` form (using `NOTION_DATABASE_ID`). Both IDs
are known and documented above, so either API behaviour works.

Property payload shape (verified against the Notion API property reference):

```json
{
  "parent": { "type": "data_source_id", "data_source_id": "418f63d9-03e3-8130-b73b-000b5891564a" },
  "properties": {
    "Name": { "title": [{ "type": "text", "text": { "content": "Ahmed Raza" } }] },
    "WhatsApp Number": { "phone_number": "+92 300 1234567" },
    "Class": { "select": { "name": "Inter" } },
    "Track": { "select": { "name": "Pre-Medical" } },
    "Marks": { "rich_text": [{ "type": "text", "text": { "content": "Part-I 92%" } }] }
  }
}
```

Error mapping: Notion 401/403/404 → HTTP 502 with a safe user-facing message
(the form shows it and lets the user retry); 429 → HTTP 429 with `Retry-After:
30`. The token is never logged or returned.

## Local testing

```bash
# Static site only (form posts will 404 — no serverless runtime):
cd ~/workspace/cmap-site && python3 -m http.server 8000

# Full local run incl. the API function (needs the Vercel CLI + login):
npx vercel dev        # reads .env.local if present; copy .env.example first
```

The API handler cannot be live-tested against Notion without a token. Its
validation, payload shape and error paths were checked by running the handler
locally with mocked requests (see the build report) — the Notion round-trip
itself is untested until a token exists.

## Data notes

- Every merit, fee and salary figure on the page is from a published source,
  cited next to the figure and listed in the page's Sources section.
- Figures that could not be verified are written as "check the latest merit
  list" or omitted. Ranges are shown as ranges where sources disagree
  (e.g. LUMS fee, house-job pay, NUST closing aggregates).
- MDCAT 2027 and ECAT 2027 dates/fees were not announced at the time of
  writing (Nov 2026); the page says so and uses the 2026 cycle as reference.
- 2027 date sheets for BISE Lahore were not out either; the page uses the
  2026 pattern and labels it as such.
