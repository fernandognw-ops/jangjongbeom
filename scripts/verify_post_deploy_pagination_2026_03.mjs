const base = "https://jangjongbeom.vercel.app";
const month = "2026-03";

const [dataRes, ctRes] = await Promise.all([
  fetch(`${base}/api/inventory/data?debug=1&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
  fetch(`${base}/api/category-trend?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
]);

const data = await dataRes.json();
const ct = await ctRes.json();

const outboundRows = Array.isArray(data.outbound)
  ? data.outbound.filter((r) => String(r.outbound_date ?? "").slice(0, 7) === month)
  : [];

const fetchPageDebug = ct?.outboundValueDebug?.fetchPageDebug ?? {};
const outboundPages = Array.isArray(fetchPageDebug.outbound) ? fetchPageDebug.outbound : [];

console.log(
  JSON.stringify(
    {
      base,
      month,
      serverInfo: ct?.serverInfo ?? null,
      inventoryDataOutboundRowCount_2026_03: outboundRows.length,
      categoryTrendQueriedMonthOutboundRows: ct?.outboundValueDebug?.queriedMonthOutboundRows ?? null,
      countsMatch: outboundRows.length === (ct?.outboundValueDebug?.queriedMonthOutboundRows ?? -1),
      fetchPageDebugSummary: {
        outboundPageCount: outboundPages.length,
        outboundPages,
      },
    },
    null,
    2
  )
);
