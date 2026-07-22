# Hamleys Quality Dashboard

A static, client-side dashboard for tracking store-level product quality complaints.
It reads an Excel workbook exported from Microsoft Forms directly in the browser —
there is no backend, no build step, and no data ever leaves the device.

The dashboard ships with a pre-published `data/quality-data.json` seed file, so it is
**live from the very first deploy** — anyone who opens the page sees current data
immediately, with no upload step. An Admin panel lets you push future updates to that
same file straight from the browser (see "Publishing live data" below).

## What it does

- Upload (or drag-and-drop) the latest `.xlsx` quality-complaint export
- If the workbook has multiple sheets, pick which ones to include (monthly complaint
  logs are auto-detected and pre-checked; summary/pivot sheets are left unchecked)
- Column headers are **auto-detected from row 1 of each sheet** using pattern
  matching (e.g. anything with "store" + "code" is treated as the store code field),
  not hardcoded exact names — so the dashboard keeps working even if a future
  month's form re-orders or slightly re-words its columns
- KPI cards, six charts, a sortable/searchable data table, and filters are
  generated from whatever fields are actually present in the file:
  - Status breakdown (doughnut)
  - ROM-wise issues reported (bar, descending) — only appears once the ROM & RM
    mapping is loaded (see below)
  - Trend over time (line, monthly)
  - Top 10 vendors by defects reported (horizontal bar)
  - Top 10 article descriptions by defects reported (horizontal bar)
  - Top 10 sections by defects reported (horizontal bar) — only appears once the
    Article Section & MAP mapping is loaded (see below)
- KPI cards include Total Complaints, Open/WIP, Closed, Total Defect Quantity,
  Stores Affected and — once the Article Section & MAP mapping is loaded —
  **Estimated MAP Value Impact** (defect quantity × MAP value, summed and shown
  as Indian-locale currency)
- Date, store, ROM, status, vendor and section filters appear automatically when
  those fields are detected
- A row-level data table below the charts is sortable by column, searchable, and
  reflects the current filters
- An **Admin** panel (passcode-gated, session-only) shows the detected column
  mapping for transparency, lets you upload the optional ROM & RM mapping file
  and the optional Article Section & MAP mapping file, export the currently
  filtered rows as CSV, and publish the full dataset live to GitHub

Everything runs in-session in the browser tab. Refreshing the page clears all
loaded data — nothing is written to localStorage, cookies, or any server.

## Files

```
hamleys-quality-dashboard/
├── index.html                  # page structure
├── style.css                   # all styling (Hamleys red/white/dark-grey theme)
├── app.js                      # all logic: parsing, filtering, charts, table, admin panel
├── data/
│   └── quality-data.json       # pre-published seed data — the dashboard is live
│                                # from the first deploy; the Admin "Publish" flow
│                                # overwrites this same file for future updates
├── scripts/
│   └── generate-seed-data.js   # optional Node power-user shortcut, see below
├── package.json                # declares the `xlsx` dependency for the script above
└── README.md                   # this file
```

`data/quality-data.json` is included in this repo as **pre-published seed data**, so
the dashboard shows current numbers to leadership immediately after the first
deploy — no admin has to open the app and click Publish before anyone can see it.
The Admin publish flow (see below) remains how you push future updates; it simply
overwrites this same file with a new commit.

## Running it locally

No install, no build, no server required.

1. Download/clone this folder.
2. Open `index.html` directly in a browser (double-click it), **or** serve it
   with any simple static server if your browser blocks local file reads, e.g.:
   ```
   cd hamleys-quality-dashboard
   python3 -m http.server 8000
   ```
   then visit `http://localhost:8000`.
3. Drop in your `.xlsx` export and the dashboard populates immediately.

## Deploying to GitHub Pages

See "Deployment steps" below — five steps, no toolchain needed.

## Publishing live data (Admin → Publish to GitHub)

By default, every visitor has to upload the Excel file themselves each time.
To make the dashboard "live" instead — so leadership just opens the page and
sees the latest data with no upload step — an admin can publish once from
inside the app:

1. Open the dashboard, upload the latest `.xlsx` export as normal, and select
   the sheets you want (same as any manual session). If you also want the ROM/RM
   or Article Section/MAP mappings refreshed, upload those too (see the two
   mapping sections below) before publishing — both are bundled into the same
   published file.
2. Click **Admin** (top right) and enter the admin passcode.
3. Under **Publish live data to GitHub**, fill in:
   - **GitHub token** — a personal access token with write access to this
     repo's contents. Use a *fine-grained* token scoped to only this one
     repository with the "Contents: Read and write" permission, not a
     classic all-repos token.
   - **Repo owner / org** and **Repository name** — the GitHub repo you
     deployed this dashboard to.
   - **Branch** — defaults to `main`.
   - **File path in repo** — defaults to `data/quality-data.json`. You don't
     need to create this file or folder first; GitHub creates the path
     automatically on first publish.
4. Click **Publish current dataset**. This commits the full dataset (every
   record you loaded, not just whatever the filters are currently showing)
   straight to that path via GitHub's Contents API.
5. Wait roughly a minute for GitHub Pages to redeploy, then any visitor who
   opens the dashboard will have this published data load automatically —
   no upload button needed. A green "Live dashboard data loaded" banner
   shows when this happens, with a link to load a different file for that
   session only (doesn't affect what's published).

