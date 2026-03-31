/**
 * 카테고리별 월별 추세 API
 * GET /api/category-trend
 * - 출고 금액: inventory_outbound 행별 outbound_total_amount > 0 우선 → else total_price > 0 → else unit_price×qty → else 마스터 unit_cost×qty
 *   (문자열/쉼표 포함 금액은 parseMoney로 파싱해 SUM(total_price)와 일치)
 * - 출고 채널: `outboundChannelKrFromRow`(sales_channel only) → `normalizeSalesChannelKr`
 * - 금지: channel/dest/center/warehouse 계열 컬럼으로 채널 축 대체
 * - inventory_inbound quantity 합산 (입고량)
 * - 카테고리: inventory_stock_snapshot.category(품목구분) 기준, product_code별
 * - 월 범위: (요청 month 없음) 세 테이블 최소 일자 중 가장 이른 날부터 전량 로드. 월 축 = 입고·출고·스냅샷에 나타난 월의 합집합(교집합 아님), 테이블별 없는 월은 0
 * - 월별 재고 자산: 해당 월 **마지막 snapshot_date** 1일만 카테고리별 total_price 합산
 * - ?debug=1: 출고 금액 샘플 20건 + 월별 채널 금액 집계 메타
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { normalizeCode } from "@/lib/inventoryApi";
import {
  WAREHOUSE_COUPANG,
  WAREHOUSE_GENERAL,
  normalizeSalesChannelKr,
  outboundChannelKrFromRow,
} from "@/lib/inventoryChannels";
import { fetchOutboundRowsUnified } from "@/lib/outboundQuery";
import { fetchNaverSearchTrendMonthly, NAVER_CATEGORIES } from "@/lib/naverSearchTrend";
import {
  parseMoney,
  chosenOutboundAmount,
  type ChosenAmountSource,
} from "@/lib/outboundAmountSelection";

const emptyResponse = {
  months: [] as string[],
  categories: [] as string[],
  chartData: [] as Record<string, string | number>[],
  naverSearchTrend: {} as Record<string, Record<string, number>>,
  momRates: {} as Record<string, Record<string, number | null>>,
  monthlyTotals: {} as Record<string, { outbound: number; inbound: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; outboundValueCoupang: number; outboundValueGeneral: number; inboundByChannel: Record<string, number> }>,
  momIndicators: {
    outbound: null as number | null,
    inbound: null as number | null,
    thisMonthOutbound: 0,
    thisMonthInbound: 0,
    thisMonthOutboundValue: 0,
    thisMonthInboundValue: 0,
    thisMonthOutboundCoupang: 0,
    thisMonthOutboundGeneral: 0,
    thisMonthInboundByChannel: {} as Record<string, number>,
    kpiMonthKey: null as string | null,
    prevKpiMonthKey: null as string | null,
  },
  sourceTablesEmpty: true as boolean,
  rowCounts: { inbound: 0, outbound: 0, snapshot: 0 },
};

const PAGE_SIZE = 2000;
const CATEGORY_TREND_SERVER_MARKER = "category-trend-v2-serverinfo-2026-03-24";

type FetchPageDebug = {
  table: string;
  pageIndex: number;
  rangeStart: number;
  rangeEnd: number;
  fetchedRowCount: number;
  cumulativeRowCount: number;
  hasNextPage: boolean;
  breakReason:
    | "continue"
    | "normal_end_short_page"
    | "max_pages_guard"
    | "error";
  error: string | null;
};

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    const norm = String(p ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(norm, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fp(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

async function minDateAcrossInventoryTables(supabase: SupabaseClient): Promise<string> {
  const earliest = async (table: string, col: string): Promise<string | null> => {
    const { data } = await supabase.from(table).select(col).order(col, { ascending: true }).limit(1).maybeSingle();
    const v = (data as Record<string, unknown> | null)?.[col];
    const s = v != null ? String(v).trim().slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const [a, b, c] = await Promise.all([
    earliest("inventory_inbound", "inbound_date"),
    earliest("inventory_outbound", "outbound_date"),
    earliest("inventory_stock_snapshot", "snapshot_date"),
  ]);
  const dates = [a, b, c].filter((x): x is string => !!x);
  if (dates.length === 0) return "1970-01-01";
  return dates.sort()[0];
}

function prevCalendarMonthKey(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return "";
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (m <= 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  gteCol: string,
  gteVal: string,
  tieBreakerCol?: string | string[],
  onPageDebug?: (d: FetchPageDebug) => void
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let pageIndex = 0;
  const maxPages = 1000;
  while (true) {
    if (pageIndex >= maxPages) {
      console.error(`[fetchAllRows] max pages reached table=${table} pageIndex=${pageIndex}, partialRows=${all.length}`);
      onPageDebug?.({
        table,
        pageIndex,
        rangeStart: offset,
        rangeEnd: offset + PAGE_SIZE - 1,
        fetchedRowCount: 0,
        cumulativeRowCount: all.length,
        hasNextPage: false,
        breakReason: "max_pages_guard",
        error: null,
      });
      break;
    }
    const rangeStart = offset;
    const rangeEnd = offset + PAGE_SIZE - 1;
    let q = supabase
      .from(table)
      .select(select)
      .gte(gteCol, gteVal)
      .order(gteCol, { ascending: true });
    if (Array.isArray(tieBreakerCol)) {
      for (const col of tieBreakerCol) q = q.order(col, { ascending: true });
    } else if (tieBreakerCol) {
      q = q.order(tieBreakerCol, { ascending: true });
    }
    const { data, error } = await q.range(rangeStart, rangeEnd);
    if (error) {
      console.error(
        `[fetchAllRows] query failed table=${table} page=${pageIndex} range=${rangeStart}-${rangeEnd} error=${error.message}`
      );
      onPageDebug?.({
        table,
        pageIndex,
        rangeStart,
        rangeEnd,
        fetchedRowCount: 0,
        cumulativeRowCount: all.length,
        hasNextPage: false,
        breakReason: "error",
        error: error.message,
      });
      break;
    }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    const hasNextPage = rows.length === PAGE_SIZE;
    onPageDebug?.({
      table,
      pageIndex,
      rangeStart,
      rangeEnd,
      fetchedRowCount: rows.length,
      cumulativeRowCount: all.length,
      hasNextPage,
      breakReason: hasNextPage ? "continue" : "normal_end_short_page",
      error: null,
    });
    if (!hasNextPage) break;
    offset += PAGE_SIZE;
    pageIndex += 1;
  }
  return all;
}

async function fetchOutboundRows(
  supabase: SupabaseClient,
  dateFrom: string,
  dateTo: string | undefined,
  onPageDebug?: (d: FetchPageDebug) => void
): Promise<
  Array<{
    id?: number;
    product_code: string;
    quantity: number;
    outbound_date: string;
    sales_channel?: string;
    product_name?: string;
    category?: string;
    total_price?: number;
    unit_price?: number;
    outbound_total_amount?: number;
  }>
> {
  const base = await fetchOutboundRowsUnified<{
    id?: number;
    product_code: string;
    quantity: number;
    outbound_date: string;
    sales_channel?: string;
    product_name?: string;
    category?: string;
  }>(
    supabase,
    {
      selectedColumns:
        "id,product_code,quantity,outbound_date,sales_channel,product_name,category",
      startDate: dateFrom,
      endDate: dateTo,
      onPageDebug,
    }
  );
  const baseRows = base.rows;
  if (baseRows.length === 0) return [];
  const ids = baseRows
    .map((r) => (typeof r.id === "number" ? r.id : null))
    .filter((v): v is number => v != null);
  const map = new Map<number, { total_price?: number; unit_price?: number; outbound_total_amount?: number }>();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { data, error } = await supabase
      .from("inventory_outbound")
      .select("id,total_price,unit_price,outbound_total_amount")
      .in("id", batch);
    if (error) {
      console.error(`[fetchOutboundRows:enrich] batch failed, using rows without price enrich: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const id = Number((row as { id?: number }).id ?? 0);
      if (!id) continue;
      map.set(id, {
        total_price: Number((row as { total_price?: number }).total_price ?? 0),
        unit_price: Number((row as { unit_price?: number }).unit_price ?? 0),
        outbound_total_amount: Number((row as { outbound_total_amount?: number }).outbound_total_amount ?? 0),
      });
    }
  }
  return baseRows.map((r) => {
    const id = typeof r.id === "number" ? r.id : 0;
    const ex = map.get(id);
    return {
      ...r,
      total_price: ex?.total_price ?? 0,
      unit_price: ex?.unit_price ?? 0,
      outbound_total_amount: ex?.outbound_total_amount ?? 0,
    };
  });
}

type MonthDebugRow = {
  rawMonthKey: string;
  groupedMonthKey: string;
  sourceDateMin: string;
  sourceDateMax: string;
  affectedRowCount: number;
};

function dateToYmdRawFirst(value: unknown): string {
  const raw = String(value ?? "").trim();
  const ymd = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
}

function monthKeyFromYmd(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.slice(0, 7) : "";
}

/** ISO YYYY-MM-DD 우선, 실패 시 문자열 앞부분 YYYY-MM / 슬래시·하이픈 월 */
function monthKeyFromAnyDate(value: unknown): string {
  const ymd = dateToYmdRawFirst(value);
  if (ymd) return monthKeyFromYmd(ymd);
  const raw = String(value ?? "").trim();
  const m1 = raw.match(/^(\d{4})-(\d{2})/);
  if (m1 && m1[1] && m1[2]) return `${m1[1]}-${m1[2]}`;
  const m2 = raw.match(/^(\d{4})[\/](\d{1,2})/);
  if (m2 && m2[1] && m2[2]) {
    return `${m2[1]}-${String(m2[2]).padStart(2, "0")}`;
  }
  return "";
}

