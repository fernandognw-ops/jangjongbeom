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

    return NextResponse.json(
      {
        snapshot: snapshot.status === "fulfilled" ? snapshot.value : null,
        summary: summary.status === "fulfilled" ? summary.value : null,
        inventoryData: inventoryData.status === "fulfilled" ? inventoryData.value : null,
        categoryTrend: categoryTrend.status === "fulfilled" ? categoryTrend.value : null,
        forecast: forecast.status === "fulfilled" ? forecast.value : null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { snapshot: null, summary: null, inventoryData: null, categoryTrend: null, forecast: null, error: errMsg },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

