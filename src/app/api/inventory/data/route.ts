/**
 * 단일 출처 API (Single Source of Truth)
 * GET /api/inventory/data
 *
 * - 제품: inventory_products
 * - 수량: inventory_stock_snapshot (product_code로만 매칭)
 * - 두 테이블을 product_code 기준 JOIN하여 한 번에 반환
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";
import { fetchOutboundRowsUnified, monthRange } from "@/lib/outboundQuery";
import { createHash } from "node:crypto";

type MonthDebugRow = {
  rawMonthKey: string;
  groupedMonthKey: string;
  sourceDateMin: string;
  sourceDateMax: string;
  affectedRowCount: number;
};

function buildMonthDebugRows<T>(rows: T[], dateGetter: (row: T) => string): MonthDebugRow[] {
  const map = new Map<string, { min: string; max: string; cnt: number }>();
  for (const row of rows) {
    const raw = String(dateGetter(row) ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    const monthKey = raw.slice(0, 7);
    const prev = map.get(monthKey);
    if (!prev) {
      map.set(monthKey, { min: raw, max: raw, cnt: 1 });
      continue;
    }
    prev.cnt += 1;
    if (raw < prev.min) prev.min = raw;
    if (raw > prev.max) prev.max = raw;
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      rawMonthKey: key,
      groupedMonthKey: key,
      sourceDateMin: v.min,
      sourceDateMax: v.max,
      affectedRowCount: v.cnt,
    }));
}

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    const norm = p.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(norm, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fp(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { products: [], stockByProduct: {}, totalValue: 0, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const targetMonth = new URL(request.url).searchParams.get("month") || "";
  const sourceDbHost = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();
  const jwt = jwtPayload(key);
  const jwtRole = String(jwt?.role ?? "");
  const authContext = {
    anonKeyFingerprint: fp(key),
    supabaseUrlFingerprint: fp(url),
    jwtRole: jwtRole || "unknown",
    serviceRoleKeyUsed: jwtRole === "service_role",
    authRole: jwtRole || "anon",
    rlsBypassLikely: jwtRole === "service_role",
  };
  const noStoreHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const monthParam = new URL(request.url).searchParams.get("month") || "";
    const sinceParam = new URL(request.url).searchParams.get("since")?.trim() ?? "";
    const monthWindow = monthRange(monthParam);
    const dateFromBase = monthWindow?.start ?? oneMonthAgo.toISOString().slice(0, 10);
    const dateFrom =
      sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam) ? sinceParam : dateFromBase;
    const dateTo = monthWindow?.end;

    const [productsRes, snapshotRes, inboundRes, outboundFetch] = await Promise.all([
      supabase.from("inventory_products").select("*").order("product_code").limit(5000),
      supabase.from("inventory_stock_snapshot").select("product_code,quantity,snapshot_date,sales_channel").limit(20000),
      supabase.from("inventory_inbound").select("id,product_code,quantity,inbound_date,sales_channel").gte("inbound_date", dateFrom).limit(10000),
      fetchOutboundRowsUnified<{ id?: number; product_code?: string; quantity?: number; outbound_date?: string; sales_channel?: string }>(
        supabase,
        {
          selectedColumns: "id,product_code,quantity,outbound_date,sales_channel",
          startDate: dateFrom,
          endDate: dateTo,
        }
      ),
    ]);

    if (productsRes.error) {
      return NextResponse.json(
        { products: [], stockByProduct: {}, totalValue: 0, error: productsRes.error.message },
        { status: 200, headers: noStoreHeaders }
      );
    }

    const products = (productsRes.data ?? []) as Array<{ product_code: string; unit_cost?: number; [k: string]: unknown }>;
    const inbound = inboundRes.data ?? [];
    const outbound = outboundFetch.rows ?? [];
    const snapshotRows = (snapshotRes.data ?? []) as Array<{ product_code?: unknown; quantity?: unknown; snapshot_date?: string }>;

    // 수량: inventory_stock_snapshot 최신 snapshot_date 기준, product_code별 수량 합 (채널은 sales_channel으로만 구분·집계)
    const maxDate = snapshotRows.length > 0
      ? snapshotRows.reduce((max, r) => {
          const d = (r.snapshot_date ?? "").toString().slice(0, 10);
          return d > max ? d : max;
        }, "1970-01-01")
      : "";
    const stockByProduct: Record<string, number> = {};
    for (const row of snapshotRows) {
      const date = (row.snapshot_date ?? "").toString().slice(0, 10);
      if (date !== maxDate) continue;
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      if (!code) continue;
      const qty = Number(row.quantity) || 0;
      stockByProduct[code] = (stockByProduct[code] ?? 0) + qty;
    }

    // totalValue = sum(수량 × unit_cost), product_code로 매칭
    let totalValue = 0;
    const codeToCost = new Map<string, number>();
    for (const p of products) {
      const c = normalizeCode(p.product_code) || String(p.product_code ?? "").trim();
      const cost = Number(p.unit_cost) || 0;
      if (c && cost > 0) codeToCost.set(c, cost);
    }
    for (const [code, qty] of Object.entries(stockByProduct)) {
      const cost = codeToCost.get(code) ?? 0;
      totalValue += qty * cost;
    }
    totalValue = Math.round(totalValue);

    const payload: Record<string, unknown> = {
      products,
      stockByProduct,
      totalValue,
      productCount: products.length,
      inbound,
      outbound,
    };
    if (debug) {
      const monthForDebug = targetMonth || "";
      const outboundRows = outbound as Array<{ id?: number; outbound_date?: string }>;
      const filtered = monthForDebug
        ? outboundRows.filter((r) => String(r.outbound_date ?? "").slice(0, 7) === monthForDebug)
        : outboundRows;
      const ids = filtered.map((r) => (typeof r.id === "number" ? r.id : null)).filter((v): v is number => v != null);
      ids.sort((a, b) => a - b);
      const dateVals = filtered.map((r) => String(r.outbound_date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      payload.monthKeyDebug = {
        inbound: buildMonthDebugRows(inbound as Array<{ inbound_date?: string }>, (r) => String(r.inbound_date ?? "")),
        outbound: buildMonthDebugRows(outbound as Array<{ outbound_date?: string }>, (r) => String(r.outbound_date ?? "")),
        snapshot: buildMonthDebugRows(snapshotRows, (r) => String(r.snapshot_date ?? "")),
      };
      payload.sourceDebug = {
        databaseHost: sourceDbHost,
        schemaName: "public",
        sourceName: "inventory_outbound",
        sourceType: "table",
        clientType: "supabase-js",
          queryFilter: { ...outboundFetch.meta.queryFilter, month: monthForDebug || null },
          orderCondition: outboundFetch.meta.orderCondition,
          selectedColumns: outboundFetch.meta.selectedColumns,
        environmentFingerprint: {
          nodeEnv: process.env.NODE_ENV || "",
          vercelEnv: process.env.VERCEL_ENV || "",
          vercelRegion: process.env.VERCEL_REGION || "",
          projectHost: sourceDbHost,
          runtime: process.env.NEXT_RUNTIME || "nodejs",
        },
        authContext,
        outboundIdDebug: {
          month: monthForDebug || null,
          fetchedOutboundIdMin: ids.length > 0 ? ids[0] : null,
          fetchedOutboundIdMax: ids.length > 0 ? ids[ids.length - 1] : null,
          fetchedOutboundIdsSample: ids.slice(0, 20),
          sourceDateMin: dateVals.length > 0 ? dateVals[0] : null,
          sourceDateMax: dateVals.length > 0 ? dateVals[dateVals.length - 1] : null,
          affectedRowCount: filtered.length,
        },
      };
    }
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { products: [], stockByProduct: {}, totalValue: 0, inbound: [], outbound: [], error: err },
      { status: 200, headers: noStoreHeaders }
    );
  }
}
