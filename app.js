/* =========================================================================
   Hamleys Quality Dashboard
   Pure client-side: SheetJS parses the workbook, everything else runs here.
   No network calls after the CDN scripts load. No localStorage/cookies.
   ========================================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     State (in-memory only, cleared on refresh)
     ------------------------------------------------------------------- */
  const state = {
    workbook: null,
    sheetNames: [],
    selectedSheets: [],
    records: [],          // unified, canonical-field records across sheets
    fields: {},           // canonical field -> detected (originalHeader, sheet) info, for admin view
    fieldsPresent: new Set(), // which canonical fields were actually found anywhere
    filters: {},
    sortKey: null,
    sortDir: 1,
    charts: {},
    isAdmin: false
  };

  const ADMIN_PASSCODE = "hamleys2026"; // simple front-of-house gate, not real security

  // Relative path (within this same GitHub Pages site) that the admin "Publish"
  // action commits to, and that every visitor's browser tries to auto-load on
  // page open. Must match the "File path in repo" field in the admin panel.
  const DATA_JSON_PATH = "data/quality-data.json";

  /* ---------------------------------------------------------------------
     Canonical field detection
     Headers drift month to month in real MS Forms exports (e.g.
     "SM Name" vs "Store Manager Name"), so we match by keyword pattern
     against row 1 rather than expecting an exact fixed name.
     ------------------------------------------------------------------- */
  const FIELD_RULES = [
    { key: "dateOfIssue",       test: h => /date/.test(h) && /issue|submit|response|timestamp/.test(h) },
    { key: "manufacturingDate", test: h => /manufactur/.test(h) },
    { key: "articleCode",       test: h => /article/.test(h) && /code/.test(h) },
    { key: "itemDescription",   test: h => /item/.test(h) && /desc/.test(h) },
    { key: "vendorName",        test: h => /vendor/.test(h) && /name/.test(h) },
    { key: "issueDescription",  test: h => /(describe|detail).*issue|issue.*detail|quality issue/.test(h) },
    { key: "complaintStage",    test: h => /complaint/.test(h) && /stage/.test(h) },
    { key: "batchCode",         test: h => /batch/.test(h) },
    { key: "storeCode",         test: h => /store/.test(h) && /code/.test(h) },
    { key: "storeLocation",     test: h => /store/.test(h) && /location/.test(h) },
    { key: "defectQuantity",    test: h => /defect/.test(h) && /(qty|quantity)/.test(h) },
    { key: "category",          test: h => /^category$/.test(h) || (/categor/.test(h) && h.split(/\s+/).length <= 2) },
    { key: "rootCause",         test: h => /root/.test(h) && /cause/.test(h) },
    { key: "containmentAction", test: h => /containment/.test(h) },
    { key: "status",            test: h => /^status$/.test(h) },
    { key: "closureTarget",     test: h => /closure/.test(h) },
    { key: "vendorRemarks",     test: h => /vendor/.test(h) && /remark/.test(h) },
    { key: "storeRemarks",      test: h => /store/.test(h) && /remark/.test(h) && !/manager/.test(h) },
    { key: "clusterLeader",     test: h => /cluster/.test(h) && (/leader/.test(h) || /quality/.test(h)) },
    { key: "smName",            test: h => (/^sm\b/.test(h) || /store manager/.test(h)) && /name/.test(h) },
    { key: "smEmail",           test: h => (/^sm\b/.test(h) || /store manager/.test(h) || /manager/.test(h)) && /e[\s-]?mail/.test(h) },
    { key: "smNumber",          test: h => (/^sm\b/.test(h) || /store manager/.test(h)) && /(number|contact)/.test(h) },
    // generic "Contact Number" columns get resolved positionally below
  ];

  function normalizeHeader(h) {
    return String(h == null ? "" : h).toLowerCase().replace(/[_\-\.]/g, " ").replace(/\s+/g, " ").trim();
  }

  function detectFieldMap(headers) {
    // headers: array of raw header strings (row 1), in column order
    const norm = headers.map(normalizeHeader);
    const map = {};        // colIndex -> canonicalKey
    const claimed = new Set();

    norm.forEach((h, i) => {
      if (!h) return;
      for (const rule of FIELD_RULES) {
        if (claimed.has(rule.key)) continue;
        if (rule.test(h)) {
          map[i] = rule.key;
          claimed.add(rule.key);
          break;
        }
      }
    });

    // Positional resolution for ambiguous "Contact Number" style columns:
    // assign to whichever canonical contact-ish field is nearest above it
    // and not yet mapped to a number, based on the immediately preceding
    // mapped field (SM block vs Cluster block).
    norm.forEach((h, i) => {
      if (map[i]) return;
      if (!/contact/.test(h) && !/number/.test(h)) return;
      // look backwards for context
      for (let j = i - 1; j >= 0; j--) {
        const prevKey = map[j];
        if (!prevKey) continue;
        if (prevKey === "smName" || prevKey === "smEmail") {
          if (!claimed.has("smNumber")) { map[i] = "smNumber"; claimed.add("smNumber"); }
          break;
        }
        if (prevKey === "clusterLeader") {
          if (!claimed.has("clusterContact")) { map[i] = "clusterContact"; claimed.add("clusterContact"); }
          break;
        }
        break; // stop at first mapped column either way
      }
    });

    return map; // colIndex -> canonicalKey (only for recognized columns)
  }

  const CANONICAL_LABELS = {
    dateOfIssue: "Date of Issue",
    manufacturingDate: "Manufacturing Date",
    articleCode: "Article Code",
    itemDescription: "Item Description",
    vendorName: "Vendor Name",
    issueDescription: "Issue Description",
    complaintStage: "Complaint Stage",
    batchCode: "Batch Code",
    storeCode: "Store Code",
    storeLocation: "Store Location",
    defectQuantity: "Defect Quantity",
    category: "Category",
    rootCause: "Root Cause",
    containmentAction: "Containment Action",
    status: "Status",
    closureTarget: "Closure Target",
    vendorRemarks: "Vendor Remarks",
    storeRemarks: "Store Remarks",
    clusterLeader: "Cluster Quality Leader",
    clusterContact: "Cluster Leader Contact",
    smName: "Store Manager Name",
    smEmail: "Store Manager Email",
    smNumber: "Store Manager Contact"
  };

  // Preferred column order for the raw table
  const TABLE_COLUMN_ORDER = [
    "dateOfIssue","storeCode","storeLocation","articleCode","itemDescription",
    "vendorName","category","issueDescription","defectQuantity","rootCause",
    "containmentAction","status","closureTarget","complaintStage","batchCode",
    "manufacturingDate","smName","smNumber","smEmail","clusterLeader","clusterContact",
    "vendorRemarks","storeRemarks"
  ];

  /* ---------------------------------------------------------------------
     Sheet ingestion
     ------------------------------------------------------------------- */
  function excelSerialToDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === "number") {
      // Excel serial date -> JS Date (days since 1899-12-30)
      const utc = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(utc);
      if (!isNaN(d.getTime())) return d;
    }
    if (typeof v === "string") {
      const s = v.trim();
      // MMYYYY like "08/2025" or "112025"
      let m = s.match(/^(\d{2})\/(\d{4})$/);
      if (m) return new Date(parseInt(m[2], 10), parseInt(m[1], 10) - 1, 1);
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function isLikelyDataSheet(sheetJsonRows) {
    if (!sheetJsonRows || sheetJsonRows.length < 2) return false;
    const header = sheetJsonRows[0];
    const populated = header.filter(c => c !== null && c !== undefined && String(c).trim() !== "");
    return populated.length >= 8; // monthly complaint sheets have 18-21 cols; lookup/summary sheets don't
  }

  function loadWorkbookFromArrayBuffer(buf) {
    state.workbook = XLSX.read(buf, { type: "array", cellDates: true });
    state.sheetNames = state.workbook.SheetNames;
    renderSheetPicker();
  }

  function renderSheetPicker() {
    const wrap = document.getElementById("sheetCheckboxes");
    wrap.innerHTML = "";
    state.sheetNames.forEach(name => {
      const ws = state.workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const looksLikeData = isLikelyDataSheet(rows);

      const id = "sheet_" + name.replace(/[^a-z0-9]/gi, "_");
      const div = document.createElement("label");
      div.className = "sheet-check";
      div.innerHTML = `<input type="checkbox" id="${id}" value="${name}" ${looksLikeData ? "checked" : ""}/> ${name} <span style="color:#9a9aa0">(${rows.length ? rows.length - 1 : 0} rows${looksLikeData ? "" : ", not detected as complaint data"})</span>`;
      wrap.appendChild(div);
    });
    document.getElementById("sheetPicker").classList.remove("hidden");
    document.getElementById("statusMsg").textContent = "Workbook loaded. Select sheets to include, then click \"Load selected sheets\".";
    document.getElementById("statusMsg").className = "status-msg";
  }

  function loadSelectedSheets() {
    const checked = Array.from(document.querySelectorAll("#sheetCheckboxes input:checked")).map(cb => cb.value);
    if (checked.length === 0) {
      setStatus("Select at least one sheet to load.", "error");
      return;
    }
    state.selectedSheets = checked;
    state.records = [];
    state.fields = {};
    state.fieldsPresent = new Set();

    checked.forEach(sheetName => {
      const ws = state.workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      if (rows.length < 2) return;

      const headers = rows[0];
      const colMap = detectFieldMap(headers);

      // record mapping info for admin view
      Object.entries(colMap).forEach(([colIdx, key]) => {
        if (!state.fields[key]) state.fields[key] = [];
        state.fields[key].push({ sheet: sheetName, header: headers[colIdx] });
        state.fieldsPresent.add(key);
      });

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every(c => c === null || c === undefined || String(c).trim() === "")) continue;

        const record = { __sheet: sheetName, __extra: {} };
        headers.forEach((h, i) => {
          const key = colMap[i];
          const rawVal = row[i] !== undefined ? row[i] : null;
          if (key) {
            record[key] = rawVal;
          } else if (h !== null && h !== undefined && String(h).trim() !== "") {
            const cleanHeader = String(h).trim();
            record.__extra[cleanHeader] = rawVal;
          }
        });
        state.records.push(record);
      }
    });

    if (state.records.length === 0) {
      setStatus("No data rows found in the selected sheet(s).", "error");
      return;
    }

    setStatus(`Loaded ${state.records.length} records from ${checked.length} sheet(s).`, "success");
    state.dataSource = "upload";
    hideLiveBanner();
    showDashboard();
  }

  function showDashboard() {
    document.getElementById("dashboardContent").classList.remove("hidden");
    buildFilters();
    applyFiltersAndRender();
  }

  function setStatus(msg, type) {
    const el = document.getElementById("statusMsg");
    el.textContent = msg;
    el.className = "status-msg" + (type ? " " + type : "");
  }

  /* ---------------------------------------------------------------------
     Filters
     ------------------------------------------------------------------- */
  function uniqueValues(key) {
    const set = new Set();
    state.records.forEach(r => {
      const v = r[key];
      if (v !== null && v !== undefined && String(v).trim() !== "") set.add(String(v).trim());
    });
    return Array.from(set).sort();
  }

  function buildFilters() {
    const grid = document.getElementById("filtersGrid");
    grid.innerHTML = "";
    state.filters = {};

    const categoricalCandidates = ["storeCode", "storeLocation", "category", "status", "vendorName", "clusterLeader"];
    categoricalCandidates.forEach(key => {
      if (!state.fieldsPresent.has(key)) return;
      const values = uniqueValues(key);
      if (values.length === 0 || values.length > 400) return;

      const field = document.createElement("div");
      field.className = "filter-field";
      const label = CANONICAL_LABELS[key] || key;
      field.innerHTML = `
        <label for="filter_${key}">${label}</label>
        <select id="filter_${key}">
          <option value="">All</option>
          ${values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}
        </select>`;
      grid.appendChild(field);
      state.filters[key] = "";
    });

    // date filter
    if (state.fieldsPresent.has("dateOfIssue")) {
      const field = document.createElement("div");
      field.className = "filter-field";
      field.innerHTML = `
        <label for="filter_dateFrom">From date</label>
        <input type="date" id="filter_dateFrom" />`;
      grid.appendChild(field);

      const field2 = document.createElement("div");
      field2.className = "filter-field";
      field2.innerHTML = `
        <label for="filter_dateTo">To date</label>
        <input type="date" id="filter_dateTo" />`;
      grid.appendChild(field2);
      state.filters.dateFrom = "";
      state.filters.dateTo = "";
    }

    grid.querySelectorAll("select, input").forEach(el => {
      el.addEventListener("change", () => {
        const id = el.id.replace("filter_", "");
        state.filters[id] = el.value;
        applyFiltersAndRender();
      });
    });
  }

  function resetFilters() {
    document.querySelectorAll("#filtersGrid select").forEach(s => s.value = "");
    document.querySelectorAll("#filtersGrid input").forEach(i => i.value = "");
    Object.keys(state.filters).forEach(k => state.filters[k] = "");
    document.getElementById("tableSearch").value = "";
    applyFiltersAndRender();
  }

  function getFilteredRecords() {
    return state.records.filter(r => {
      for (const key of ["storeCode", "storeLocation", "category", "status", "vendorName", "clusterLeader"]) {
        const fv = state.filters[key];
        if (fv && String(r[key] || "").trim() !== fv) return false;
      }
      if (state.filters.dateFrom || state.filters.dateTo) {
        const d = excelSerialToDate(r.dateOfIssue);
        if (!d) return false;
        if (state.filters.dateFrom) {
          const from = new Date(state.filters.dateFrom);
          if (d < from) return false;
        }
        if (state.filters.dateTo) {
          const to = new Date(state.filters.dateTo);
          to.setHours(23, 59, 59, 999);
          if (d > to) return false;
        }
      }
      const search = (document.getElementById("tableSearch").value || "").toLowerCase().trim();
      if (search) {
        const hay = JSON.stringify(r).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  /* ---------------------------------------------------------------------
     KPIs
     ------------------------------------------------------------------- */
  function renderKpis(rows) {
    const grid = document.getElementById("kpiGrid");
    grid.innerHTML = "";

    const totalComplaints = rows.length;

    let totalDefectQty = 0, qtyCount = 0;
    rows.forEach(r => {
      const v = r.defectQuantity;
      if (typeof v === "number") { totalDefectQty += v; qtyCount++; }
      else if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) { totalDefectQty += Number(v); qtyCount++; }
    });

    let closed = 0, open = 0, statusKnown = 0;
    rows.forEach(r => {
      const s = String(r.status || "").trim().toLowerCase();
      if (!s) return;
      statusKnown++;
      if (s === "closed" || s === "close") closed++;
      else open++;
    });
    const closureRate = statusKnown ? Math.round((closed / statusKnown) * 100) : null;

    const uniqueStores = state.fieldsPresent.has("storeCode") ? new Set(rows.map(r => r.storeCode).filter(Boolean)).size : null;
    const uniqueVendors = state.fieldsPresent.has("vendorName") ? new Set(rows.map(r => r.vendorName).filter(Boolean)).size : null;

    const cards = [];
    cards.push({ label: "Total Complaints", value: totalComplaints.toLocaleString() });
    if (qtyCount > 0) cards.push({ label: "Total Defect Qty", value: totalDefectQty.toLocaleString() });
    if (statusKnown > 0) cards.push({ label: "Closure Rate", value: closureRate + "%", sub: `${closed} closed / ${open} open` });
    if (uniqueStores !== null) cards.push({ label: "Stores Affected", value: uniqueStores.toLocaleString() });
    if (uniqueVendors !== null) cards.push({ label: "Vendors Involved", value: uniqueVendors.toLocaleString() });

    cards.forEach(c => {
      const div = document.createElement("div");
      div.className = "kpi-card";
      div.innerHTML = `
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.value}</div>
        ${c.sub ? `<div class="kpi-sub">${c.sub}</div>` : ""}`;
      grid.appendChild(div);
    });
  }

  /* ---------------------------------------------------------------------
     Charts
     ------------------------------------------------------------------- */
  const CHART_COLORS = ["#E3001B", "#222225", "#7A7A80", "#C77700", "#1E8E4E", "#4A4A4E", "#B50014", "#D6D6DA"];

  function destroyChart(key) {
    if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
  }

  function countBy(rows, key) {
    const map = new Map();
    rows.forEach(r => {
      const v = r[key];
      const label = (v === null || v === undefined || String(v).trim() === "") ? "(blank)" : String(v).trim();
      map.set(label, (map.get(label) || 0) + 1);
    });
    return map;
  }

  function renderCharts(rows) {
    renderStatusChart(rows);
    renderCategoryChart(rows);
    renderTrendChart(rows);
    renderStoresChart(rows);
  }

  function renderStatusChart(rows) {
    const card = document.getElementById("chartStatus").closest(".chart-card");
    if (!state.fieldsPresent.has("status")) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const map = countBy(rows, "status");
    const labels = Array.from(map.keys());
    const data = Array.from(map.values());

    destroyChart("status");
    state.charts.status = new Chart(document.getElementById("chartStatus"), {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  }

  function renderCategoryChart(rows) {
    const card = document.getElementById("chartCategory").closest(".chart-card");
    if (!state.fieldsPresent.has("category")) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const map = countBy(rows, "category");
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);

    destroyChart("category");
    state.charts.category = new Chart(document.getElementById("chartCategory"), {
      type: "bar",
      data: {
        labels: sorted.map(e => e[0]),
        datasets: [{ label: "Complaints", data: sorted.map(e => e[1]), backgroundColor: "#E3001B" }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function renderTrendChart(rows) {
    const card = document.getElementById("chartTrend").closest(".chart-card");
    if (!state.fieldsPresent.has("dateOfIssue")) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");

    const monthMap = new Map();
    rows.forEach(r => {
      const d = excelSerialToDate(r.dateOfIssue);
      if (!d) return;
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    });
    const sortedKeys = Array.from(monthMap.keys()).sort();
    const labels = sortedKeys.map(k => {
      const [y, m] = k.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    });

    destroyChart("trend");
    state.charts.trend = new Chart(document.getElementById("chartTrend"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Complaints per month",
          data: sortedKeys.map(k => monthMap.get(k)),
          borderColor: "#E3001B",
          backgroundColor: "rgba(227,0,27,0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function renderStoresChart(rows) {
    const card = document.getElementById("chartStores").closest(".chart-card");
    const key = state.fieldsPresent.has("storeCode") ? "storeCode" : (state.fieldsPresent.has("vendorName") ? "vendorName" : null);
    if (!key) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    document.getElementById("chart4Title").textContent = key === "storeCode" ? "Top stores by complaint count" : "Top vendors by complaint count";

    const map = countBy(rows, key);
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);

    destroyChart("stores");
    state.charts.stores = new Chart(document.getElementById("chartStores"), {
      type: "bar",
      data: {
        labels: sorted.map(e => e[0]),
        datasets: [{ label: "Complaints", data: sorted.map(e => e[1]), backgroundColor: "#222225" }]
      },
      options: {
        indexAxis: "y",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  /* ---------------------------------------------------------------------
     Table
     ------------------------------------------------------------------- */
  function getTableColumns() {
    const cols = TABLE_COLUMN_ORDER.filter(k => state.fieldsPresent.has(k));
    // append any extra/unmapped headers found across records
    const extraHeaders = new Set();
    state.records.forEach(r => Object.keys(r.__extra || {}).forEach(h => extraHeaders.add(h)));
    return { canonical: cols, extras: Array.from(extraHeaders) };
  }

  function formatCell(key, value) {
    if (value === null || value === undefined || String(value).trim() === "") return "";
    if (key === "dateOfIssue" || key === "manufacturingDate" || key === "closureTarget") {
      const d = excelSerialToDate(value);
      if (d) return d.toLocaleDateString("en-GB");
    }
    return escapeHtml(String(value));
  }

  function renderTable(rows) {
    const { canonical, extras } = getTableColumns();
    const headRow = document.getElementById("tableHeadRow");
    headRow.innerHTML = "";

    const allCols = canonical.map(k => ({ key: k, label: CANONICAL_LABELS[k] || k, extra: false }))
      .concat(extras.map(h => ({ key: "__extra." + h, label: h, extra: true })));

    allCols.forEach(col => {
      const th = document.createElement("th");
      let arrow = "";
      if (state.sortKey === col.key) arrow = `<span class="sort-arrow">${state.sortDir === 1 ? "▲" : "▼"}</span>`;
      th.innerHTML = `${escapeHtml(col.label)}${arrow}`;
      th.addEventListener("click", () => {
        if (state.sortKey === col.key) state.sortDir *= -1;
        else { state.sortKey = col.key; state.sortDir = 1; }
        applyFiltersAndRender();
      });
      headRow.appendChild(th);
    });

    let sortedRows = rows.slice();
    if (state.sortKey) {
      sortedRows.sort((a, b) => {
        const va = getCellValue(a, state.sortKey);
        const vb = getCellValue(b, state.sortKey);
        if (va === vb) return 0;
        if (va === null || va === undefined || va === "") return 1;
        if (vb === null || vb === undefined || vb === "") return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * state.sortDir;
        return String(va).localeCompare(String(vb)) * state.sortDir;
      });
    }

    const body = document.getElementById("tableBody");
    body.innerHTML = "";
    const maxRender = 1000; // keep the DOM responsive on very large filtered sets
    sortedRows.slice(0, maxRender).forEach(r => {
      const tr = document.createElement("tr");
      allCols.forEach(col => {
        const td = document.createElement("td");
        const raw = getCellValue(r, col.key);
        if (col.key === "status" && raw) {
          const cls = /closed/i.test(raw) ? "status-closed" : /wip|open|pending/i.test(raw) ? "status-wip" : "status-other";
          td.innerHTML = `<span class="status-pill ${cls}">${escapeHtml(String(raw))}</span>`;
        } else {
          td.textContent = formatCell(col.key.replace("__extra.", ""), raw);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    const countLabel = sortedRows.length > maxRender
      ? `Showing ${maxRender} of ${sortedRows.length} rows (refine filters to see more)`
      : `${sortedRows.length} row(s)`;
    document.getElementById("rowCount").textContent = countLabel;
  }

  function getCellValue(record, colKey) {
    if (colKey.startsWith("__extra.")) {
      const h = colKey.slice("__extra.".length);
      return record.__extra ? record.__extra[h] : null;
    }
    return record[colKey];
  }

  /* ---------------------------------------------------------------------
     Orchestration
     ------------------------------------------------------------------- */
  function applyFiltersAndRender() {
    const rows = getFilteredRecords();
    renderKpis(rows);
    renderCharts(rows);
    renderTable(rows);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------------------------------------------------------------
     Auto-load published data (data/quality-data.json) on page open
     ------------------------------------------------------------------- */
  async function tryAutoLoadPublishedData() {
    try {
      const res = await fetch(DATA_JSON_PATH, { cache: "no-store" });
      if (!res.ok) return false; // 404 = nothing published yet, that's expected/fine
      const payload = await res.json();
      hydrateStateFromPayload(payload);
      state.dataSource = "published";
      showLiveBanner(payload.generatedAt, payload.selectedSheets);
      showDashboard();
      setStatus("Live published data loaded automatically.", "success");
      return true;
    } catch (err) {
      // No published file yet, or it's not valid JSON - fall back to manual upload silently.
      return false;
    }
  }

  function hydrateStateFromPayload(payload) {
    state.records = payload.records || [];
    state.fields = payload.fields || {};
    state.fieldsPresent = new Set(payload.fieldsPresent || []);
    state.selectedSheets = payload.selectedSheets || [];
    state.workbook = null;
    state.sheetNames = [];
  }

  function showLiveBanner(generatedAt, selectedSheets) {
    const banner = document.getElementById("liveBanner");
    const meta = document.getElementById("liveBannerMeta");
    const when = generatedAt ? new Date(generatedAt).toLocaleString("en-GB") : "unknown time";
    const sheets = (selectedSheets || []).join(", ") || "unknown sheets";
    meta.textContent = ` \u2014 published ${when} from: ${sheets}`;
    banner.classList.remove("hidden");
    document.getElementById("uploadSection").classList.add("hidden");
  }

  function hideLiveBanner() {
    document.getElementById("liveBanner").classList.add("hidden");
  }

  /* ---------------------------------------------------------------------
     Upload wiring (click + drag/drop)
     ------------------------------------------------------------------- */
  function handleFile(file) {
    if (!file) return;
    document.getElementById("fileName").textContent = file.name;
    setStatus("Reading workbook...", null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        loadWorkbookFromArrayBuffer(new Uint8Array(e.target.result));
      } catch (err) {
        console.error(err);
        setStatus("Could not read this file. Please confirm it is a valid .xlsx / .xls export.", "error");
      }
    };
    reader.onerror = () => setStatus("Error reading file.", "error");
    reader.readAsArrayBuffer(file);
  }

  function initUpload() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileInput");

    document.getElementById("browseBtn").addEventListener("click", e => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

    ["dragenter", "dragover"].forEach(evt =>
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add("drag-over"); }));
    ["dragleave", "drop"].forEach(evt =>
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove("drag-over"); }));
    dropZone.addEventListener("drop", e => {
      const file = e.dataTransfer.files[0];
      handleFile(file);
    });

    document.getElementById("loadSheetsBtn").addEventListener("click", loadSelectedSheets);
    document.getElementById("resetFiltersBtn").addEventListener("click", resetFilters);
    document.getElementById("tableSearch").addEventListener("input", debounce(applyFiltersAndRender, 200));

    document.getElementById("loadDifferentFileBtn").addEventListener("click", () => {
      document.getElementById("uploadSection").classList.remove("hidden");
      document.getElementById("uploadSection").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------------------------------------------------------------------
     Admin panel
     ------------------------------------------------------------------- */
  function initAdmin() {
    const overlay = document.getElementById("adminOverlay");
    document.getElementById("adminToggleBtn").addEventListener("click", () => {
      overlay.classList.remove("hidden");
      document.getElementById("adminLoginView").classList.toggle("hidden", state.isAdmin);
      document.getElementById("adminToolsView").classList.toggle("hidden", !state.isAdmin);
      if (state.isAdmin) renderAdminTools();
    });
    document.getElementById("adminCloseBtn").addEventListener("click", () => overlay.classList.add("hidden"));
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.add("hidden"); });

    document.getElementById("adminLoginBtn").addEventListener("click", () => {
      const val = document.getElementById("adminPassword").value;
      if (val === ADMIN_PASSCODE) {
        state.isAdmin = true;
        document.getElementById("adminError").textContent = "";
        document.getElementById("adminLoginView").classList.add("hidden");
        document.getElementById("adminToolsView").classList.remove("hidden");
        renderAdminTools();
      } else {
        document.getElementById("adminError").textContent = "Incorrect passcode.";
      }
    });

    document.getElementById("adminPassword").addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("adminLoginBtn").click();
    });
  }

  function renderAdminTools() {
    const mapWrap = document.getElementById("columnMappingTable");
    if (Object.keys(state.fields).length === 0) {
      mapWrap.innerHTML = "<p class='admin-note'>Load a workbook first to see detected field mapping.</p>";
    } else {
      let html = "<table><thead><tr><th>Canonical field</th><th>Sheet</th><th>Original header</th></tr></thead><tbody>";
      Object.entries(state.fields).forEach(([key, sources]) => {
        sources.forEach(s => {
          html += `<tr><td>${escapeHtml(CANONICAL_LABELS[key] || key)}</td><td>${escapeHtml(s.sheet)}</td><td>${escapeHtml(String(s.header))}</td></tr>`;
        });
      });
      html += "</tbody></table>";
      mapWrap.innerHTML = html;
    }

    document.getElementById("sessionInfo").textContent =
      state.records.length
        ? `${state.records.length} records loaded from sheet(s): ${state.selectedSheets.join(", ")}. Nothing persists after refresh.`
        : "No data loaded yet.";

    document.getElementById("exportCsvBtn").onclick = exportFilteredCsv;
    document.getElementById("publishBtn").onclick = publishToGithub;
  }

  function exportFilteredCsv() {
    const rows = getFilteredRecords();
    if (rows.length === 0) { alert("No rows to export with current filters."); return; }
    const { canonical, extras } = getTableColumns();
    const allCols = canonical.map(k => ({ key: k, label: CANONICAL_LABELS[k] || k }))
      .concat(extras.map(h => ({ key: "__extra." + h, label: h })));

    const lines = [allCols.map(c => csvEscape(c.label)).join(",")];
    rows.forEach(r => {
      const line = allCols.map(c => {
        const v = getCellValue(r, c.key);
        const formatted = formatCell(c.key.replace("__extra.", ""), v);
        return csvEscape(formatted);
      }).join(",");
      lines.push(line);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hamleys_quality_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------------------------------------------------------------------
     Publish to GitHub (Contents API)
     Commits the full loaded dataset as JSON so every visitor's browser can
     auto-load it via tryAutoLoadPublishedData() above. The token only ever
     lives in this tab's JS memory - it is read fresh from the input each
     click and never written to storage of any kind.
     ------------------------------------------------------------------- */
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function publishToGithub() {
    const token = document.getElementById("ghToken").value.trim();
    const owner = document.getElementById("ghOwner").value.trim();
    const repo = document.getElementById("ghRepo").value.trim();
    const branch = document.getElementById("ghBranch").value.trim() || "main";
    const path = document.getElementById("ghPath").value.trim() || DATA_JSON_PATH;
    const statusEl = document.getElementById("publishStatus");

    if (!token || !owner || !repo) {
      statusEl.textContent = "Fill in the token, repo owner, and repo name first.";
      statusEl.style.color = "var(--hamleys-red)";
      return;
    }
    if (state.records.length === 0) {
      statusEl.textContent = "Load a workbook first - nothing to publish yet.";
      statusEl.style.color = "var(--hamleys-red)";
      return;
    }

    statusEl.textContent = "Publishing...";
    statusEl.style.color = "var(--grey-500)";

    const payload = {
      generatedAt: new Date().toISOString(),
      selectedSheets: state.selectedSheets,
      fields: state.fields,
      fieldsPresent: Array.from(state.fieldsPresent),
      records: state.records
    };
    const contentBase64 = utf8ToBase64(JSON.stringify(payload));
    const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    };

    try {
      // Look up existing file's sha (required by GitHub to update rather than create)
      let sha;
      const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
      if (getRes.ok) {
        const existing = await getRes.json();
        sha = existing.sha;
      } else if (getRes.status !== 404) {
        const errBody = await getRes.json().catch(() => ({}));
        throw new Error(errBody.message || `GitHub returned ${getRes.status} while checking for an existing file.`);
      }

      const putRes = await fetch(apiBase, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Publish quality dashboard data (${state.records.length} records) - ${new Date().toISOString()}`,
          content: contentBase64,
          branch,
          ...(sha ? { sha } : {})
        })
      });

      if (!putRes.ok) {
        const errBody = await putRes.json().catch(() => ({}));
        throw new Error(errBody.message || `GitHub returned ${putRes.status} while publishing.`);
      }

      const result = await putRes.json();
      statusEl.innerHTML = `Published successfully. <a href="${result.commit && result.commit.html_url ? result.commit.html_url : "#"}" target="_blank" rel="noopener">View commit</a>. It may take a minute for GitHub Pages to redeploy.`;
      statusEl.style.color = "var(--success)";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Publish failed: " + err.message;
      statusEl.style.color = "var(--hamleys-red)";
    }
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ---------------------------------------------------------------------
     Init
     ------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    initUpload();
    initAdmin();
    await tryAutoLoadPublishedData();
  });
})();
