const base = "https://jangjongbeom.vercel.app";
const month = "2026-03";

function keyOf(r) {
  return `${r.id}|${r.outbound_date_raw}`;
}

const [dataRes, ctRes] = await Promise.all([
  fetch(`${base}/api/inventory/data?debug=1&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
  fetch(`${base}/api/category-trend?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
]);
const data = await dataRes.json();
const ct = await ctRes.json();

const dataOutbound = Array.isArray(data.outbound) ? data.outbound : [];
const dataMonth = dataOutbound.filter((r) => String(r.outbound_date ?? "").slice(0, 7) === month);
const dataMonthSample = dataMonth.slice(0, 50).map((r) => ({
  id: typeof r.id === "number" ? r.id : null,
  outbound_date_raw: String(r.outbound_date ?? ""),
}));

const debug = ct?.outboundValueDebug ?? {};
const s202503 = Array.isArray(debug.outboundMonth202503Samples) ? debug.outboundMonth202503Samples : [];
const s202603 = Array.isArray(debug.outboundMonth202603Samples) ? debug.outboundMonth202603Samples : [];

const s202503Set = new Set(s202503.map(keyOf));
const s202603Set = new Set(s202603.map(keyOf));
const overlapWithData202603_inCt202503 = dataMonthSample.filter((r) => s202503Set.has(keyOf(r)));
const overlapWithData202603_inCt202603 = dataMonthSample.filter((r) => s202603Set.has(keyOf(r)));

console.log(
  JSON.stringify(
    {
      base,
      month,
      serverInfo: ct?.serverInfo ?? null,
      inventoryData202603Count: dataMonth.length,
      categoryTrendQueriedMonthOutboundRows: debug.queriedMonthOutboundRows ?? null,
      categoryTrendOutboundRowCountByMonthKey: debug.outboundRowCountByMonthKey ?? null,
      categoryTrendDatePath: {
        firstRowRawOutboundDate: debug.firstRowRawOutboundDate ?? null,
        lastRowRawOutboundDate: debug.lastRowRawOutboundDate ?? null,
        outboundDateRawSamples: (debug.outboundDateRawSamples ?? []).slice(0, 20),
        outboundDateParsedSamples: (debug.outboundDateParsedSamples ?? []).slice(0, 20),
        outboundMonthKeySamples: (debug.outboundMonthKeySamples ?? []).slice(0, 20),
      },
      crossCompare: {
        data202603SampleCount: dataMonthSample.length,
        overlapCount_data202603_vs_ct202503: overlapWithData202603_inCt202503.length,
        overlapCount_data202603_vs_ct202603: overlapWithData202603_inCt202603.length,
        overlapRows_data202603_vs_ct202503: overlapWithData202603_inCt202503.slice(0, 20),
        overlapRows_data202603_vs_ct202603: overlapWithData202603_inCt202603.slice(0, 20),
      },
      ctSamples: {
        month202503: s202503,
        month202603: s202603,
      },
    },
    null,
    2
  )
);
