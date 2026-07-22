/* ==========================================================================
   Hamleys Quality Dashboard — app.js
   ==========================================================================
   Structure:
     1. PURE section — parsing / normalization / join / KPI logic.
        No DOM, window, or document access. Usable from Node (for the
        scripts/generate-seed-data.js build script) AND the browser, via
        the module.exports guard at the bottom of this section.
     2. BROWSER section — wires the pure functions above to the DOM defined
        in index.html. Runs only when `window` exists.
   ========================================================================== */

/* ---------------------------- 1. PURE SECTION ---------------------------- */

var ADMIN_PASSCODE = 'hamleys2026';

/* Normalize a raw header cell into a lower-cased, whitespace-collapsed,
   punctuation-stripped string for pattern matching. */
function normalizeHeader(h) {
  return String(h === null || h === undefined ? '' : h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/* Field rules for the monthly complaint-log sheets. Order matters where
   two rules could both match the same header text (see smNumber vs
   contactNumber) — the first rule in this array wins for a given column. */
var FIELD_RULES = [
  { key: 'dateOfManufacturing', test: function (h) { return /\bdate\b/.test(h) && /\bmanufactur/.test(h); } },
  { key: 'date', test: function (h) { return /\bdate\b/.test(h) && /\bissue\b/.test(h) && !/\bmanufactur/.test(h); } },
  { key: 'articleCode', test: function (h) { return /\barticle\b/.test(h) && /\bcode\b/.test(h); } },
  { key: 'itemDescription', test: function (h) { return /\bitem\b/.test(h) && /\bdescription\b/.test(h); } },
  { key: 'vendorName', test: function (h) { return /\bvendor\b/.test(h) && /\bname\b/.test(h); } },
  { key: 'issueDescription', test: function (h) { return /\bdescribe\b/.test(h) && /\bissue\b/.test(h); } },
  { key: 'batchCode', test: function (h) { return /\bbatch\b/.test(h) && /\bcode\b/.test(h); } },
  { key: 'storeCode', test: function (h) { return /\bstore\b/.test(h) && /\bcode\b/.test(h); } },
  { key: 'storeLocation', test: function (h) { return /\bstore\b/.test(h) && /\blocation\b/.test(h); } },
  { key: 'defectQty', test: function (h) { return /\bdefect\b/.test(h) && /(quant|qty)/.test(h); } },
  { key: 'category', test: function (h) { return /\bcategory\b/.test(h); } },
  { key: 'rootCause', test: function (h) { return /\broot\b/.test(h) && /\bcause\b/.test(h); } },
  { key: 'containmentAction', test: function (h) { return /\bcontainment\b/.test(h) && /\baction\b/.test(h); } },
  { key: 'closureTarget', test: function (h) { return /\bclosure\b/.test(h) && /(tgt|target)/.test(h); } },
  { key: 'status', test: function (h) { return /\bstatus\b/.test(h); } },
  { key: 'vendorRemarks', test: function (h) { return /\bvendor\b/.test(h) && /\bremark/.test(h); } },
  { key: 'storeRemarks', test: function (h) { return /\bstore\b/.test(h) && /\bremark/.test(h); } },
  { key: 'smName', test: function (h) { return (/\bsm\b/.test(h) || (/\bstore\b/.test(h) && /\bmanager\b/.test(h))) && /\bname\b/.test(h) && !/mail/.test(h); } },
  { key: 'smNumber', test: function (h) { return (/\bsm\b/.test(h) || (/\bstore\b/.test(h) && /\bmanager\b/.test(h))) && /(number|contact)/.test(h) && !/mail/.test(h); } },
  { key: 'smEmail', test: function (h) { return (/\bsm\b/.test(h) || (/\bstore\b/.test(h) && /\bmanager\b/.test(h))) && /mail/.test(h); } },
  { key: 'clusterLeader', test: function (h) { return /\bcluster\b/.test(h) && /lead/.test(h); } },
  { key: 'contactNumber', test: function (h) { return /\bcontact\b/.test(h) && /\bnumber\b/.test(h); } },
  { key: 'complaintStage', test: function (h) { return /\bcomplaint\b/.test(h) && /\bstage\b/.test(h); } }
];

/* Field rules for the ROM & RM mapping workbook (Store Code, Name, ROM, RM). */
var ROM_FIELD_RULES = [
  { key: 'storeCode', test: function (h) { return /\bstore\b/.test(h) && /\bcode\b/.test(h); } },
  { key: 'rom', test: function (h) { return /\brom\b/.test(h); } },
  { key: 'rm', test: function (h) { return /\brm\b/.test(h); } },
  { key: 'storeName', test: function (h) { return /\bname\b/.test(h); } }
];

/* Field rules for the Article MAP Section workbook (Article Code, Section, MAP). */
var ARTICLE_FIELD_RULES = [
  { key: 'articleCode', test: function (h) { return /\barticle\b/.test(h) && /\bcode\b/.test(h); } },
  { key: 'section', test: function (h) { return /\bsection\b/.test(h); } },
  { key: 'mapValue', test: function (h) { return /\bmap\b/.test(h); } }
];

/* Minimum number of complaint FIELD_RULES a sheet's detected header row must
   match before it is treated as a complaint-log candidate (auto-checked). */
var COMPLAINT_SHEET_MIN_MATCHES = 4;

/* Build { key: columnIndex } from a single header row (array of cells)
   using a rule set. Leftmost matching column wins for each key; a column
   is claimed by at most one key (first rule in `rules` order that matches
   an unclaimed column). */
function buildFieldMap(headerRow, rules) {
  var fieldMap = {};
  var claimedCols = {};
  headerRow = headerRow || [];
  for (var colIdx = 0; colIdx < headerRow.length; colIdx++) {
    if (claimedCols[colIdx]) continue;
    var h = normalizeHeader(headerRow[colIdx]);
    if (!h) continue;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (fieldMap.hasOwnProperty(rule.key)) continue;
      if (rule.test(h)) {
        fieldMap[rule.key] = colIdx;
        claimedCols[colIdx] = true;
        break;
      }
    }
  }
  return fieldMap;
}

/* Scan up to maxScan rows of a raw (header:1-style array-of-arrays) sheet
   and return the index of the row that best matches known field rules
   (most matched columns wins). Handles files like the ROM mapping's
   blank first row without hardcoding row 0 as the header. */
function detectHeaderRow(rows, rules, maxScan) {
  maxScan = maxScan || 10;
  rows = rows || [];
  var bestIdx = 0;
  var bestScore = -1;
  var limit = Math.min(maxScan, rows.length);
  for (var i = 0; i < limit; i++) {
    var row = rows[i] || [];
    var fieldMap = buildFieldMap(row, rules);
    var score = Object.keys(fieldMap).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/* Convenience wrapper: detect the header row, build the field map for it,
   and report how many fields matched (used for sheet-candidate scoring). */
function analyzeSheet(rows, rules, maxScan) {
  var headerRowIdx = detectHeaderRow(rows, rules, maxScan);
  var headerRow = (rows && rows[headerRowIdx]) || [];
  var fieldMap = buildFieldMap(headerRow, rules);
  return {
    headerRowIdx: headerRowIdx,
    headerRow: headerRow,
    fieldMap: fieldMap,
    matchCount: Object.keys(fieldMap).length
  };
}

function isComplaintSheetCandidate(rows, maxScan) {
  var info = analyzeSheet(rows, FIELD_RULES, maxScan);
  return info.matchCount >= COMPLAINT_SHEET_MIN_MATCHES;
}

/* Excel serial date (1900 date system) -> JS Date. */
function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || isNaN(serial)) return null;
  var utcDays = Math.floor(serial - 25569);
  var utcMs = utcDays * 86400 * 1000;
  var fractionalDay = serial - Math.floor(serial);
  var d = new Date(utcMs + Math.round(fractionalDay * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d;
}

/* Parse a date-ish cell value into an ISO (YYYY-MM-DD) string. Keeps the
   raw string if unparseable rather than throwing. opts.mmYYYY treats
   numeric/string values as an MMYYYY-encoded month (used for
   "Date of Manufacturing(MMYYYY)"). */
function parseDateValue(value, opts) {
  opts = opts || {};
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }

  if (opts.mmYYYY) {
    var s = String(value).trim();
    s = s.length < 6 ? ('000000' + s).slice(-6) : s;
    var m = s.match(/^(\d{2})(\d{4})$/);
    if (m) {
      var mo = Number(m[1]);
      var y = Number(m[2]);
      if (mo >= 1 && mo <= 12 && y > 1900) {
        var dt = new Date(y, mo - 1, 1);
        if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
      }
    }
  }

  if (typeof value === 'number') {
    var d1 = excelSerialToDate(value);
    if (d1) return d1.toISOString().slice(0, 10);
    return String(value);
  }

  if (typeof value === 'string') {
    var str = value.trim();
    if (!str) return '';
    var m2 = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m2) {
      var dd = Number(m2[1]), mm = Number(m2[2]), yy = m2[3];
      if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
      var dt2 = new Date(Number(yy), mm - 1, dd);
      if (!isNaN(dt2.getTime())) return dt2.toISOString().slice(0, 10);
    }
    if (/\d{4}/.test(str)) {
      var parsed = new Date(str);
      if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
    return str;
  }

  return String(value);
}

/* Parse a numeric-ish cell value; defaults to 0 for blank/unparseable. */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  var n = parseFloat(String(value).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

/* Article Code join key: trimmed string, with a trailing ".0"-style
   float artifact stripped (e.g. from a code that came through as a
   float64 during parsing). */
function normalizeArticleCode(value) {
  if (value === null || value === undefined) return '';
  var s = String(value).trim();
  if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
  return s;
}

/* Store Code join key: trimmed, upper-cased string. */
function normalizeStoreCode(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase();
}

function cellToTrimmedString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

/* Map one raw sheet row (array of cells) to a normalized complaint record
   using a { key: columnIndex } field map. Missing columns become '' /0,
   never throw. */
function normalizeRecord(row, fieldMap, sourceSheetName) {
  row = row || [];
  fieldMap = fieldMap || {};
  function get(key) {
    var idx = fieldMap[key];
    if (idx === undefined) return null;
    var v = row[idx];
    return v === undefined ? null : v;
  }
  return {
    date: parseDateValue(get('date')) || '',
    articleCode: normalizeArticleCode(get('articleCode')),
    itemDescription: cellToTrimmedString(get('itemDescription')),
    vendorName: cellToTrimmedString(get('vendorName')),
    issueDescription: cellToTrimmedString(get('issueDescription')),
    batchCode: cellToTrimmedString(get('batchCode')),
    storeCode: normalizeStoreCode(get('storeCode') || ''),
    storeLocation: cellToTrimmedString(get('storeLocation')),
    defectQty: toNumber(get('defectQty')),
    category: cellToTrimmedString(get('category')),
    rootCause: cellToTrimmedString(get('rootCause')),
    containmentAction: cellToTrimmedString(get('containmentAction')),
    status: cellToTrimmedString(get('status')),
    closureTarget: parseDateValue(get('closureTarget')) || '',
    vendorRemarks: cellToTrimmedString(get('vendorRemarks')),
    storeRemarks: cellToTrimmedString(get('storeRemarks')),
    smName: cellToTrimmedString(get('smName')),
    smNumber: cellToTrimmedString(get('smNumber')),
    smEmail: cellToTrimmedString(get('smEmail')),
    clusterLeader: cellToTrimmedString(get('clusterLeader')),
    contactNumber: cellToTrimmedString(get('contactNumber')),
    complaintStage: cellToTrimmedString(get('complaintStage')),
    dateOfManufacturing: parseDateValue(get('dateOfManufacturing'), { mmYYYY: true }) || '',
    sourceSheet: sourceSheetName || ''
  };
}

/* Convert all data rows after the header row of a sheet into normalized
   records. Blank rows are skipped. */
function rowsToRecords(rows, headerRowIdx, fieldMap, sourceSheetName) {
  rows = rows || [];
  var out = [];
  for (var i = headerRowIdx + 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row) continue;
    var blank = true;
    for (var j = 0; j < row.length; j++) {
      if (row[j] !== null && row[j] !== undefined && row[j] !== '') { blank = false; break; }
    }
    if (blank) continue;
    out.push(normalizeRecord(row, fieldMap, sourceSheetName));
  }
  return out;
}

/* Build { storeCode: { storeName, rom, rm } } from a raw ROM & RM mapping
   sheet (array-of-arrays, header row auto-detected). */
function buildRomMappingFromRows(rows) {
  var info = analyzeSheet(rows, ROM_FIELD_RULES, 10);
  var fieldMap = info.fieldMap;
  var mapping = {};
  for (var i = info.headerRowIdx + 1; i < (rows || []).length; i++) {
    var row = rows[i];
    if (!row) continue;
    var codeIdx = fieldMap.storeCode;
    if (codeIdx === undefined) continue;
    var codeRaw = row[codeIdx];
    if (codeRaw === null || codeRaw === undefined || codeRaw === '') continue;
    var code = normalizeStoreCode(codeRaw);
    mapping[code] = {
      storeName: fieldMap.storeName !== undefined ? cellToTrimmedString(row[fieldMap.storeName]) : '',
      rom: fieldMap.rom !== undefined ? cellToTrimmedString(row[fieldMap.rom]) : '',
      rm: fieldMap.rm !== undefined ? cellToTrimmedString(row[fieldMap.rm]) : ''
    };
  }
  return mapping;
}

/* Build { sections: string[], articles: { articleCode: [sectionIndex, mapValue] } }
   from a raw Article Section/MAP sheet (array-of-arrays). Section strings
   are de-duplicated into an index array to keep the JSON compact. */
function buildArticleMapFromRows(rows) {
  var info = analyzeSheet(rows, ARTICLE_FIELD_RULES, 10);
  var fieldMap = info.fieldMap;
  var sections = [];
  var sectionIndexByName = {};
  var articles = {};
  for (var i = info.headerRowIdx + 1; i < (rows || []).length; i++) {
    var row = rows[i];
    if (!row) continue;
    var codeIdx = fieldMap.articleCode;
    if (codeIdx === undefined) continue;
    var codeRaw = row[codeIdx];
    if (codeRaw === null || codeRaw === undefined || codeRaw === '') continue;
    var code = normalizeArticleCode(codeRaw);
    var sectionName = fieldMap.section !== undefined ? cellToTrimmedString(row[fieldMap.section]) : '';
    var mapValue = fieldMap.mapValue !== undefined ? toNumber(row[fieldMap.mapValue]) : 0;
    var idx = sectionIndexByName[sectionName];
    if (idx === undefined) {
      idx = sections.length;
      sections.push(sectionName);
      sectionIndexByName[sectionName] = idx;
    }
    articles[code] = [idx, mapValue];
  }
  return { sections: sections, articles: articles };
}

/* Join ROM/RM mapping onto records by Store Code. Never clobbers a
   record's own non-blank storeLocation with the mapping's store name. */
function joinRomMapping(records, romMapping) {
  if (!romMapping) return records;
  return (records || []).map(function (r) {
    var key = normalizeStoreCode(r.storeCode);
    var m = romMapping[key];
    if (!m) return r;
    var out = {};
    for (var k in r) out[k] = r[k];
    out.rom = m.rom || '';
    out.rm = m.rm || '';
    if (!out.storeLocation && m.storeName) out.storeLocation = m.storeName;
    return out;
  });
}

/* Join Article Section/MAP mapping onto records by Article Code. Attaches
   section, mapValue and a derived mapImpact = defectQty * mapValue. */
function joinArticleMap(records, articleMap) {
  if (!articleMap || !articleMap.articles) return records;
  var sections = articleMap.sections || [];
  var articles = articleMap.articles;
  return (records || []).map(function (r) {
    var code = normalizeArticleCode(r.articleCode);
    var entry = articles[code];
    if (!entry) return r;
    var out = {};
    for (var k in r) out[k] = r[k];
    var sectionIdx = entry[0];
    var mapValueRaw = entry[1];
    out.section = sections[sectionIdx] || '';
    var mapValue = typeof mapValueRaw === 'number' ? mapValueRaw : Number(mapValueRaw);
    out.mapValue = isNaN(mapValue) ? null : mapValue;
    out.mapImpact = (out.mapValue !== null && typeof r.defectQty === 'number' && !isNaN(r.defectQty))
      ? r.defectQty * out.mapValue
      : null;
    return out;
  });
}

/* Format a number as Indian-locale currency with no decimals. */
function formatINR(n) {
  var rounded = Math.round(n || 0);
  return '₹' + rounded.toLocaleString('en-IN');
}

/* Classify a status string into one of style.css's known status-pill
   classes for consistent table rendering. */
function statusPillClass(status) {
  var s = (status || '').toLowerCase().trim();
  if (/close/.test(s)) return 'status-closed';
  if (/wip|progress/.test(s)) return 'status-wip';
  if (/open/.test(s)) return 'status-open';
  if (/pending/.test(s)) return 'status-pending';
  return 'status-other';
}

/* KPI computation over a (possibly filtered) record set. */
function computeKpis(records) {
  records = records || [];
  var total = records.length;
  var closed = 0;
  var defectQtyTotal = 0;
  var mapImpactTotal = 0;
  var hasMapImpact = false;
  var stores = {};
  var storeCount = 0;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (/close/i.test(r.status || '')) closed++;
    if (typeof r.defectQty === 'number' && !isNaN(r.defectQty)) defectQtyTotal += r.defectQty;
    if (r.mapImpact !== null && r.mapImpact !== undefined && !isNaN(r.mapImpact)) {
      mapImpactTotal += r.mapImpact;
      hasMapImpact = true;
    }
    if (r.storeCode && !stores[r.storeCode]) { stores[r.storeCode] = true; storeCount++; }
  }
  return {
    total: total,
    closed: closed,
    openWip: total - closed,
    defectQtyTotal: defectQtyTotal,
    storesAffected: storeCount,
    hasMapImpact: hasMapImpact,
    mapImpactTotal: mapImpactTotal,
    mapImpactFormatted: formatINR(mapImpactTotal)
  };
}

/* UTF-8 safe base64 encoding (browsers' native btoa() mangles non-Latin1
   characters like the rupee sign or the E-with-acute in "HAMLEYS CAFE").
   Works in both the browser (TextEncoder + btoa) and Node (Buffer). */
function utf8ToBase64(str) {
  var bytes;
  if (typeof TextEncoder !== 'undefined') {
    bytes = new TextEncoder().encode(str);
  } else {
    bytes = new Uint8Array(Buffer.from(str, 'utf-8'));
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  var binary = '';
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ADMIN_PASSCODE: ADMIN_PASSCODE,
    FIELD_RULES: FIELD_RULES,
    ROM_FIELD_RULES: ROM_FIELD_RULES,
    ARTICLE_FIELD_RULES: ARTICLE_FIELD_RULES,
    COMPLAINT_SHEET_MIN_MATCHES: COMPLAINT_SHEET_MIN_MATCHES,
    normalizeHeader: normalizeHeader,
    buildFieldMap: buildFieldMap,
    detectHeaderRow: detectHeaderRow,
    analyzeSheet: analyzeSheet,
    isComplaintSheetCandidate: isComplaintSheetCandidate,
    excelSerialToDate: excelSerialToDate,
    parseDateValue: parseDateValue,
    toNumber: toNumber,
    normalizeArticleCode: normalizeArticleCode,
    normalizeStoreCode: normalizeStoreCode,
    normalizeRecord: normalizeRecord,
    rowsToRecords: rowsToRecords,
    buildRomMappingFromRows: buildRomMappingFromRows,
    buildArticleMapFromRows: buildArticleMapFromRows,
    joinRomMapping: joinRomMapping,
    joinArticleMap: joinArticleMap,
    formatINR: formatINR,
    statusPillClass: statusPillClass,
    computeKpis: computeKpis,
    utf8ToBase64: utf8ToBase64
  };
}

/* --------------------------- 2. BROWSER SECTION --------------------------- */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {

  /* ---------------------------- state ---------------------------- */
  var records = [];
  var romMapping = null;
  var articleMap = null;
  var fieldMapsBySheet = {};
  var pendingWorkbookRows = null;
  var isLiveData = false;
  var publishedMeta = null;
  var filterState = {};
  var chartInstances = {};
  var tableSortState = { key: 'date', dir: 'desc' };
  var tableSearchTerm = '';

  var FILTER_DEFS = [
    { key: 'date', label: 'Date range', type: 'daterange' },
    { key: 'storeCode', label: 'Store', type: 'select' },
    { key: 'rom', label: 'ROM', type: 'select' },
    { key: 'status', label: 'Status', type: 'select' },
    { key: 'vendorName', label: 'Vendor', type: 'select' },
    { key: 'section', label: 'Section', type: 'select' }
  ];

  var TABLE_COLUMNS = [
    { key: 'date', label: 'Date' },
    { key: 'storeCode', label: 'Store Code' },
    { key: 'storeLocation', label: 'Store Location' },
    { key: 'vendorName', label: 'Vendor Name' },
    { key: 'itemDescription', label: 'Item Description' },
    { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' },
    { key: 'defectQty', label: 'Defect Qty' },
    { key: 'rom', label: 'ROM', optional: true },
    { key: 'rm', label: 'RM', optional: true },
    { key: 'section', label: 'Section', optional: true },
    { key: 'mapValue', label: 'MAP Value', optional: true },
    { key: 'mapImpact', label: 'MAP Impact', optional: true },
    { key: 'sourceSheet', label: 'Source Sheet' }
  ];

  var CHART_COLORS = ['#E3001B', '#222225', '#7A7A80', '#1E8E4E', '#C77700', '#4A4A4E', '#B50014', '#D6D6DA'];

  if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
  }

  function byId(id) { return document.getElementById(id); }

  var els = {
    adminToggleBtn: byId('adminToggleBtn'),
    liveBanner: byId('liveBanner'),
    liveBannerMeta: byId('liveBannerMeta'),
    loadDifferentFileBtn: byId('loadDifferentFileBtn'),
    uploadSection: byId('uploadSection'),
    dropZone: byId('dropZone'),
    fileInput: byId('fileInput'),
    browseBtn: byId('browseBtn'),
    fileName: byId('fileName'),
    sheetPicker: byId('sheetPicker'),
    sheetCheckboxes: byId('sheetCheckboxes'),
    loadSheetsBtn: byId('loadSheetsBtn'),
    statusMsg: byId('statusMsg'),
    dashboardContent: byId('dashboardContent'),
    filtersGrid: byId('filtersGrid'),
    resetFiltersBtn: byId('resetFiltersBtn'),
    kpiGrid: byId('kpiGrid'),
    chartRomEmpty: byId('chartRomEmpty'),
    chartSectionsEmpty: byId('chartSectionsEmpty'),
    tableSearch: byId('tableSearch'),
    rowCount: byId('rowCount'),
    dataTable: byId('dataTable'),
    adminOverlay: byId('adminOverlay'),
    adminCloseBtn: byId('adminCloseBtn'),
    adminLoginView: byId('adminLoginView'),
    adminPassword: byId('adminPassword'),
    adminLoginBtn: byId('adminLoginBtn'),
    adminError: byId('adminError'),
    adminToolsView: byId('adminToolsView'),
    columnMappingTable: byId('columnMappingTable'),
    romMappingInput: byId('romMappingInput'),
    romMappingStatus: byId('romMappingStatus'),
    articleMapInput: byId('articleMapInput'),
    articleMapStatus: byId('articleMapStatus'),
    exportCsvBtn: byId('exportCsvBtn'),
    ghToken: byId('ghToken'),
    ghOwner: byId('ghOwner'),
    ghRepo: byId('ghRepo'),
    ghBranch: byId('ghBranch'),
    ghPath: byId('ghPath'),
    publishBtn: byId('publishBtn'),
    publishStatus: byId('publishStatus'),
    sessionInfo: byId('sessionInfo')
  };

  /* ---------------------------- helpers ---------------------------- */

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showStatus(msg, type) {
    if (!els.statusMsg) return;
    els.statusMsg.textContent = msg || '';
    els.statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function formatDateDisplay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------------------- filters ---------------------------- */

  function fieldHasValues(key) {
    for (var i = 0; i < records.length; i++) {
      var v = records[i][key];
      if (v !== undefined && v !== null && String(v).trim() !== '') return true;
    }
    return false;
  }

  function buildFiltersGrid() {
    if (!els.filtersGrid) return;
    var active = FILTER_DEFS.filter(function (def) { return fieldHasValues(def.key); });
    var html = active.map(function (def) {
      if (def.type === 'daterange') {
        var from = filterState[def.key + 'From'] || '';
        var to = filterState[def.key + 'To'] || '';
        return '<div class="filter-field filter-daterange"><label>' + escapeHtml(def.label) + '</label>' +
          '<div class="daterange-inputs">' +
          '<div class="daterange-input"><span class="daterange-tag">From</span><input type="date" data-filter="' + def.key + 'From" value="' + escapeHtml(from) + '" /></div>' +
          '<div class="daterange-input"><span class="daterange-tag">To</span><input type="date" data-filter="' + def.key + 'To" value="' + escapeHtml(to) + '" /></div>' +
          '</div></div>';
      }
      var seen = {};
      var values = [];
      records.forEach(function (r) {
        var v = r[def.key];
        if (v === undefined || v === null) return;
        v = String(v).trim();
        if (!v || seen[v]) return;
        seen[v] = true;
        values.push(v);
      });
      values.sort(function (a, b) { return a.localeCompare(b); });
      var current = filterState[def.key] || '';
      return '<div class="filter-field"><label>' + escapeHtml(def.label) + '</label>' +
        '<select data-filter="' + def.key + '"><option value="">All</option>' +
        values.map(function (v) {
          return '<option value="' + escapeHtml(v) + '"' + (current === v ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
        }).join('') +
        '</select></div>';
    }).join('');
    els.filtersGrid.innerHTML = html;
    Array.prototype.forEach.call(els.filtersGrid.querySelectorAll('[data-filter]'), function (el) {
      el.addEventListener('change', function (e) {
        filterState[e.target.getAttribute('data-filter')] = e.target.value;
        renderAll();
      });
    });
  }

  function applyFilters() {
    return records.filter(function (r) {
      for (var i = 0; i < FILTER_DEFS.length; i++) {
        var def = FILTER_DEFS[i];
        if (def.type === 'daterange') {
          var from = filterState[def.key + 'From'];
          var to = filterState[def.key + 'To'];
          var val = r[def.key];
          if (from && (!val || val < from)) return false;
          if (to && (!val || val > to)) return false;
        } else {
          var sel = filterState[def.key];
          if (sel && String(r[def.key] || '') !== sel) return false;
        }
      }
      return true;
    });
  }

  /* ---------------------------- KPIs ---------------------------- */

  function renderKpis(filtered) {
    if (!els.kpiGrid) return;
    var k = computeKpis(filtered);
    var cards = [
      { label: 'Total Complaints', value: k.total.toLocaleString('en-IN') },
      { label: 'Open / WIP', value: k.openWip.toLocaleString('en-IN') },
      { label: 'Closed', value: k.closed.toLocaleString('en-IN') },
      { label: 'Total Defect Quantity', value: Math.round(k.defectQtyTotal).toLocaleString('en-IN') },
      { label: 'Stores Affected', value: k.storesAffected.toLocaleString('en-IN') }
    ];
    if (k.hasMapImpact) {
      cards.push({ label: 'Estimated MAP Value Impact', value: k.mapImpactFormatted });
    }
    els.kpiGrid.innerHTML = cards.map(function (c) {
      return '<div class="kpi-card"><div class="kpi-label">' + escapeHtml(c.label) +
        '</div><div class="kpi-value">' + escapeHtml(String(c.value)) + '</div></div>';
    }).join('');
  }

  /* ---------------------------- charts ---------------------------- */

  function groupSum(list, keyFn, valueFn) {
    var map = {};
    var order = [];
    list.forEach(function (item) {
      var k = keyFn(item);
      if (k === null || k === undefined || k === '') return;
      if (!map.hasOwnProperty(k)) { map[k] = 0; order.push(k); }
      map[k] += valueFn(item);
    });
    return order.map(function (k) { return [k, map[k]]; });
  }

  function topN(entries, n) {
    return entries.slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, n);
  }

  function destroyChart(id) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
  }

  function renderChart(id, config) {
    var canvas = byId(id);
    if (!canvas || typeof Chart === 'undefined') return;
    destroyChart(id);
    chartInstances[id] = new Chart(canvas.getContext('2d'), config);
  }

  function horizontalBarConfig(entries, label, color) {
    return {
      type: 'bar',
      data: { labels: entries.map(function (e) { return e[0]; }), datasets: [{ label: label, data: entries.map(function (e) { return e[1]; }), backgroundColor: color }] },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 36 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: 'end',
            align: 'end',
            clamp: true,
            color: '#222225',
            font: { weight: '700', size: 11 },
            formatter: function (value) { return value.toLocaleString('en-IN'); }
          }
        },
        scales: { x: { beginAtZero: true, grace: '12%' } }
      }
    };
  }

  function renderCharts(filtered) {
    var statusEntries = groupSum(filtered, function (r) { return (r.status || 'Unknown').trim() || 'Unknown'; }, function () { return 1; });
    renderChart('chartStatus', {
      type: 'doughnut',
      data: { labels: statusEntries.map(function (e) { return e[0]; }), datasets: [{ data: statusEntries.map(function (e) { return e[1]; }), backgroundColor: CHART_COLORS }] },
      options: {
        plugins: {
          legend: { position: 'bottom' },
          datalabels: {
            color: '#fff',
            font: { weight: '700', size: 12 },
            formatter: function (value) { return value ? value.toLocaleString('en-IN') : ''; }
          }
        }
      }
    });

    var hasRom = records.some(function (r) { return !!r.rom; });
    if (els.chartRomEmpty) els.chartRomEmpty.classList.toggle('hidden', hasRom);
    if (hasRom) {
      var romEntries = groupSum(filtered, function (r) { return r.rom; }, function (r) { return r.defectQty || 0; });
      romEntries.sort(function (a, b) { return b[1] - a[1]; });
      renderChart('chartRom', {
        type: 'bar',
        data: { labels: romEntries.map(function (e) { return e[0]; }), datasets: [{ label: 'Defect qty', data: romEntries.map(function (e) { return e[1]; }), backgroundColor: '#E3001B' }] },
        options: {
          layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false },
            datalabels: {
              anchor: 'end',
              align: 'end',
              clamp: true,
              color: '#222225',
              font: { weight: '700', size: 11 },
              formatter: function (value) { return value.toLocaleString('en-IN'); }
            }
          },
          scales: { y: { beginAtZero: true, grace: '12%' } }
        }
      });
    } else {
      destroyChart('chartRom');
    }

    var trendMap = {};
    filtered.forEach(function (r) {
      if (!r.date) return;
      var m = String(r.date).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      trendMap[m] = (trendMap[m] || 0) + 1;
    });
    var trendKeys = Object.keys(trendMap).sort();
    renderChart('chartTrend', {
      type: 'line',
      data: { labels: trendKeys, datasets: [{ label: 'Complaints', data: trendKeys.map(function (k) { return trendMap[k]; }), borderColor: '#E3001B', backgroundColor: 'rgba(227,0,27,0.15)', fill: true, tension: 0.25 }] },
      options: { plugins: { legend: { display: false }, datalabels: { display: false } } }
    });

    var vendorEntries = topN(groupSum(filtered, function (r) { return r.vendorName; }, function (r) { return r.defectQty || 0; }), 10);
    renderChart('chartVendorsTop10', horizontalBarConfig(vendorEntries, 'Defect qty', '#222225'));

    var articleEntries = topN(groupSum(filtered, function (r) { return r.itemDescription; }, function (r) { return r.defectQty || 0; }), 10);
    renderChart('chartArticlesTop10', horizontalBarConfig(articleEntries, 'Defect qty', '#7A7A80'));

    var hasSection = records.some(function (r) { return !!r.section; });
    if (els.chartSectionsEmpty) els.chartSectionsEmpty.classList.toggle('hidden', hasSection);
    if (hasSection) {
      var sectionEntries = topN(groupSum(filtered, function (r) { return r.section; }, function (r) { return r.defectQty || 0; }), 10);
      renderChart('chartSectionsTop10', horizontalBarConfig(sectionEntries, 'Defect qty', '#B50014'));
    } else {
      destroyChart('chartSectionsTop10');
    }
  }

  /* ---------------------------- table ---------------------------- */

  function renderTable(filtered) {
    if (!els.dataTable) return;
    var rows = filtered.slice();
    if (tableSearchTerm) {
      var term = tableSearchTerm.toLowerCase();
      rows = rows.filter(function (r) {
        return TABLE_COLUMNS.some(function (c) {
          var v = r[c.key];
          return v !== undefined && v !== null && String(v).toLowerCase().indexOf(term) !== -1;
        });
      });
    }
    if (tableSortState.key) {
      var key = tableSortState.key, dir = tableSortState.dir;
      rows.sort(function (a, b) {
        var av = a[key], bv = b[key];
        if (av === null || av === undefined || av === '') return 1;
        if (bv === null || bv === undefined || bv === '') return -1;
        if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
        return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    if (els.rowCount) els.rowCount.textContent = rows.length.toLocaleString('en-IN') + (rows.length === 1 ? ' row' : ' rows');

    var cols = TABLE_COLUMNS.filter(function (c) {
      if (!c.optional) return true;
      return records.some(function (r) { return r[c.key] !== undefined && r[c.key] !== null && r[c.key] !== ''; });
    });

    var theadRow = '<tr>' + cols.map(function (c) {
      var arrow = tableSortState.key === c.key ? (' <span class="sort-arrow">' + (tableSortState.dir === 'asc' ? '▲' : '▼') + '</span>') : '';
      return '<th data-key="' + c.key + '">' + escapeHtml(c.label) + arrow + '</th>';
    }).join('') + '</tr>';

    var tbodyHtml = rows.map(function (r) {
      return '<tr>' + cols.map(function (c) {
        var v = r[c.key];
        if (c.key === 'status') {
          return '<td><span class="status-pill ' + statusPillClass(v) + '">' + escapeHtml(v || '-') + '</span></td>';
        }
        if (c.key === 'mapValue' || c.key === 'mapImpact') {
          v = (typeof v === 'number' && !isNaN(v)) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
        } else if (c.key === 'defectQty') {
          v = (typeof v === 'number' && !isNaN(v)) ? v.toLocaleString('en-IN') : v;
        }
        return '<td>' + escapeHtml(v === null || v === undefined ? '' : String(v)) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var thead = els.dataTable.querySelector('thead');
    var tbody = els.dataTable.querySelector('tbody');
    if (thead) thead.innerHTML = theadRow;
    if (tbody) tbody.innerHTML = tbodyHtml || ('<tr><td colspan="' + cols.length + '" style="text-align:center;color:var(--grey-500);padding:20px;">No rows match.</td></tr>');
  }

  function wireTableEvents() {
    if (els.tableSearch) {
      els.tableSearch.addEventListener('input', function (e) {
        tableSearchTerm = e.target.value;
        renderAll();
      });
    }
    if (els.dataTable) {
      var thead = els.dataTable.querySelector('thead');
      if (thead) {
        thead.addEventListener('click', function (e) {
          var th = e.target.closest ? e.target.closest('th') : null;
          if (!th) return;
          var key = th.getAttribute('data-key');
          if (!key) return;
          if (tableSortState.key === key) {
            tableSortState.dir = tableSortState.dir === 'asc' ? 'desc' : 'asc';
          } else {
            tableSortState.key = key;
            tableSortState.dir = 'asc';
          }
          renderAll();
        });
      }
    }
  }

  /* ---------------------------- render orchestration ---------------------------- */

  function renderAll() {
    var filtered = applyFilters();
    renderKpis(filtered);
    renderCharts(filtered);
    renderTable(filtered);
  }

  /* ---------------------------- admin: column mapping + session info ---------------------------- */

  function renderColumnMappingTable() {
    if (!els.columnMappingTable) return;
    var sheetNames = Object.keys(fieldMapsBySheet);
    if (!sheetNames.length) {
      els.columnMappingTable.innerHTML = '<p class="admin-note">No workbook has been manually loaded this session yet (data may be coming from the published live file instead).</p>';
      return;
    }
    var html = '<table><thead><tr><th>Sheet</th><th>Detected field</th><th>Source column header</th></tr></thead><tbody>';
    sheetNames.forEach(function (name) {
      var info = fieldMapsBySheet[name];
      Object.keys(info.fieldMap).forEach(function (key) {
        var colIdx = info.fieldMap[key];
        var header = info.headerRow[colIdx];
        html += '<tr><td>' + escapeHtml(name) + '</td><td>' + escapeHtml(key) + '</td><td>' + escapeHtml(header === null || header === undefined ? '' : String(header)) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
    els.columnMappingTable.innerHTML = html;
  }

  function renderSessionInfo() {
    if (!els.sessionInfo) return;
    var parts = [];
    parts.push((isLiveData ? 'Live published data' : 'Manually loaded data') + ' — ' + records.length.toLocaleString('en-IN') + ' complaint rows.');
    parts.push(romMapping ? ('ROM/RM mapping loaded (' + Object.keys(romMapping).length.toLocaleString('en-IN') + ' stores).') : 'ROM/RM mapping not loaded.');
    parts.push(articleMap ? ('Article Section/MAP mapping loaded (' + Object.keys(articleMap.articles).length.toLocaleString('en-IN') + ' articles).') : 'Article Section/MAP mapping not loaded.');
    els.sessionInfo.innerHTML = parts.map(function (p) { return '<div>' + escapeHtml(p) + '</div>'; }).join('');
  }

  /* ---------------------------- upload / sheet picker ---------------------------- */

  function sheetToRows(worksheet) {
    return XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });
  }

  function renderSheetPicker(sheetsRows) {
    var names = Object.keys(sheetsRows);
    els.sheetCheckboxes.innerHTML = names.map(function (name) {
      var info = analyzeSheet(sheetsRows[name], FIELD_RULES, 10);
      var isCandidate = info.matchCount >= COMPLAINT_SHEET_MIN_MATCHES;
      var safeId = 'sheetchk_' + name.replace(/[^a-z0-9]+/gi, '_');
      return '<label class="sheet-check"><input type="checkbox" id="' + safeId + '" value="' + escapeHtml(name) + '" ' + (isCandidate ? 'checked' : '') + '/> ' +
        escapeHtml(name) + ' <span style="color:var(--grey-500)">(' + info.matchCount + ' fields matched)</span></label>';
    }).join('');
    els.sheetPicker.classList.remove('hidden');
  }

  function handleWorkbookFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array', cellDates: true });
        var sheetsRows = {};
        wb.SheetNames.forEach(function (name) { sheetsRows[name] = sheetToRows(wb.Sheets[name]); });
        pendingWorkbookRows = sheetsRows;
        renderSheetPicker(sheetsRows);
        if (els.fileName) els.fileName.textContent = file.name;
        showStatus('Workbook loaded — pick sheets to include, then click "Load selected sheets".', '');
      } catch (err) {
        showStatus('Could not read this file: ' + err.message, 'error');
      }
    };
    reader.onerror = function () { showStatus('Could not read this file.', 'error'); };
    reader.readAsArrayBuffer(file);
  }

  function loadSelectedSheets() {
    if (!pendingWorkbookRows) return;
    var checked = Array.prototype.map.call(
      els.sheetCheckboxes.querySelectorAll('input[type=checkbox]:checked'),
      function (cb) { return cb.value; }
    );
    if (!checked.length) { showStatus('Select at least one sheet to load.', 'error'); return; }
    var newRecords = [];
    var newFieldMaps = {};
    checked.forEach(function (name) {
      var rows = pendingWorkbookRows[name];
      var info = analyzeSheet(rows, FIELD_RULES, 10);
      newFieldMaps[name] = info;
      var recs = rowsToRecords(rows, info.headerRowIdx, info.fieldMap, name);
      newRecords = newRecords.concat(recs);
    });
    records = newRecords;
    fieldMapsBySheet = newFieldMaps;
    if (romMapping) records = joinRomMapping(records, romMapping);
    if (articleMap) records = joinArticleMap(records, articleMap);
    isLiveData = false;
    els.dashboardContent.classList.remove('hidden');
    buildFiltersGrid();
    renderAll();
    renderColumnMappingTable();
    renderSessionInfo();
    showStatus('Loaded ' + records.length.toLocaleString('en-IN') + ' rows from ' + checked.length + ' sheet(s).', 'success');
  }

  /* ---------------------------- ROM & article map uploads ---------------------------- */

  function pickBestSheet(wb, rules) {
    var best = null;
    wb.SheetNames.forEach(function (name) {
      var rows = sheetToRows(wb.Sheets[name]);
      var info = analyzeSheet(rows, rules, 10);
      if (!best || info.matchCount > best.matchCount) best = { name: name, rows: rows, matchCount: info.matchCount };
    });
    return best;
  }

  function handleRomMappingFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array', cellDates: true });
        var best = pickBestSheet(wb, ROM_FIELD_RULES);
        romMapping = buildRomMappingFromRows(best.rows);
        records = joinRomMapping(records, romMapping);
        if (els.romMappingStatus) {
          els.romMappingStatus.textContent = 'Loaded ' + Object.keys(romMapping).length.toLocaleString('en-IN') + ' store mappings from "' + file.name + '".';
        }
        buildFiltersGrid();
        renderAll();
        renderSessionInfo();
      } catch (err) {
        if (els.romMappingStatus) els.romMappingStatus.textContent = 'Could not read this file: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleArticleMapFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array', cellDates: true });
        var best = pickBestSheet(wb, ARTICLE_FIELD_RULES);
        articleMap = buildArticleMapFromRows(best.rows);
        records = joinArticleMap(records, articleMap);
        if (els.articleMapStatus) {
          els.articleMapStatus.textContent = 'Loaded ' + Object.keys(articleMap.articles).length.toLocaleString('en-IN') + ' article mappings from "' + file.name + '".';
        }
        buildFiltersGrid();
        renderAll();
        renderSessionInfo();
      } catch (err) {
        if (els.articleMapStatus) els.articleMapStatus.textContent = 'Could not read this file: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------------------------- CSV export ---------------------------- */

  function exportCsv() {
    var filtered = applyFilters();
    var cols = TABLE_COLUMNS;
    function csvEscape(v) {
      if (v === null || v === undefined) v = '';
      v = String(v);
      if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }
    var header = cols.map(function (c) { return csvEscape(c.label); }).join(',');
    var lines = filtered.map(function (r) { return cols.map(function (c) { return csvEscape(r[c.key]); }).join(','); });
    var csv = [header].concat(lines).join('\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'quality-dashboard-export-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------------------------- GitHub publish ---------------------------- */

  function publishToGithub() {
    var token = (els.ghToken.value || '').trim();
    var owner = (els.ghOwner.value || '').trim();
    var repo = (els.ghRepo.value || '').trim();
    var branch = (els.ghBranch.value || '').trim() || 'main';
    var filePath = (els.ghPath.value || '').trim() || 'data/quality-data.json';

    if (!token || !owner || !repo) {
      els.publishStatus.textContent = 'Please fill in the GitHub token, owner and repository name.';
      return;
    }
    if (!records.length) {
      els.publishStatus.textContent = 'Load some data before publishing.';
      return;
    }

    els.publishStatus.textContent = 'Publishing…';
    els.publishBtn.disabled = true;

    var payload = {
      publishedAt: new Date().toISOString(),
      records: records,
      romMapping: romMapping || {},
      articleMap: articleMap || { sections: [], articles: {} }
    };

    var apiUrl = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
      '/contents/' + filePath.split('/').map(encodeURIComponent).join('/');
    var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };

    var contentBase64;
    try {
      contentBase64 = utf8ToBase64(JSON.stringify(payload));
    } catch (encErr) {
      els.publishStatus.textContent = 'Could not encode the dataset: ' + encErr.message;
      els.publishBtn.disabled = false;
      return;
    }

    fetch(apiUrl + '?ref=' + encodeURIComponent(branch), { headers: headers })
      .then(function (getRes) {
        if (getRes.status === 200) return getRes.json().then(function (j) { return j.sha; });
        if (getRes.status === 404) return undefined;
        return getRes.text().then(function (t) {
          throw new Error('Could not check existing file (HTTP ' + getRes.status + '): ' + t.slice(0, 200));
        });
      })
      .then(function (sha) {
        var putBody = { message: 'Publish quality dashboard data', content: contentBase64, branch: branch };
        if (sha) putBody.sha = sha;
        var putHeaders = {};
        for (var k in headers) putHeaders[k] = headers[k];
        putHeaders['Content-Type'] = 'application/json';
        return fetch(apiUrl, { method: 'PUT', headers: putHeaders, body: JSON.stringify(putBody) })
          .then(function (putRes) {
            return putRes.json().then(function (putJson) {
              if (!putRes.ok) throw new Error((putJson && putJson.message) || ('HTTP ' + putRes.status));
              return putJson;
            });
          });
      })
      .then(function (putJson) {
        var commitUrl = putJson.commit && putJson.commit.html_url;
        els.publishStatus.innerHTML = 'Published successfully.' +
          (commitUrl ? ' <a href="' + commitUrl + '" target="_blank" rel="noopener">View commit</a>' : '') +
          ' GitHub Pages should update within about a minute.';
      })
      .catch(function (err) {
        els.publishStatus.textContent = 'Publish failed: ' + err.message;
      })
      .then(function () {
        els.publishBtn.disabled = false;
      });
  }

  /* ---------------------------- admin panel wiring ---------------------------- */

  function tryAdminLogin() {
    if (els.adminPassword.value === ADMIN_PASSCODE) {
      els.adminLoginView.classList.add('hidden');
      els.adminToolsView.classList.remove('hidden');
      els.adminError.textContent = '';
      renderColumnMappingTable();
      renderSessionInfo();
    } else {
      els.adminError.textContent = 'Incorrect passcode.';
    }
  }

  function wireAdminEvents() {
    if (els.adminToggleBtn) {
      els.adminToggleBtn.addEventListener('click', function () {
        els.adminOverlay.classList.remove('hidden');
        els.adminLoginView.classList.remove('hidden');
        els.adminToolsView.classList.add('hidden');
        els.adminPassword.value = '';
        els.adminError.textContent = '';
      });
    }
    if (els.adminCloseBtn) els.adminCloseBtn.addEventListener('click', function () { els.adminOverlay.classList.add('hidden'); });
    if (els.adminOverlay) {
      els.adminOverlay.addEventListener('click', function (e) {
        if (e.target === els.adminOverlay) els.adminOverlay.classList.add('hidden');
      });
    }
    if (els.adminLoginBtn) els.adminLoginBtn.addEventListener('click', tryAdminLogin);
    if (els.adminPassword) {
      els.adminPassword.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') tryAdminLogin();
      });
    }
    if (els.romMappingInput) {
      els.romMappingInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) handleRomMappingFile(e.target.files[0]);
      });
    }
    if (els.articleMapInput) {
      els.articleMapInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) handleArticleMapFile(e.target.files[0]);
      });
    }
    if (els.exportCsvBtn) els.exportCsvBtn.addEventListener('click', exportCsv);
    if (els.publishBtn) els.publishBtn.addEventListener('click', publishToGithub);
  }

  /* ---------------------------- upload wiring ---------------------------- */

  function wireUploadEvents() {
    if (els.dropZone) els.dropZone.addEventListener('click', function () { els.fileInput.click(); });
    if (els.browseBtn) {
      els.browseBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        els.fileInput.click();
      });
    }
    if (els.fileInput) {
      els.fileInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) handleWorkbookFile(e.target.files[0]);
      });
    }
    if (els.dropZone) {
      els.dropZone.addEventListener('dragover', function (e) { e.preventDefault(); els.dropZone.classList.add('drag-over'); });
      ['dragleave', 'drop'].forEach(function (evt) {
        els.dropZone.addEventListener(evt, function (e) { e.preventDefault(); els.dropZone.classList.remove('drag-over'); });
      });
      els.dropZone.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleWorkbookFile(f);
      });
    }
    if (els.loadSheetsBtn) els.loadSheetsBtn.addEventListener('click', loadSelectedSheets);
    if (els.resetFiltersBtn) {
      els.resetFiltersBtn.addEventListener('click', function () {
        filterState = {};
        buildFiltersGrid();
        renderAll();
      });
    }
    if (els.loadDifferentFileBtn) {
      els.loadDifferentFileBtn.addEventListener('click', function () {
        els.liveBanner.classList.add('hidden');
        els.uploadSection.classList.remove('hidden');
        showStatus('Loading a different file only affects this session — the published live data is unchanged.', '');
      });
    }
  }

  /* ---------------------------- initial live-data load ---------------------------- */

  function initLiveData() {
    return fetch('data/quality-data.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res || !res.ok) return null;
        return res.json();
      })
      .then(function (json) {
        if (!json) return;
        records = Array.isArray(json.records) ? json.records : [];
        romMapping = json.romMapping || null;
        articleMap = json.articleMap || null;
        records = joinRomMapping(records, romMapping);
        records = joinArticleMap(records, articleMap);
        isLiveData = true;
        publishedMeta = { publishedAt: json.publishedAt, count: records.length };
        if (els.liveBannerMeta) {
          els.liveBannerMeta.textContent = 'Published ' + formatDateDisplay(json.publishedAt) + ' • ' + records.length.toLocaleString('en-IN') + ' records';
        }
        if (els.liveBanner) els.liveBanner.classList.remove('hidden');
        if (els.uploadSection) els.uploadSection.classList.add('hidden');
        if (els.dashboardContent) els.dashboardContent.classList.remove('hidden');
        buildFiltersGrid();
        renderAll();
        renderSessionInfo();
      })
      .catch(function () {
        /* No published data yet (404) or network error, fall back silently
           to the manual upload flow, which is already the default UI state. */
      });
  }

  /* ---------------------------- boot ---------------------------- */

  wireAdminEvents();
  wireUploadEvents();
  wireTableEvents();
  renderSessionInfo();
  initLiveData();
}
