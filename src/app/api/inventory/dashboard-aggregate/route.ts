import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};

function getBaseUrl(request: Request): string {
  const host = request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

async function callJson(request: Request, pathAndQuery: string): Promise<any> {
  const base = getBaseUrl(request);
  const url = base ? `${base}${pathAndQuery}` : pathAndQuery;
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

function ensureSnapshotShape(snapshot: any) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    items: Array.isArray(s.items) ? s.items : [],
    totalValue: Number(s.totalValue ?? 0),
    totalQuantity: Number(s.totalQuantity ?? 0),
    totalSku: Number(s.totalSku ?? 0),
    productCount: Number(s.productCount ?? 0),
    dailyVelocityByProduct:
      s.dailyVelocityByProduct && typeof s.dailyVelocityByProduct === "object"
        ? s.dailyVelocityByProduct
        : {},
    dailyVelocityByProductCoupang:
      s.dailyVelocityByProductCoupang && typeof s.dailyVelocityByProductCoupang === "object"
        ? s.dailyVelocityByProductCoupang
        : {},
    dailyVelocityByProductGeneral:
      s.dailyVelocityByProductGeneral && typeof s.dailyVelocityByProductGeneral === "object"
        ? s.dailyVelocityByProductGeneral
        : {},
    stockByChannel:
      s.stockByChannel && typeof s.stockByChannel === "object"
        ? s.stockByChannel
        : { coupang: {}, general: {} },
    channelTotals: s.channelTotals && typeof s.channelTotals === "object" ? s.channelTotals : {},
    stockByWarehouse: s.stockByWarehouse && typeof s.stockByWarehouse === "object" ? s.stockByWarehouse : {},
    error: s.error ?? null,
  };
}

function ensureSummaryShape(summary: any) {
  const s = summary && typeof summary === "object" ? summary : {};
  return {
    products: Array.isArray(s.products) ? s.products : [],
    stockSnapshot: Array.isArray(s.stockSnapshot) ? s.stockSnapshot : [],
    stockByProduct: s.stockByProduct && typeof s.stockByProduct === "object" ? s.stockByProduct : {},
    stockByProductByChannel:
      s.stockByProductByChannel && typeof s.stockByProductByChannel === "object"
        ? s.stockByProductByChannel
        : { coupang: {}, general: {} },
    safetyStockByProduct:
      s.safetyStockByProduct && typeof s.safetyStockByProduct === "object"
        ? s.safetyStockByProduct
        : {},
    todayInOutCount:
      s.todayInOutCount && typeof s.todayInOutCount === "object"
        ? s.todayInOutCount
        : { inbound: 0, outbound: 0 },
    recommendedOrderByProduct:
      s.recommendedOrderByProduct && typeof s.recommendedOrderByProduct === "object"
        ? s.recommendedOrderByProduct
        : {},
    totalValue: Number(s.totalValue ?? 0),
    productCount: Number(s.productCount ?? 0),
    avg60DayOutbound:
      s.avg60DayOutbound && typeof s.avg60DayOutbound === "object" ? s.avg60DayOutbound : {},
    items: [],
    error: s.error ?? null,
  };
}

export async function GET(request: Request) {
  const cacheBust = new URL(request.url).searchParams.get("_t") ?? `${Date.now()}`;
  const outboundSince = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  })();

  try {
    const [snapshot, summary, inventoryData, categoryTrend, forecast] = await Promise.allSettled([
      callJson(request, `/api/inventory/snapshot?_t=${cacheBust}`),
      callJson(request, `/api/inventory/summary?_t=${cacheBust}`),
      callJson(request, `/api/inventory/data?since=${outboundSince}&_t=${cacheBust}`),
      callJson(request, `/api/category-trend?_t=${cacheBust}`),
      callJson(request, `/api/forecast?_t=${cacheBust}`),
    ]);

    const rawSnapshot = snapshot.status === "fulfilled" ? snapshot.value : null;
    const rawSummary = summary.status === "fulfilled" ? summary.value : null;
    const snapshotValue = ensureSnapshotShape(rawSnapshot);
    const summaryValue = ensureSummaryShape(rawSummary);
    const snapshotItems = Array.isArray(snapshotValue?.items) ? snapshotValue.items.length : 0;
    const summaryProducts = Array.isArray(summaryValue?.products) ? summaryValue.products.length : 0;
    const summaryStockSnapshot = Array.isArray(summaryValue?.stockSnapshot)
      ? summaryValue.stockSnapshot.length
      : 0;
    const isSnapshotEmpty =
      (snapshotItems === 0 &&
        Number(snapshotValue?.productCount ?? 0) === 0 &&
        Number(snapshotValue?.totalValue ?? 0) === 0);
    const isSummaryEmpty =
      (summaryProducts === 0 &&
        summaryStockSnapshot === 0 &&
        Number(summaryValue?.productCount ?? 0) === 0 &&
        Number(summaryValue?.totalValue ?? 0) === 0);

    console.log("[dashboard-aggregate] snapshot response", {
      settled: snapshot.status,
      error: snapshot.status === "rejected" ? String(snapshot.reason ?? "") : snapshotValue?.error ?? null,
      rowCount: snapshotItems,
      productCount: Number(snapshotValue?.productCount ?? 0),
      totalValue: Number(snapshotValue?.totalValue ?? 0),
      noSnapshot: snapshotValue?.error === "no_snapshot",
    });
    console.log("[dashboard-aggregate] summary response", {
      settled: summary.status,
      error: summary.status === "rejected" ? String(summary.reason ?? "") : summaryValue?.error ?? null,
      rowCountProducts: summaryProducts,
      rowCountStockSnapshot: summaryStockSnapshot,
      productCount: Number(summaryValue?.productCount ?? 0),
      totalValue: Number(summaryValue?.totalValue ?? 0),
    });

    if (isSnapshotEmpty || isSummaryEmpty) {
      console.warn("[dashboard-aggregate] snapshot/summary null or empty", {
        snapshot: {
          isNull: rawSnapshot == null,
          isEmpty: isSnapshotEmpty,
          settled: snapshot.status,
          error: snapshot.status === "rejected" ? String(snapshot.reason ?? "") : snapshotValue?.error ?? null,
          rowCount: snapshotItems,
          productCount: Number(snapshotValue?.productCount ?? 0),
          totalValue: Number(snapshotValue?.totalValue ?? 0),
        },
        summary: {
          isNull: rawSummary == null,
          isEmpty: isSummaryEmpty,
          settled: summary.status,
          error: summary.status === "rejected" ? String(summary.reason ?? "") : summaryValue?.error ?? null,
          rowCountProducts: summaryProducts,
          rowCountStockSnapshot: summaryStockSnapshot,
          productCount: Number(summaryValue?.productCount ?? 0),
          totalValue: Number(summaryValue?.totalValue ?? 0),
        },
      });
    }

    return NextResponse.json(
      {
        snapshot: snapshotValue,
        summary: summaryValue,
        inventoryData: inventoryData.status === "fulfilled" ? inventoryData.value : { inbound: [], outbound: [] },
        categoryTrend: categoryTrend.status === "fulfilled" ? categoryTrend.value : null,
        forecast: forecast.status === "fulfilled" ? forecast.value : null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        snapshot: ensureSnapshotShape(null),
        summary: ensureSummaryShape(null),
        inventoryData: { inbound: [], outbound: [] },
        categoryTrend: null,
        forecast: null,
        error: errMsg,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
}

