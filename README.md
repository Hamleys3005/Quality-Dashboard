# Hamleys Quality Dashboard

Live store quality complaint tracking & analysis — static, client-side, no backend.
Reads Microsoft Forms `.xlsx` exports directly in the browser via SheetJS, charts via Chart.js.

Live at: https://hamleys3005.github.io/Quality-Dashboard/

## What's on the dashboard

**KPIs**
- Total Complaints (count)
- Open / WIP (**%** of total)
- Closed (**%** of total)
- Total Defect Quantity
- Stores Affected
- Estimated MAP Value Impact (₹) — shown once the Article Section & MAP mapping is loaded

**Charts**
- Status breakdown (doughnut)
- ROM-wise issues reported — needs ROM & RM mapping uploaded in Admin
- Trend over time (complaint count, monthly)
- Top 10 vendors by defects reported — vendor names abbreviated on the axis for readability, full name on hover
- Top 10 article descriptions by defects reported
- Top 10 sections by defects reported — section names abbreviated on the axis, full name on hover; needs Article Section & MAP mapping
- **Month-wise quality defects — Hamleys level**: total defect quantity per calendar month across the whole filtered dataset
- **Month-wise value of defects (₹)**: total MAP value impact per calendar month — needs Article Section & MAP mapping

**Filters**
Date range, Store, ROM, Status, Vendor, Section, **Article Code**, **Item Description**.

There is no raw complaint-records table in this build — it was removed by request.
Use **Export filtered data as CSV** in the Admin panel if you need row-level data.

## Files

```
hamleys-quality-dashboard/
├── index.html   # page structure
├── style.css    # all styling (Hamleys red/white/dark-grey theme)
├── app.js       # all logic: parsing, filtering, charts, admin panel
└── README.md    # this file
```

## Running it locally

No install, no build, no server required.

1. Download/clone this folder.
2. Open `index.html` directly in a browser (double-click it), **or** serve it
   with any simple static server if your browser blocks local file reads:
   ```
   cd hamleys-quality-dashboard
   python3 -m http.server 8000
   ```
   then visit `http://localhost:8000`.
3. Drop in your `.xlsx` export and the dashboard populates immediately.

## Admin passcode

The admin panel uses a simple front-of-house passcode set in `app.js`
(`ADMIN_PASSCODE`, default `hamleys2026`). This is **not** real security — it
only hides the CSV export, mapping uploads, and publish flow from store staff
by default. Anyone with the source file can read the passcode, so don't use
it to gate anything genuinely sensitive.

## Publishing live data (Admin panel)

1. Upload the latest `.xlsx` export as normal and select sheets.
2. Click **Admin**, enter the passcode.
3. Under **Publish live data to GitHub**, fill in a fine-grained GitHub token
   (Contents: Read and write, scoped to this repo only), owner, repo, branch,
   and file path (defaults to `data/quality-data.json`).
4. Click **Publish current dataset**. GitHub Pages redeploys in ~1 minute;
   visitors then see the data automatically with no upload step.

## Customizing field detection

If a future form export uses wording the pattern rules don't recognize, open
`app.js` and look at the `FIELD_RULES` array near the top — each rule is a
`{ key, test }` pair matched against the lower-cased header text. Add or
adjust a rule's regex; no other code needs to change.

## Browser support

Any modern evergreen browser (Chrome, Edge, Firefox, Safari).

---

## Deployment steps

1. Push the contents of this folder to the repository root of
   `hamleys3005/Quality-Dashboard`.
2. In the repo, go to **Settings → Pages**, set Source to "Deploy from a branch".
3. Select branch `main`, folder `/root`, then save.
4. Wait ~a minute for the build.
5. Hard-refresh the live URL to bust any cached copy of the old files.
