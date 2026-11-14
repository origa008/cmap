# cmap — landing page

Career-roadmap landing page for Matric & Inter students in Pakistan.
Static site (plain HTML/CSS/JS) + one Vercel serverless function that writes
form submissions into the Notion database **"cmap – Roadmap Requests"**.

- Position: "From your board marks to your first salary."
- Price: Rs 999 launch price, one-time.
- Form fields: name, WhatsApp number, class (Matric/Inter), track, marks (optional).

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole page: hero + form, pain stats, how it works, 5-roadmap index, why-not-ChatGPT, 5 tabbed sample roadmaps, price + form, sources, footer |
| `styles.css` | "Calm editorial trust" theme (off-white `#FAFAF8`, forest-black `#0F1F17`, lime `#B5F24B`) |
| `app.js` | Scroll-fade statements, reveal-on-scroll, roadmap tabs, form validation + submit, sticky mobile CTA |
| `api/request.js` | Vercel serverless function: validates input, creates a Notion page |
| `vercel.json` | `cleanUrls` + basic security headers |
| `.env.example` | Env vars (no real values) |
| `.gitignore` | Keeps `.env*`, `node_modules/`, `.vercel/` out of git |

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

## How the Notion call works

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