function buildMonthDebugRows<T>(
  rows: T[],
  dateGetter: (row: T) => string
): MonthDebugRow[] {
  const map = new Map<string, { min: string; max: string; cnt: number }>();
  for (const row of rows) {
    const raw = dateToYmdRawFirst(dateGetter(row));
    if (!raw) continue;
    const monthKey = monthKeyFromYmd(raw);
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

/** 카테고리 정규화: 마스터 5개만. 캡슐세제 사은품 → 캡슐세제 */
function normalizeCategoryName(cat: string): string {
  const s = String(cat ?? "").trim();
  if (s === "캡슐세제 사은품" || (s.includes("캡슐세제") && s.includes("사은품"))) return "캡슐세제";
  return s;
}

/** 마스터 코드 5개만. 대시보드에 이 외 카테고리 표시 금지 */
const CATEGORY_ORDER = ["마스크", "캡슐세제", "섬유유연제", "액상세제", "생활용품"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const debug = searchParams.get("debug") === "1";

    const serverInfo = {
      marker: CATEGORY_TREND_SERVER_MARKER,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "",
      branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || "",
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || "",
      ts: new Date().toISOString(),
    };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.log("[category-trend] 데이터소스: env 미설정 → empty");
      return NextResponse.json({ ...emptyResponse, serverInfo }, { status: 200 });
    }

    const supabase = createClient(url, key);
    // month 쿼리 기반 필터링/슬라이싱/최근 N개월 제한 로직은 제거하고,
    // DB에서 조회된 모든 month를 합집합으로 그대로 반환한다.
    const rangeStart = await minDateAcrossInventoryTables(supabase);

    // 백필/복구로 생길 수 있는 “invalid source trace” outbound row는 category-trend 집계 대상에서 제외한다.
    const invalidOutboundIdSet = new Set<number>();
    const INVALID_TABLE = "inventory_outbound_sales_channel_invalid";
    try {
      const { data: invalidRows } = await supabase
        .from(INVALID_TABLE)
        .select("id")
        .gte("outbound_date", rangeStart);
      for (const r of invalidRows ?? []) {
        if (typeof (r as any).id === "number") invalidOutboundIdSet.add((r as any).id);
      }
    } catch {
      /* invalid table 미존재 등은 무시 */
    }
    const isInvalidOutbound = (id: unknown): boolean =>
      typeof id === "number" && invalidOutboundIdSet.has(id);
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

    const fetchPageDebug: { outbound: FetchPageDebug[]; inbound: FetchPageDebug[]; snapshot: FetchPageDebug[] } = {
      outbound: [],
      inbound: [],
      snapshot: [],
    };

    const [productsRes, outbound, inbound, stockSnapshotRows] = await Promise.all([
      supabase.from("inventory_products").select("product_code,product_name,unit_cost,category").limit(5000),
      fetchOutboundRows(supabase, rangeStart, undefined, (d) => fetchPageDebug.outbound.push(d)),
      fetchAllRows<{ id?: number; product_code: string; quantity: number; inbound_date: string; sales_channel?: string; category?: string }>(
        supabase,
        "inventory_inbound",
        "id,product_code,quantity,inbound_date,sales_channel,category",
        "inbound_date",
        rangeStart,
        "id",
        (d) => fetchPageDebug.inbound.push(d)
      ),
      fetchAllRows<{
        product_code: string;
        category?: string;
        snapshot_date?: string;
        quantity?: number;
        unit_cost?: number;
        total_price?: number;
        dest_warehouse?: string;
        storage_center?: string;
      }>(
        supabase,
        "inventory_stock_snapshot",
        "product_code,category,snapshot_date,quantity,unit_cost,total_price,dest_warehouse,storage_center,sales_channel",
        "snapshot_date",
        rangeStart,
        ["product_code", "dest_warehouse", "storage_center"],
        (d) => fetchPageDebug.snapshot.push(d)
      ),
    ]);

    const inboundCount = inbound.length;
    const outboundCount = outbound.length;
    const snapshotCount = stockSnapshotRows.length;
    const rowCountsMeta = { inbound: inboundCount, outbound: outboundCount, snapshot: snapshotCount };

    const monthKeysFromData = new Set<string>();
    for (const o of outbound) {
      const m = monthKeyFromAnyDate(o.outbound_date);
      if (m) monthKeysFromData.add(m);
    }
    for (const i of inbound) {
      const m = monthKeyFromAnyDate(i.inbound_date);
      if (m) monthKeysFromData.add(m);
    }
    for (const row of stockSnapshotRows) {
      const m = monthKeyFromAnyDate((row as { snapshot_date?: string }).snapshot_date);
      if (m) monthKeysFromData.add(m);
    }
    let months = [...monthKeysFromData].sort();
    // 행은 있는데 날짜 파싱만 전부 실패한 극단적 경우: rangeStart 월로 축 1개 유지 (빈 months 전체 반환 방지)
    if (months.length === 0 && inboundCount + outboundCount + snapshotCount > 0) {
      const m0 = monthKeyFromAnyDate(rangeStart);
      if (m0) months = [m0];
    }

    const products = (productsRes.data ?? []) as { product_code: string; product_name?: string; unit_cost?: number; category?: string; group_name?: string }[];
    const snapData = stockSnapshotRows as { product_code: string; category?: string; snapshot_date?: string }[];
    // 세 원본 테이블이 모두 0건만 즉시 empty (products 유무와 무관)
    if (inboundCount === 0 && outboundCount === 0 && snapshotCount === 0) {
      console.log("[category-trend] source tables all empty → empty", { ...rowCountsMeta, monthsLength: 0 });
      return NextResponse.json({ ...emptyResponse, serverInfo, sourceTablesEmpty: true, rowCounts: rowCountsMeta }, {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" },
      });
    }

    const naverMonthly = await fetchNaverSearchTrendMonthly();

    /** product_code → category(품목구분): inventory_stock_snapshot 우선 (비-기타 우선 보존) */
    const codeToCategory = new Map<string, string>();
    const byCodeDate = new Map<string, { category: string; date: string }>();
    for (const row of snapData) {
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      const cat = String(row.category ?? "").trim();
      const date = (row.snapshot_date ?? "").slice(0, 10);
      if (!code) continue;
      const existing = byCodeDate.get(code);
      const catNorm = normalizeCategoryName(cat || "");
      if (!existing) {
        byCodeDate.set(code, { category: catNorm, date });
        continue;
      }
      const existingNorm = normalizeCategoryName(existing.category || "");
      const hasExistingNonOther = !!existingNorm && existingNorm !== "기타";
      const hasNewNonOther = !!catNorm && catNorm !== "기타";
      if (hasNewNonOther && (!hasExistingNonOther || date >= existing.date)) {
        byCodeDate.set(code, { category: catNorm, date });
      } else if (!hasExistingNonOther && date >= existing.date) {
        byCodeDate.set(code, { category: catNorm || existingNorm, date });
      }
    }
    for (const [code, v] of byCodeDate.entries()) {
      if (v.category && v.category !== "기타") codeToCategory.set(code, v.category);
    }

    const codeToCost = new Map<string, number>();
    const categoriesSet = new Set<string>();
    for (const p of products) {
      const k = normalizeCode(p.product_code) || String(p.product_code).trim();
      const fromProduct = String(p.category ?? p.group_name ?? "").trim();
      const catFromSnapshot = codeToCategory.get(k) ?? codeToCategory.get(String(p.product_code).trim());
      const group = (fromProduct && fromProduct !== "기타") ? fromProduct : (catFromSnapshot || "기타");
      if (group && group !== "기타" && !codeToCategory.has(k)) codeToCategory.set(k, group);
      if (group && group !== "기타" && !codeToCategory.has(String(p.product_code).trim())) {
        codeToCategory.set(String(p.product_code).trim(), group);
      }
      if (group !== "기타") categoriesSet.add(normalizeCategoryName(group));
      const c = Number(p.unit_cost ?? 0);
      if (c > 0 && c <= 500_000) {
        codeToCost.set(k, c);
        codeToCost.set(String(p.product_code).trim(), c);
      }
    }
    const byMonthCategory: Record<string, Record<string, number>> = {};

    // 그래프·전월대비: 아웃바운드(실제 출고)만 사용. 마스터 5개 카테고리만 표시
    for (const o of outbound) {
      if (isInvalidOutbound((o as any)?.id)) continue;
      const m = monthKeyFromAnyDate(o.outbound_date);
      if (!m) continue;
      if (!byMonthCategory[m]) byMonthCategory[m] = {};
      const rowCat = (o.category ?? "").trim();
      let cat =
        (rowCat && rowCat !== "기타") ? rowCat :
        codeToCategory.get(normalizeCode(o.product_code) || "") ||
        codeToCategory.get(String(o.product_code).trim()) ||
        "";
      if (cat === "기타") continue;
      cat = normalizeCategoryName(cat) || "기타";
      if (cat === "기타") continue;
      categoriesSet.add(cat);
      byMonthCategory[m][cat] = (byMonthCategory[m][cat] ?? 0) + Number(o.quantity ?? 0);
      const code = normalizeCode(o.product_code) || String(o.product_code ?? "").trim();
      if (code && cat && cat !== "기타" && !codeToCategory.has(code)) codeToCategory.set(code, cat);
    }
    for (const i of inbound) {
      const rowCat = (i.category ?? "").trim();
      const cat = normalizeCategoryName(rowCat || "");
      if (!cat || cat === "기타") continue;
      const code = normalizeCode(i.product_code) || String(i.product_code ?? "").trim();
      if (!code) continue;
      if (!codeToCategory.has(code)) codeToCategory.set(code, cat);
      categoriesSet.add(cat);
    }

    const ordered = [...categoriesSet];
    const finalCategories = CATEGORY_ORDER.filter((c) => ordered.includes(c));

    /** 월간 평균 검색 지수 (월별 출고량과 1:1 대응) */
    const naverByMonth: Record<string, Record<string, number>> = {};
    for (const [kw, data] of Object.entries(naverMonthly ?? {})) {
      for (const d of data) {
        const m = (d.period ?? "").slice(0, 7);
        if (!m || m.length < 7) continue;
        if (!naverByMonth[m]) naverByMonth[m] = {};
        const ratio = typeof d.ratio === "number" ? d.ratio : parseFloat(String(d.ratio ?? 0)) || 0;
        naverByMonth[m][`naver_${kw}`] = Math.min(100, Math.max(0, ratio));
      }
    }

    const chartData = months.map((month) => {
      const row: Record<string, string | number> = { month };
      const cats = byMonthCategory[month] ?? {};
      for (const c of finalCategories) row[c] = cats[c] ?? 0;
      const naverRow = naverByMonth[month] ?? {};
      for (const kw of NAVER_CATEGORIES) {
        if (!finalCategories.includes(kw)) continue;
        const v = naverRow[`naver_${kw}`];
        row[`naver_${kw}`] = typeof v === "number" ? Math.min(100, Math.max(0, v)) : 0;
      }
      return row;
    });

    const monthlyTotals: Record<string, { outbound: number; inbound: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; outboundValueCoupang: number; outboundValueGeneral: number; inboundByChannel: Record<string, number> }> = {};
    for (const m of months) monthlyTotals[m] = { outbound: 0, inbound: 0, inboundValue: 0, outboundCoupang: 0, outboundGeneral: 0, outboundValueCoupang: 0, outboundValueGeneral: 0, inboundByChannel: {} };

    const outboundDebugSamples: Array<{
      monthKey: string;
      sales_channel: string;
      quantity: number;
      total_price_raw: unknown;
      outbound_total_amount_raw: unknown;
      unit_price_raw: unknown;
      chosen_amount: number;
      chosenOutboundAmountSource: ChosenAmountSource;
      channel_kr: string;
    }> = [];
    let suspectedUnitPriceRows = 0;
    const suspectedUnitPriceSamples: Array<{
      monthKey: string;
      sales_channel: string;
      quantity: number;
      total_price_raw: unknown;
      unit_price_raw: unknown;
    }> = [];

    const salesChannelSamplesForMonthlyTotals: string[] = [];
    const invalidSalesChannelRows: Array<{
      id: number | null;
      product_code: string;
      outbound_date: string;
      sales_channel: unknown;
    }> = [];
    const pushInvalidSalesChannelRow = (row: any) => {
      if (invalidSalesChannelRows.length >= 50) return;
      invalidSalesChannelRows.push({
        id: typeof row?.id === "number" ? row.id : null,
        product_code: String(row?.product_code ?? ""),
        outbound_date: String(row?.outbound_date ?? row?.inbound_date ?? "").slice(0, 10),
        sales_channel: row?.sales_channel,
      });
    };

    const monthlyChannelAgg: Record<
      string,
      { coupangQty: number; generalQty: number; coupangValue: number; generalValue: number }
    > = {};
    for (const m of months) {
      monthlyChannelAgg[m] = { coupangQty: 0, generalQty: 0, coupangValue: 0, generalValue: 0 };
    }

    for (const o of outbound) {
      if (isInvalidOutbound((o as any)?.id)) continue;
      const m = monthKeyFromAnyDate(o.outbound_date);
      if (!monthlyTotals[m]) continue;
      const qty = Number(o.quantity ?? 0);
      const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
      const channelVal = parseMoney(o.outbound_total_amount);
      const sc = String(o.sales_channel ?? "");
      const channelKr = outboundChannelKrFromRow(o as Record<string, unknown>);

      if (salesChannelSamplesForMonthlyTotals.length < 20) {
        salesChannelSamplesForMonthlyTotals.push(sc);
        // 분기 전에 샘플 확인용 로그(쿠팡/일반 키 mismatch 방지)
        console.log("[category-trend:monthlyTotals] row.sales_channel sample", sc);
      }

      if (channelKr === WAREHOUSE_COUPANG) {
        monthlyChannelAgg[m].coupangQty += qty;
        monthlyChannelAgg[m].coupangValue += channelVal;
      } else {
        monthlyChannelAgg[m].generalQty += qty;
        monthlyChannelAgg[m].generalValue += channelVal;
      }

      if (debug && outboundDebugSamples.length < 20) {
        const chosen = chosenOutboundAmount(o, codeKey, codeToCost);
        outboundDebugSamples.push({
          monthKey: m,
          sales_channel: String(o.sales_channel ?? ""),
          quantity: qty,
          total_price_raw: o.total_price,
          outbound_total_amount_raw: o.outbound_total_amount,
          unit_price_raw: o.unit_price,
          chosen_amount: chosen.amount,
          chosenOutboundAmountSource: chosen.source,
          channel_kr: channelKr,
        });
      }
      if (debug) {
        const chosen = chosenOutboundAmount(o, codeKey, codeToCost);
        if (chosen.suspectedUnitPrice) {
          suspectedUnitPriceRows += 1;
          if (suspectedUnitPriceSamples.length < 20) {
            suspectedUnitPriceSamples.push({
              monthKey: m,
              sales_channel: String(o.sales_channel ?? ""),
              quantity: qty,
              total_price_raw: o.total_price,
              unit_price_raw: o.unit_price,
            });
          }
        }
      }
    }
    for (const m of months) {
      const g = monthlyChannelAgg[m];
      if (!g || !monthlyTotals[m]) continue;
      monthlyTotals[m].outboundCoupang = g.coupangQty;
      monthlyTotals[m].outboundGeneral = g.generalQty;
      monthlyTotals[m].outboundValueCoupang = g.coupangValue;
      monthlyTotals[m].outboundValueGeneral = g.generalValue;
      // monthlyTotals의 출고 총합은 채널 group 결과만으로 계산
      monthlyTotals[m].outbound = g.coupangQty + g.generalQty;
    }

    if (debug && outboundDebugSamples.length > 0) {
      console.log(
        "[category-trend:debug] outbound amount samples (20)",
        JSON.stringify(outboundDebugSamples, null, 0)
      );
    }
    for (const i of inbound) {
      const m = monthKeyFromAnyDate(i.inbound_date);
      if (!monthlyTotals[m]) continue;
      const qty = Number(i.quantity ?? 0);
      const codeKey = normalizeCode(i.product_code) || String(i.product_code).trim();
      const cost = codeToCost.get(codeKey) ?? 0;
      const ch = normalizeSalesChannelKr(i.sales_channel, { lenient: true });
      monthlyTotals[m].inbound += qty;
      monthlyTotals[m].inboundValue += qty * cost;
      monthlyTotals[m].inboundByChannel[ch] = (monthlyTotals[m].inboundByChannel[ch] ?? 0) + qty;
    }
    if (invalidSalesChannelRows.length > 0) {
      console.warn(
        "[category-trend] invalid/empty sales_channel rows excluded from aggregation (<=50)",
        invalidSalesChannelRows
      );
    }

    const byMonthCategoryInboundValue: Record<string, Record<string, number>> = {};
    const byMonthCategoryOutboundValue: Record<string, Record<string, number>> = {};
    for (const m of months) {
      byMonthCategoryInboundValue[m] = {};
      byMonthCategoryOutboundValue[m] = {};
      for (const c of finalCategories) {
        byMonthCategoryInboundValue[m][c] = 0;
        byMonthCategoryOutboundValue[m][c] = 0;
      }
    }
    for (const o of outbound) {
      if (isInvalidOutbound((o as any)?.id)) continue;
      const m = monthKeyFromAnyDate(o.outbound_date);
      if (!byMonthCategoryOutboundValue[m]) continue;
      const rowCat = (o.category ?? "").trim();
      let cat = (rowCat && rowCat !== "기타") ? rowCat : codeToCategory.get(normalizeCode(o.product_code) || "") || codeToCategory.get(String(o.product_code).trim()) || "";
      if (cat === "기타") continue;
      cat = normalizeCategoryName(cat) || "기타";
      if (cat === "기타" || !finalCategories.includes(cat)) continue;
      const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
      const val = chosenOutboundAmount(o, codeKey, codeToCost).amount;
      byMonthCategoryOutboundValue[m][cat] = (byMonthCategoryOutboundValue[m][cat] ?? 0) + val;
    }
    for (const i of inbound) {
      const m = monthKeyFromAnyDate(i.inbound_date);
      if (!byMonthCategoryInboundValue[m]) continue;
      const rowCat = (i.category ?? "").trim();
      let cat = (rowCat && rowCat !== "기타") ? rowCat : codeToCategory.get(normalizeCode(i.product_code) || "") || codeToCategory.get(String(i.product_code).trim()) || "";
      if (cat === "기타") continue;
      cat = normalizeCategoryName(cat) || "기타";
      if (cat === "기타" || !finalCategories.includes(cat)) continue;
      const qty = Number(i.quantity ?? 0);
      const cost = codeToCost.get(normalizeCode(i.product_code) || "") ?? codeToCost.get(String(i.product_code).trim()) ?? 0;
      byMonthCategoryInboundValue[m][cat] = (byMonthCategoryInboundValue[m][cat] ?? 0) + qty * cost;
    }

    // 월별 재고 자산: 해당 월의 **마지막 snapshot_date** 1일만 사용 → 카테고리별 total_price 합 (행 전량은 snapshot_date>=rangeStart 페이지네이션으로 로드)
    const snapRows = stockSnapshotRows as {
      product_code: string;
      category?: string;
      snapshot_date?: string;
      quantity?: number;
      unit_cost?: number;
      total_price?: number;
      dest_warehouse?: string;
    }[];
    const maxDateByMonth = new Map<string, string>();
    for (const r of snapRows) {
      const d = (r.snapshot_date ?? "").slice(0, 10);
      if (!d) continue;
      const monthKey = d.slice(0, 7);
      const existing = maxDateByMonth.get(monthKey);
      if (!existing || d > existing) maxDateByMonth.set(monthKey, d);
    }

    const monthlyValueByCategory: Record<string, Record<string, number>> = {};
    const monthlyStockTotal: Record<string, number> = {};
    for (const m of months) {
      monthlyValueByCategory[m] = {};
      for (const c of finalCategories) monthlyValueByCategory[m][c] = 0;
      monthlyStockTotal[m] = 0;
      const monthMaxDate = maxDateByMonth.get(m);
      if (!monthMaxDate) continue;
      for (const row of snapRows) {
        const rowDate = (row.snapshot_date ?? "").slice(0, 10);
        if (rowDate !== monthMaxDate) continue;
        const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
        let cat = String(row.category ?? "").trim();
        if (!cat || cat === "기타") cat = codeToCategory.get(code) ?? codeToCategory.get(String(row.product_code ?? "").trim()) ?? "";
        if (!cat) cat = "기타";
        cat = normalizeCategoryName(cat) || "기타";
        if (cat === "기타" || !finalCategories.includes(cat)) continue;
        const qty = Number(row.quantity ?? 0);
        const cost = Number(row.unit_cost ?? 0);
        const totalPrice = parseMoney(row.total_price);
        const val = totalPrice > 0 ? totalPrice : qty * (cost > 0 ? cost : (codeToCost.get(code) ?? codeToCost.get(String(row.product_code ?? "").trim()) ?? 0));
        monthlyValueByCategory[m][cat] = (monthlyValueByCategory[m][cat] ?? 0) + val;
        monthlyStockTotal[m] = (monthlyStockTotal[m] ?? 0) + val;
      }
      for (const c of finalCategories) {
        monthlyValueByCategory[m][c] = Math.round(monthlyValueByCategory[m][c] ?? 0);
      }
      monthlyStockTotal[m] = Math.round(monthlyStockTotal[m] ?? 0);
    }

    const momRates: Record<string, Record<string, number | null>> = {};
    for (const cat of finalCategories) {
      momRates[cat] = {};
      for (let i = 0; i < months.length; i++) {
        const curr = (byMonthCategory[months[i]] ?? {})[cat] ?? 0;
        if (i === 0) momRates[cat][months[i]] = null;
        else {
          const prev = (byMonthCategory[months[i - 1]] ?? {})[cat] ?? 0;
          const raw = prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : (curr > 0 ? 100 : 0);
          momRates[cat][months[i]] = raw;
        }
      }
    }

    /**
     * 대시보드 '당월' KPI: 월 축은 입·출고·스냅샷 일자 합집합이라, 말월이 입·출고 0인 '빈 달'
     * (스냅샷만 다른 월 키로 잡히는 경우 등)이면 월간 출고 카드가 업로드 월(예: 2026-03)과 어긋난다.
     * → 뒤에서부터 출고가 있는 달을 우선, 없으면 입고가 있는 달, 그다음 말월.
     */
    let kpiMonth = "";
    if (months.length > 0) {
      for (let i = months.length - 1; i >= 0; i--) {
        const m = months[i]!;
        const mt = monthlyTotals[m];
        if ((mt?.outbound ?? 0) > 0) {
          kpiMonth = m;
          break;
        }
      }
      if (!kpiMonth) {
        for (let i = months.length - 1; i >= 0; i--) {
          const m = months[i]!;
          const mt = monthlyTotals[m];
          if ((mt?.inbound ?? 0) > 0) {
            kpiMonth = m;
            break;
          }
        }
      }
      if (!kpiMonth) kpiMonth = months[months.length - 1]!;
    }
    const prevKpiMonth = kpiMonth ? prevCalendarMonthKey(kpiMonth) : "";
    const thisOut = kpiMonth ? monthlyTotals[kpiMonth]?.outbound ?? 0 : 0;
    const thisIn = kpiMonth ? monthlyTotals[kpiMonth]?.inbound ?? 0 : 0;
    const prevOut = prevKpiMonth ? monthlyTotals[prevKpiMonth]?.outbound ?? 0 : 0;
    const prevIn = prevKpiMonth ? monthlyTotals[prevKpiMonth]?.inbound ?? 0 : 0;

    const naverSearchTrend: Record<string, Record<string, number>> = {};
    for (const [kw, data] of Object.entries(naverMonthly ?? {})) {
      for (const d of data) {
        const m = d.period.slice(0, 7);
        if (!naverSearchTrend[m]) naverSearchTrend[m] = {};
        naverSearchTrend[m][kw] = d.ratio;
      }
    }

    console.log("[category-trend] response meta", {
      monthsLength: months.length,
      inbound: inboundCount,
      outbound: outboundCount,
      snapshot: snapshotCount,
    });

    const monthlySalesByChannel: Record<string, { 일반: number; 쿠팡: number }> = {};
    const monthlySalesConsistency: Record<string, { total: number; byChannelSum: number; diff: number }> = {};
    const monthlyOutboundDebug: Array<{
      month: string;
      outboundRowCount: number;
      sumChosenAmount: number;
      sumUnitPriceXQty: number;
      chosenSourceCounts: Record<ChosenAmountSource, number>;
      chosenSourceAmountSums: Record<ChosenAmountSource, number>;
      finalOutboundValue: number;
    }> = [];
    const outboundRowsByMonthCount: Record<string, number> = {};
    const outboundMonthsSet = new Set<string>();
    for (const o of outbound) {
      if (isInvalidOutbound((o as any)?.id)) continue;
      const mk = monthKeyFromAnyDate(o.outbound_date);
      if (!mk) continue;
      outboundMonthsSet.add(mk);
      outboundRowsByMonthCount[mk] = (outboundRowsByMonthCount[mk] ?? 0) + 1;
    }
    for (const mk of months) {
      const t = monthlyTotals[mk];
      monthlySalesByChannel[mk] = {
        일반: t?.outboundValueGeneral ?? 0,
        쿠팡: t?.outboundValueCoupang ?? 0,
      };
      const byChannelSum = (t?.outboundValueGeneral ?? 0) + (t?.outboundValueCoupang ?? 0);
      const total = byChannelSum;
      monthlySalesConsistency[mk] = {
        total,
        byChannelSum,
        diff: total - byChannelSum,
      };
      const monthRows = outbound.filter((o) => {
        if (isInvalidOutbound((o as any)?.id)) return false;
        return monthKeyFromAnyDate(o.outbound_date) === mk;
      });
      const chosenSourceCounts: Record<ChosenAmountSource, number> = {
        outbound_total_amount: 0,
        total_price: 0,
        unit_price_x_qty: 0,
        master_unit_cost_x_qty: 0,
        fallback_0: 0,
      };
      const chosenSourceAmountSums: Record<ChosenAmountSource, number> = {
        outbound_total_amount: 0,
        total_price: 0,
        unit_price_x_qty: 0,
        master_unit_cost_x_qty: 0,
        fallback_0: 0,
      };
      let sumChosenAmount = 0;
      let sumUnitPriceXQty = 0;
      for (const row of monthRows) {
        const qty = Number(row.quantity ?? 0);
        const codeKey = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
        const chosen = chosenOutboundAmount(row, codeKey, codeToCost);
        chosenSourceCounts[chosen.source] += 1;
        chosenSourceAmountSums[chosen.source] += chosen.amount;
        sumChosenAmount += chosen.amount;
        sumUnitPriceXQty += parseMoney(row.unit_price) * qty;
      }
      monthlyOutboundDebug.push({
        month: mk,
        outboundRowCount: outboundRowsByMonthCount[mk] ?? 0,
        sumChosenAmount: Math.round(sumChosenAmount),
        sumUnitPriceXQty: Math.round(sumUnitPriceXQty),
        chosenSourceCounts,
        chosenSourceAmountSums: Object.fromEntries(
          Object.entries(chosenSourceAmountSums).map(([k, v]) => [k, Math.round(v)])
        ) as Record<ChosenAmountSource, number>,
        finalOutboundValue: Math.round((t?.outboundValueGeneral ?? 0) + (t?.outboundValueCoupang ?? 0)),
      });
    }
    if (debug) {
      console.log("[category-trend:monthly-outbound-debug]", JSON.stringify(monthlyOutboundDebug));
    }

    const payload: Record<string, unknown> = {
      months,
      categories: finalCategories,
      chartData,
      naverSearchTrend,
      momRates,
      monthlyTotals,
      monthlyValueByCategory,
      monthsReturned: months,
      outboundMonthsFound: [...outboundMonthsSet].sort(),
      monthlyOutboundDebug,
      monthlySeriesBeforeFilter: months.map((m) => ({
        month: m,
        outboundValue: (monthlyTotals[m]?.outboundValueCoupang ?? 0) + (monthlyTotals[m]?.outboundValueGeneral ?? 0),
        outboundQty: monthlyTotals[m]?.outbound ?? 0,
      })),
      monthlySeriesAfterFilter: months.map((m) => ({
        month: m,
        outboundValue: (monthlyTotals[m]?.outboundValueCoupang ?? 0) + (monthlyTotals[m]?.outboundValueGeneral ?? 0),
        outboundQty: monthlyTotals[m]?.outbound ?? 0,
      })),
      momIndicators: {
        outbound: prevOut > 0 ? Math.round(((thisOut - prevOut) / prevOut) * 1000) / 10 : null,
        inbound: prevIn > 0 ? Math.round(((thisIn - prevIn) / prevIn) * 1000) / 10 : null,
        thisMonthOutbound: thisOut,
        thisMonthInbound: thisIn,
        /** 출고 금액: chosenOutboundAmount 합 (total_price 우선) — DB SUM(total_price)와 동일 기준 */
        thisMonthOutboundValue: kpiMonth
          ? (monthlyTotals[kpiMonth]?.outboundValueCoupang ?? 0) + (monthlyTotals[kpiMonth]?.outboundValueGeneral ?? 0)
          : 0,
        thisMonthInboundValue: kpiMonth ? monthlyTotals[kpiMonth]?.inboundValue ?? 0 : 0,
        thisMonthOutboundCoupang: kpiMonth ? monthlyTotals[kpiMonth]?.outboundCoupang ?? 0 : 0,
        thisMonthOutboundGeneral: kpiMonth ? monthlyTotals[kpiMonth]?.outboundGeneral ?? 0 : 0,
        thisMonthInboundByChannel: kpiMonth ? monthlyTotals[kpiMonth]?.inboundByChannel ?? {} : {},
        /** 채널별 출고 금액(동일 월·동일 규칙) — 그래프 막대 비율 검증용 */
        thisMonthOutboundValueCoupang: kpiMonth ? monthlyTotals[kpiMonth]?.outboundValueCoupang ?? 0 : 0,
        thisMonthOutboundValueGeneral: kpiMonth ? monthlyTotals[kpiMonth]?.outboundValueGeneral ?? 0 : 0,
        kpiMonthKey: kpiMonth || null,
        prevKpiMonthKey: prevKpiMonth || null,
      },
      rowCounts: rowCountsMeta,
      sourceTablesEmpty: false,
    };

    if (debug) {
      const drillMonth = months.length > 0 ? months[months.length - 1]! : "";
      const monthKeyDebug = {
        outbound: buildMonthDebugRows(outbound, (r) => String(r.outbound_date ?? "")),
        inbound: buildMonthDebugRows(inbound, (r) => String(r.inbound_date ?? "")),
        snapshot: buildMonthDebugRows(snapRows, (r) => String(r.snapshot_date ?? "")),
      };
      const monthOutboundRows = drillMonth
        ? outbound.filter((o) => monthKeyFromAnyDate(o.outbound_date) === drillMonth)
        : [];
      const monthStockRows = drillMonth
        ? snapRows.filter((s) => (s.snapshot_date ?? "").slice(0, 7) === drillMonth)
        : [];
      const monthOutboundBySalesChannel: Record<string, { row_cnt: number; qty: number; amount: number }> = {};
      const monthSalesChannelDistinctRaw = new Set<string>();
      const monthSalesChannelNormalizedCounts: Record<string, number> = {};
      const chosenAmountDistributionBySource: Record<
        ChosenAmountSource,
        { row_cnt: number; amount_sum: number }
      > = {
        outbound_total_amount: { row_cnt: 0, amount_sum: 0 },
        total_price: { row_cnt: 0, amount_sum: 0 },
        unit_price_x_qty: { row_cnt: 0, amount_sum: 0 },
        master_unit_cost_x_qty: { row_cnt: 0, amount_sum: 0 },
        fallback_0: { row_cnt: 0, amount_sum: 0 },
      };
      const monthSalesChannelNullishRows: Array<{ product_code: string; outbound_date: string; sales_channel_raw: string }> = [];
      let queriedMonthSumUnitPriceXQty = 0;
      let queriedMonthSumMasterUnitCostXQty = 0;
      let sumChosenAmountDirect = 0;
      const queriedMonthStockSnapshotDatesSet = new Set<string>();
      const queriedMonthStockAssetByCategory: Record<string, number> = {};
      let queriedMonthStockTotalAsset = 0;
      const outboundDateRawSamples: Array<string> = [];
      const outboundDateParsedSamples: Array<string> = [];
      const outboundMonthKeySamples: Array<string> = [];
      const outboundRowCountByMonthKey: Record<string, number> = {};
      const rawAmountSamples: Array<{
        id: number | null;
        outbound_date: string;
        selectedAmount: number;
        selectedSource: ChosenAmountSource;
        unit_price: number;
        qty: number;
        sales_channel: string;
      }> = [];
      const selectedSourceSamples: Array<{
        id: number | null;
        outbound_date: string;
        selectedSource: ChosenAmountSource;
        selectedAmount: number;
        unit_price: number;
        qty: number;
      }> = [];
      const fetchedOutboundIds = outbound
        .map((o) => (typeof o.id === "number" ? o.id : null))
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      const fetchedOutboundIdsForDrillMonth = drillMonth
        ? outbound
            .filter((o) => monthKeyFromAnyDate(o.outbound_date) === drillMonth)
            .map((o) => (typeof o.id === "number" ? o.id : null))
            .filter((v): v is number => v != null)
            .sort((a, b) => a - b)
        : [];
      let firstRowRawOutboundDate = "";
      let lastRowRawOutboundDate = "";
      for (const s of monthStockRows) {
        const d = String(s.snapshot_date ?? "").slice(0, 10);
        if (d) queriedMonthStockSnapshotDatesSet.add(d);
        const code = normalizeCode(s.product_code) || String(s.product_code ?? "").trim();
        let cat = String(s.category ?? "").trim();
        if (!cat || cat === "기타") {
          cat =
            codeToCategory.get(code) ??
            codeToCategory.get(String(s.product_code ?? "").trim()) ??
            "";
        }
        cat = normalizeCategoryName(cat || "");
        const qty = Number(s.quantity ?? 0);
        const cost = Number(s.unit_cost ?? 0);
        const totalPrice = parseMoney(s.total_price);
        const val =
          totalPrice > 0
            ? totalPrice
            : qty * (cost > 0 ? cost : (codeToCost.get(code) ?? codeToCost.get(String(s.product_code ?? "").trim()) ?? 0));
        queriedMonthStockTotalAsset += val;
        if (cat && cat !== "기타" && finalCategories.includes(cat)) {
          queriedMonthStockAssetByCategory[cat] = (queriedMonthStockAssetByCategory[cat] ?? 0) + val;
        }
      }
      for (const c of Object.keys(queriedMonthStockAssetByCategory)) {
        queriedMonthStockAssetByCategory[c] = Math.round(queriedMonthStockAssetByCategory[c]);
      }
      queriedMonthStockTotalAsset = Math.round(queriedMonthStockTotalAsset);
      for (const o of monthOutboundRows) {
        const rawSc = String(o.sales_channel ?? "");
        const ch = rawSc.trim() || "NULL";
        monthSalesChannelDistinctRaw.add(rawSc);
        if (!monthOutboundBySalesChannel[ch]) monthOutboundBySalesChannel[ch] = { row_cnt: 0, qty: 0, amount: 0 };
        const qty = Number(o.quantity ?? 0);
        const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
        const chosen = chosenOutboundAmount(o, codeKey, codeToCost);
        const amount = chosen.amount;
        sumChosenAmountDirect += amount;
        const qtyXUnit = parseMoney(o.unit_price) * qty;
        const qtyXMaster = (codeToCost.get(codeKey) ?? 0) * qty;
        const sc = String(o.sales_channel ?? "");
        const scTrim = sc.trim();
        const normalizedKr =
          scTrim === "coupang"
            ? WAREHOUSE_COUPANG
            : scTrim === "general"
              ? WAREHOUSE_GENERAL
              : null;
        if (!normalizedKr) {
          pushInvalidSalesChannelRow(o);
          continue;
        }
        monthSalesChannelNormalizedCounts[normalizedKr] = (monthSalesChannelNormalizedCounts[normalizedKr] ?? 0) + 1;
        chosenAmountDistributionBySource[chosen.source].row_cnt += 1;
        chosenAmountDistributionBySource[chosen.source].amount_sum += amount;
        if (!rawSc.trim()) {
          if (monthSalesChannelNullishRows.length < 20) {
            monthSalesChannelNullishRows.push({
              product_code: String(o.product_code ?? ""),
              outbound_date: String(o.outbound_date ?? "").slice(0, 10),
              sales_channel_raw: rawSc,
            });
          }
        }
        queriedMonthSumUnitPriceXQty += qtyXUnit;
        queriedMonthSumMasterUnitCostXQty += qtyXMaster;
        if (rawAmountSamples.length < 50) {
          rawAmountSamples.push({
            id: typeof o.id === "number" ? o.id : null,
            outbound_date: String(o.outbound_date ?? "").slice(0, 10),
            selectedAmount: amount,
            selectedSource: chosen.source,
            unit_price: parseMoney(o.unit_price),
            qty,
            sales_channel: String(o.sales_channel ?? ""),
          });
        }
        if (selectedSourceSamples.length < 50) {
          selectedSourceSamples.push({
            id: typeof o.id === "number" ? o.id : null,
            outbound_date: String(o.outbound_date ?? "").slice(0, 10),
            selectedSource: chosen.source,
            selectedAmount: amount,
            unit_price: parseMoney(o.unit_price),
            qty,
          });
        }
        monthOutboundBySalesChannel[ch].row_cnt += 1;
        monthOutboundBySalesChannel[ch].qty += qty;
        monthOutboundBySalesChannel[ch].amount += amount;
      }
      for (let idx = 0; idx < outbound.length; idx++) {
        const o = outbound[idx]!;
        const rawDate = String(o.outbound_date ?? "");
        const parsedYmd = dateToYmdRawFirst(rawDate);
        const mk = monthKeyFromYmd(parsedYmd);
        if (idx === 0) firstRowRawOutboundDate = rawDate;
        if (idx === outbound.length - 1) lastRowRawOutboundDate = rawDate;
        if (outboundDateRawSamples.length < 40) outboundDateRawSamples.push(rawDate);
        if (outboundDateParsedSamples.length < 40) outboundDateParsedSamples.push(parsedYmd);
        if (outboundMonthKeySamples.length < 40) outboundMonthKeySamples.push(mk);
        if (mk) outboundRowCountByMonthKey[mk] = (outboundRowCountByMonthKey[mk] ?? 0) + 1;
      }
      const sourceDbHost = (() => {
        try {
          return new URL(url).host;
        } catch {
          return "";
        }
      })();
      payload.outboundValueDebug = {
        rule:
          "amount = chosenOutboundAmount(row).amount; channel split uses only sales_channel normalization",
        sourceDbHost,
        sourceDebug: {
          databaseHost: sourceDbHost,
          schemaName: "public",
          sourceName: "inventory_outbound",
          sourceType: "table",
          clientType: "supabase-js",
          queryFilter: {
            outbound_date_gte: rangeStart,
            drillMonth,
            rangeStartInventoryTables: rangeStart,
          },
          orderCondition: "order by outbound_date asc, id asc",
          selectedColumns:
            "id,product_code,quantity,outbound_date,sales_channel,product_name,category,total_price,unit_price,outbound_total_amount",
          environmentFingerprint: {
            nodeEnv: process.env.NODE_ENV || "",
            vercelEnv: process.env.VERCEL_ENV || "",
            vercelRegion: process.env.VERCEL_REGION || "",
            projectHost: sourceDbHost,
            runtime: process.env.NEXT_RUNTIME || "nodejs",
          },
          authContext,
        },
        drillMonth,
        drillMonthOutboundRows: monthOutboundRows.length,
        rawOutboundRowsCount: monthOutboundRows.length,
        rawOutboundIdMin:
          monthOutboundRows
            .map((r) => (typeof r.id === "number" ? r.id : null))
            .filter((v): v is number => v != null)
            .sort((a, b) => a - b)[0] ?? null,
        rawOutboundIdMax: (() => {
          const ids = monthOutboundRows
            .map((r) => (typeof r.id === "number" ? r.id : null))
            .filter((v): v is number => v != null)
            .sort((a, b) => a - b);
          return ids.length > 0 ? ids[ids.length - 1] : null;
        })(),
        rawOutboundIdsSample: monthOutboundRows
          .map((r) => (typeof r.id === "number" ? r.id : null))
          .filter((v): v is number => v != null)
          .sort((a, b) => a - b)
          .slice(0, 50),
        rawOutboundDateMin: monthOutboundRows
          .map((r) => String(r.outbound_date ?? "").slice(0, 10))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort()[0] ?? null,
        rawOutboundDateMax: (() => {
          const dates = monthOutboundRows
            .map((r) => String(r.outbound_date ?? "").slice(0, 10))
            .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            .sort();
          return dates.length > 0 ? dates[dates.length - 1] : null;
        })(),
        queriedMonthSumUnitPriceXQty,
        queriedMonthSumMasterUnitCostXQty,
        sumUnitPriceQtyDirect: queriedMonthSumUnitPriceXQty,
        sumChosenAmountDirect,
        chosenAmountDistributionBySource,
        queriedMonthSalesChannelFieldUsed: "inventory_outbound.sales_channel",
        queriedMonthSalesChannelDistinctRaw: [...monthSalesChannelDistinctRaw].sort(),
        queriedMonthSalesChannelNormalizedCounts: monthSalesChannelNormalizedCounts,
        queriedMonthSalesChannelNullishRowsCount: monthSalesChannelNullishRows.length,
        queriedMonthSalesChannelNullishRows: monthSalesChannelNullishRows,
        queriedMonthBySalesChannel: monthOutboundBySalesChannel,
        drillMonthMonthlyTotals: drillMonth ? monthlyTotals[drillMonth] ?? null : null,
        totalFetchedOutboundRows: outbound.length,
        codePathSignature: "fetchOutboundRowsUnified -> monthKeyFromAnyDate(outbound_date)",
        queriedMonthStockRows: monthStockRows.length,
        queriedMonthStockSnapshotDates: [...queriedMonthStockSnapshotDatesSet].sort(),
        queriedMonthStockAssetByCategory,
        queriedMonthStockTotalAsset,
        monthlyStockValueByCategory: drillMonth
          ? { [drillMonth]: monthlyValueByCategory[drillMonth] ?? {} }
          : {},
        monthlyStockTotal: drillMonth ? { [drillMonth]: monthlyStockTotal[drillMonth] ?? 0 } : {},
        suspectedUnitPriceRows,
        suspectedUnitPriceSamples,
        samples: outboundDebugSamples,
        monthlySalesByChannel,
        monthlySalesConsistency,
        monthKeyDebug,
        fetchPageDebug,
        outboundDateRawSamples,
        outboundDateParsedSamples,
        outboundMonthKeySamples,
        outboundRowCountByMonthKey,
        firstRowRawOutboundDate,
        lastRowRawOutboundDate,
        rawAmountSamples,
        selectedSourceSamples,
        fetchedOutboundIdMin: fetchedOutboundIds.length > 0 ? fetchedOutboundIds[0] : null,
        fetchedOutboundIdMax:
          fetchedOutboundIds.length > 0 ? fetchedOutboundIds[fetchedOutboundIds.length - 1] : null,
        fetchedOutboundIdsSample: fetchedOutboundIds.slice(0, 20),
        fetchedOutboundIdMinForDrillMonth:
          fetchedOutboundIdsForDrillMonth.length > 0 ? fetchedOutboundIdsForDrillMonth[0] : null,
        fetchedOutboundIdMaxForDrillMonth:
          fetchedOutboundIdsForDrillMonth.length > 0
            ? fetchedOutboundIdsForDrillMonth[fetchedOutboundIdsForDrillMonth.length - 1]
            : null,
        fetchedOutboundIdsSampleForDrillMonth: fetchedOutboundIdsForDrillMonth.slice(0, 20),
        grandTotalOutboundValue: Math.round(
          Object.values(monthlyTotals).reduce(
            (s, v) => s + Number(v.outboundValueCoupang ?? 0) + Number(v.outboundValueGeneral ?? 0),
            0
          )
        ),
      };
    }
    payload.serverInfo = serverInfo;

    return NextResponse.json(
      payload,
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" },
    }
    );
  } catch (e) {
    console.error("[category-trend] error:", e);
    return NextResponse.json(
      {
        ...emptyResponse,
        serverInfo: {
          marker: CATEGORY_TREND_SERVER_MARKER,
          commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "",
          branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || "",
          env: process.env.VERCEL_ENV || process.env.NODE_ENV || "",
          ts: new Date().toISOString(),
        },
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 200 }
    );
  }
}
