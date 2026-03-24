const base = "https://jangjongbeom.vercel.app";
const month = "2026-03";

const [ctRes, dataRes] = await Promise.all([
  fetch(`${base}/api/category-trend?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }),
  fetch(`${base}/api/inventory/data?debug=1&month=${month}&_t=${Date.now()}`, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }),
]);
const ct = await ctRes.json();
const data = await dataRes.json();

const ovd = ct?.outboundValueDebug ?? {};
const cSrc = ovd?.sourceDebug ?? {};
const dSrc = data?.sourceDebug ?? {};

console.log(
  JSON.stringify(
    {
      base,
      month,
      categoryTrend: {
        serverInfo: ct?.serverInfo ?? null,
        queriedMonthOutboundRows: ovd?.queriedMonthOutboundRows ?? null,
        outboundRowCountByMonthKey: ovd?.outboundRowCountByMonthKey ?? null,
        sourceDateRange: {
          first: ovd?.firstRowRawOutboundDate ?? null,
          last: ovd?.lastRowRawOutboundDate ?? null,
        },
        idRange: {
          minAll: ovd?.fetchedOutboundIdMin ?? null,
          maxAll: ovd?.fetchedOutboundIdMax ?? null,
          minQueriedMonth: ovd?.fetchedOutboundIdMinForQueriedMonth ?? null,
          maxQueriedMonth: ovd?.fetchedOutboundIdMaxForQueriedMonth ?? null,
        },
        idsSampleAll: ovd?.fetchedOutboundIdsSample ?? [],
        idsSampleQueriedMonth: ovd?.fetchedOutboundIdsSampleForQueriedMonth ?? [],
        sourceDebug: cSrc,
      },
      inventoryData: {
        outboundRowsMonth: data?.sourceDebug?.outboundIdDebug?.affectedRowCount ?? null,
        idRange: {
          min: data?.sourceDebug?.outboundIdDebug?.fetchedOutboundIdMin ?? null,
          max: data?.sourceDebug?.outboundIdDebug?.fetchedOutboundIdMax ?? null,
        },
        idsSample: data?.sourceDebug?.outboundIdDebug?.fetchedOutboundIdsSample ?? [],
        sourceDateRange: {
          min: data?.sourceDebug?.outboundIdDebug?.sourceDateMin ?? null,
          max: data?.sourceDebug?.outboundIdDebug?.sourceDateMax ?? null,
        },
        sourceDebug: dSrc,
      },
      sourceParityCheck: {
        sameDbHost: (cSrc?.databaseHost ?? "") === (dSrc?.databaseHost ?? ""),
        sameSourceName: (cSrc?.sourceName ?? "") === (dSrc?.sourceName ?? ""),
        sameSourceType: (cSrc?.sourceType ?? "") === (dSrc?.sourceType ?? ""),
        sameClientType: (cSrc?.clientType ?? "") === (dSrc?.clientType ?? ""),
      },
    },
    null,
    2
  )
);
