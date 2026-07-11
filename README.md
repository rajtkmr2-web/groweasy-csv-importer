# AI CSV Importer — GrowEasy Assignment

An AI-powered CSV importer that maps leads from any CSV format (Facebook exports, Google Ads exports, real estate CRM exports, manual spreadsheets, etc.) into GrowEasy's CRM lead schema, using Gemini for intelligent field mapping.

**Position applied for:** Software Developer Intern

## Live links

- **Hosted app:** https://groweasy-csv-importer-drab.vercel.app/
- **GitHub repo:** https://github.com/rajtkmr2-web/groweasy-csv-importer

## Tech stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, PapaParse
- **Backend:** Next.js API routes (Node.js)
- **AI:** Google Gemini (`gemini-2.5-flash`) via `@google/genai`

## Setup instructions

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/rajtkmr2-web/groweasy-csv-importer.git
   cd groweasy-csv-importer
   npm install
   ```

2. Create a `.env.local` file in the project root with your Gemini API key:
   ```
   GEMINI_API_KEY=your_key_here
   ```
   Get a key at https://aistudio.google.com/app/apikey

3. Run the dev server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000

## How it works

```
Upload CSV (drag & drop or file picker)
   ↓
Parse & preview (scrollable table, sticky header, no AI yet)
   ↓
Generate AI Mapping — Gemini maps CSV columns to GrowEasy CRM fields
   ↓
Review / edit mapping (dropdowns, fully editable)
   ↓
CRM Preview — shows exactly what will be imported, with business rules applied
   ↓
Import to CRM — POSTs the transformed records to /api/import
```

### CRM fields

```
created_at, name, email, country_code, mobile_without_country_code,
company, city, state, country, lead_owner, crm_status, crm_note,
data_source, possession_time, description
```

### Business rules implemented

- **`crm_status`** is normalized to one of `GOOD_LEAD_FOLLOW_UP`, `DID_NOT_CONNECT`, `BAD_LEAD`, `SALE_DONE` based on free-text status/stage values, or left blank if nothing matches confidently.
- **`data_source`** is normalized to one of `leads_on_demand`, `meridian_tower`, `eden_park`, `varah_swamy`, `sarjapur_plots`, or left blank.
- **Multiple emails or phone numbers** in a single cell: the first is used as the primary value, and any additional ones are appended to `crm_note`.
- **`created_at`** is validated with `new Date(...)`; if it doesn't parse, the field is left blank and the original raw value is preserved in `crm_note` instead of silently corrupting the data.
- **Records with no email and no phone number are skipped** (not imported), and the skipped count is shown separately from the imported count.
- **Ambiguous column handling:**
  - If a CSV has separate "First Name" / "Last Name" columns instead of one "Name" column, they're auto-detected and combined.
  - If a CSV has a single "Phone" column with an embedded country code (e.g. `+91 9876543210`), the country code is automatically split out into `country_code`.

## Known limitations

- AI mapping quality depends on Gemini's response; low-confidence fields are flagged "Needs review" in the UI for manual correction.
- `/api/import` currently logs and echoes back the received records — it doesn't call a real external CRM API, since GrowEasy's actual import endpoint isn't available in this assignment context.

## Bonus features implemented

- Drag & drop CSV upload
- Sticky table header with vertical scroll on CSV preview
- Editable AI mapping with visual indicators (AI suggested / edited / auto-combined / needs review)
- Download transformed CSV
- Loading states + spinners on async actions
- Toast notifications
- Responsive layout
- Step progress indicator across the workflow