# Hamleys Quality Dashboard

A static, client-side dashboard for tracking store-level product quality complaints.
It reads an Excel workbook exported from Microsoft Forms directly in the browser —
there is no backend, no build step, and no data ever leaves the device.

## What it does

- Upload (or drag-and-drop) the latest `.xlsx` quality-complaint export
- If the workbook has multiple sheets, pick which ones to include (monthly complaint
  logs are auto-detected and pre-checked; summary/pivot sheets are left unchecked)
- Column headers are **auto-detected from row 1 of each sheet** using pattern
  matching (e.g. anything with "store" + "code" is treated as the store code field),
  not hardcoded exact names — so the dashboard keeps working even if a future
  month's form re-orders or slightly re-words its columns
- KPI cards, five charts, and filters are generated from whatever fields are
  actually present in the file:
  - Status breakdown (doughnut)
  - ROM-wise issues reported (bar, descending) — only appears once the ROM & RM
    mapping is loaded (see below)
  - Trend over time (line, monthly)
  - Top 10 vendors by defects reported (horizontal bar)
  - Top 10 article descriptions by defects reported (horizontal bar)
- Date, store, ROM, status and vendor filters appear automatically when those
  fields are detected
- An **Admin** panel (passcode-gated, session-only) shows the detected column
  mapping for transparency, lets you upload the optional ROM & RM mapping file,
  export the currently filtered rows as CSV, and publish the full dataset live
  to GitHub

Everything runs in-session in the browser tab. Refreshing the page clears all
loaded data — nothing is written to localStorage, cookies, or any server.

## Files

```
hamleys-quality-dashboard/
├── index.html   # page structure
├── style.css    # all styling (Hamleys red/white/dark-grey theme)
├── app.js       # all logic: parsing, filtering, charts, table, admin panel
└── README.md    # this file
```

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
   the sheets you want (same as any manual session).
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
