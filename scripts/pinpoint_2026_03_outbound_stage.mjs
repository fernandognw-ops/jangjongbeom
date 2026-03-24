const base = "https://jangjongbeom.vercel.app";
const month = "2026-03";

function sum(arr, fn) {
  let s = 0;
  for (const x of arr) s += fn(x);
  return s;
}

const [ctRes, dataRes] = await Promise.all([
  fetch(`${base}/api/category-trend?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
  fetch(`${base}/api/inventory/data?debug=1&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
]);
const ct = await ctRes.json();
const data = await dataRes.json();

const dataOutboundMonth = (Array.isArray(data.outbound) ? data.outbound : []).filter(
  (r) => String(r.outbound_date ?? "").slice(0, 7) === month
);
const dataInboundMonth = (Array.isArray(data.inbound) ? data.inbound : []).filter(
  (r) => String(r.inbound_date ?? "").slice(0, 7) === month
);

const out = {
  base,
  month,
  categoryTrend: {
    serverInfo: ct.serverInfo ?? null,
    queriedMonthOutboundRows: ct?.outboundValueDebug?.queriedMonthOutboundRows ?? null,
    queriedMonthMonthlyTotals: ct?.outboundValueDebug?.queriedMonthMonthlyTotals ?? null,
    chosenAmountDistributionBySource: ct?.outboundValueDebug?.chosenAmountDistributionBySource ?? null,
  },
  inventoryData: {
    outboundRowsMonth: dataOutboundMonth.length,
    inboundRowsMonth: dataInboundMonth.length,
    outboundQtyMonth: sum(dataOutboundMonth, (r) => Number(r.quantity ?? 0)),
    inboundQtyMonth: sum(dataInboundMonth, (r) => Number(r.quantity ?? 0)),
    outboundDateMin: dataOutboundMonth.length
      ? dataOutboundMonth.map((r) => String(r.outbound_date ?? "").slice(0, 10)).sort()[0]
      : null,
    outboundDateMax: dataOutboundMonth.length
      ? dataOutboundMonth.map((r) => String(r.outbound_date ?? "").slice(0, 10)).sort().slice(-1)[0]
      : null,
  },
};

console.log(JSON.stringify(out, null, 2));
