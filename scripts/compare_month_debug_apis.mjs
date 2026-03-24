const BASE_URL = (process.env.VERCEL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://jangjongbeom.vercel.app").replace(/\/$/, "");
const TARGET_MONTH = process.env.TARGET_MONTH || "2026-03";

async function getJson(path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: true, raw: text.slice(0, 800) };
  }
  return { url, status: res.status, json };
}

function pickMonthRows(rows, month) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.filter((r) => String(r?.groupedMonthKey ?? "") === month || String(r?.rawMonthKey ?? "") === month);
}

function summarizeRows(rows) {
  return rows.map((r) => ({
    rawMonthKey: r.rawMonthKey ?? "",
    groupedMonthKey: r.groupedMonthKey ?? "",
    sourceDateMin: r.sourceDateMin ?? "",
    sourceDateMax: r.sourceDateMax ?? "",
    affectedRowCount: r.affectedRowCount ?? 0,
  }));
}

function getMonthKeyDebug(obj) {
  if (!obj || typeof obj !== "object") return {};
  if (obj.outboundValueDebug?.monthKeyDebug) return obj.outboundValueDebug.monthKeyDebug;
  if (obj.monthKeyDebug) return obj.monthKeyDebug;
  return {};
}

const [ct, sum, data] = await Promise.all([
  getJson(`/api/category-trend?debug=1&month=${TARGET_MONTH}&_t=${Date.now()}`),
  getJson(`/api/inventory/summary?debug=1&_t=${Date.now()}`),
  getJson(`/api/inventory/data?debug=1&_t=${Date.now()}`),
]);

const apis = [
  { name: "category-trend", result: ct },
  { name: "inventory-summary", result: sum },
  { name: "inventory-data", result: data },
];

const output = {
  baseUrl: BASE_URL,
  targetMonth: TARGET_MONTH,
  compared: {},
};

for (const api of apis) {
  const mkd = getMonthKeyDebug(api.result.json);
  const outboundRows = pickMonthRows(mkd.outbound, TARGET_MONTH);
  const inboundRows = pickMonthRows(mkd.inbound, TARGET_MONTH);
  const snapshotRows = pickMonthRows(mkd.snapshot, TARGET_MONTH);
  output.compared[api.name] = {
    url: api.result.url,
    status: api.result.status,
    outbound: summarizeRows(outboundRows),
    inbound: summarizeRows(inboundRows),
    snapshot: summarizeRows(snapshotRows),
    availableMonthKeys: {
      outbound: (Array.isArray(mkd.outbound) ? mkd.outbound : []).map((r) => r.groupedMonthKey).slice(-8),
      inbound: (Array.isArray(mkd.inbound) ? mkd.inbound : []).map((r) => r.groupedMonthKey).slice(-8),
      snapshot: (Array.isArray(mkd.snapshot) ? mkd.snapshot : []).map((r) => r.groupedMonthKey).slice(-8),
    },
  };
}

console.log(JSON.stringify(output, null, 2));