**Where does the token go?** It's read fresh from the password field each
time you click Publish, used to call `api.github.com` directly from your
browser, and then discarded — never written to localStorage, cookies, or any
file. It disappears the moment you refresh or close the tab. Even so, treat
it like any credential: use the narrowest-scoped token you can, don't leave
the admin panel open on a shared screen, and revoke the token afterward if
you don't need repeated access.

**Re-publishing:** running through steps 1–4 again with a newer file simply
overwrites `data/quality-data.json` with a new commit — there's nothing to
clean up first.

## ROM & RM mapping (optional, enables the ROM chart)

The "ROM-wise issues reported" chart needs to know which Regional Operations
Manager (ROM) each store reports to. This isn't in the quality-complaint
export, so it's loaded from a separate small lookup workbook:

1. In the Admin panel, under **ROM & RM mapping (optional)**, upload a workbook
   with columns for Store Code, ROM, and (optionally) RM and Store Name — column
   order doesn't matter, headers are matched by keyword (e.g. anything containing
   "store" + "code").
2. It joins onto the loaded complaint records by Store Code immediately, and the
   ROM chart and ROM filter appear.
3. If you publish afterward, this mapping is bundled into the published JSON too,
   so viewers get the ROM breakdown automatically without uploading anything.

If you re-organize ROMs/RMs later, just re-upload an updated mapping file and
re-publish — same one-time admin step, no code changes needed.

## Article Section & MAP mapping (optional, enables the Sections chart & MAP KPI)

The "Top 10 sections by defects reported" chart, the Section filter, and the
"Estimated MAP Value Impact" KPI all need to know which merchandise Section each
Article Code belongs to, and its MAP (per-unit) value. This isn't in the
quality-complaint export either, so it's loaded from a separate lookup workbook
(the same one buying/merchandising already maintains, `.xlsb`, `.xlsx` or `.xls`):

1. In the Admin panel, under **Article Section & MAP mapping (optional)**, upload
   a workbook with columns for Article Code, Section and MAP — column order
   doesn't matter, headers are matched by keyword, and `.xlsb` (Excel binary)
   files are read natively in the browser, no conversion needed.
2. It joins onto the loaded complaint records by Article Code immediately: each
   matching record gets a Section, a MAP value, and a derived MAP Impact
   (defect quantity × MAP value). The Sections chart, Section filter and the
   "Estimated MAP Value Impact" KPI card all appear once at least one record
   resolves a Section/MAP value.
3. If you publish afterward, this mapping is bundled into the published JSON
   too, so viewers get the Sections breakdown and MAP Value Impact KPI
   automatically without uploading anything.

If Section names or MAP values change later, just re-upload an updated mapping
file and re-publish — same one-time admin step, no code changes needed.

## Admin passcode

The admin panel uses a simple front-of-house passcode set in `app.js`
(`ADMIN_PASSCODE`, default `hamleys2026`). This is **not** real security — it
only hides the CSV export and column-mapping view from store staff by default.
Anyone with the source file can read the passcode, so don't use it to gate
anything genuinely sensitive. Change it by editing the constant near the top
of `app.js` before deploying if you want a different word.

## Customizing field detection

If a future form export uses wording the pattern rules don't recognize, open
`app.js` and look at the `FIELD_RULES` array near the top — each rule is a
`{ key, test }` pair where `test` receives the lower-cased, whitespace-normalized
header text. Add or adjust a rule's regex to teach the dashboard about the new
wording; no other code needs to change.

## Regenerating seed data with Node (optional, power-user shortcut)

The primary way to update the live dataset is the in-browser Admin → Publish
flow described above — no Node.js or npm required for normal use. If you'd
rather regenerate `data/quality-data.json` from source workbooks on your own
machine instead (e.g. for a bulk historical reload, or to script it into a
CI job), an optional helper is included:

```
npm install
node scripts/generate-seed-data.js
```

By default it looks for the three source workbooks (the main quality-complaint
export, the ROM & RM mapping, and the Article Section & MAP mapping) in a
`./source-data/` folder next to this script, matching filenames by keyword so
exact names/dates don't matter. Pass `--dir=/path/to/folder` to point it
elsewhere. It reuses the exact same parsing/normalization/join functions from
`app.js` (via `require('../app.js')`) — not a reimplementation — so its output
is equivalent to what an in-browser Publish click against the same three files
would produce. This script only writes the local `data/quality-data.json`
file; you still need to commit and push it (or use the in-browser Publish
flow instead, which commits directly).

## Browser support

Any modern evergreen browser (Chrome, Edge, Firefox, Safari). Excel parsing and
charting both run client-side via CDN-loaded libraries (SheetJS and Chart.js).

---

## Deployment steps

1. Create a new GitHub repository (public, or private with Pages enabled on your plan).
2. Push the contents of this `hamleys-quality-dashboard/` folder to the repository root (or to a `/docs` folder — your choice).
3. In the repo, go to **Settings → Pages**, and under "Build and deployment" set Source to "Deploy from a branch".
4. Select the branch (e.g. `main`) and folder (`/root` or `/docs`, matching step 2), then save.
5. Wait a minute for the build, then open the URL GitHub Pages gives you (e.g. `https://<username>.github.io/<repo-name>/`).
