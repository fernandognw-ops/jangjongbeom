const base = "https://jangjongbeom.vercel.app";
const month = "2026-03";

const [dRes, cRes] = await Promise.all([
  fetch(`${base}/api/inventory/data?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }),
  fetch(`${base}/api/category-trend?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }),
]);
const d = await dRes.json();
const c = await cRes.json();

const dDbg = d?.sourceDebug?.outboundIdDebug ?? {};
const cDbg = c?.outboundValueDebug ?? {};
const cSrc = cDbg?.sourceDebug ?? {};
const dSrc = d?.sourceDebug ?? {};

console.log(
  JSON.stringify(
    {
      base,
      month,
      serverInfo: c?.serverInfo ?? null,
      counts: {
        inventoryData: dDbg?.affectedRowCount ?? null,
        categoryTrend: cDbg?.queriedMonthOutboundRows ?? null,
      },
      idRange: {
        inventoryData: { min: dDbg?.fetchedOutboundIdMin ?? null, max: dDbg?.fetchedOutboundIdMax ?? null },
        categoryTrend: {
          min: cDbg?.fetchedOutboundIdMinForQueriedMonth ?? null,
          max: cDbg?.fetchedOutboundIdMaxForQueriedMonth ?? null,
        },
      },
      idsSample: {
        inventoryData: dDbg?.fetchedOutboundIdsSample ?? [],
        categoryTrend: cDbg?.fetchedOutboundIdsSampleForQueriedMonth ?? [],
      },
      sourceDateRange: {
        inventoryData: { min: dDbg?.sourceDateMin ?? null, max: dDbg?.sourceDateMax ?? null },
        categoryTrend: {
          min: cDbg?.firstRowRawOutboundDate ?? null,
          max: cDbg?.lastRowRawOutboundDate ?? null,
        },
      },
      sourceConfig: {
        inventoryData: {
          selectedColumns: dSrc?.selectedColumns ?? null,
          queryFilter: dSrc?.queryFilter ?? null,
          orderCondition: dSrc?.orderCondition ?? null,
        },
        categoryTrend: {
          selectedColumns: cSrc?.selectedColumns ?? null,
          queryFilter: cSrc?.queryFilter ?? null,
          orderCondition: cSrc?.orderCondition ?? null,
        },
      },
      parity: {
        countMatch: (dDbg?.affectedRowCount ?? -1) === (cDbg?.queriedMonthOutboundRows ?? -2),
        idMinMatch: (dDbg?.fetchedOutboundIdMin ?? -1) === (cDbg?.fetchedOutboundIdMinForQueriedMonth ?? -2),
        idMaxMatch: (dDbg?.fetchedOutboundIdMax ?? -1) === (cDbg?.fetchedOutboundIdMaxForQueriedMonth ?? -2),
      },
    },
    null,
    2
  )
);
