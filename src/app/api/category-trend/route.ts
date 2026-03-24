/**
 * 카테고리별 월별 추세 API
 * GET /api/category-trend
 * - 출고 금액: inventory_outbound 행별 total_price > 0 우선 → else unit_price×qty → else 마스터 unit_cost×qty
 *   (문자열/쉼표 포함 금액은 parseMoney로 파싱해 SUM(total_price)와 일치)
 * - 출고 채널: sales_channel만 `normalizeSalesChannelKr` — dest_warehouse·매출구분·보관센터 금지
 * - inventory_inbound quantity 합산 (입고량)
 * - 카테고리: inventory_stock_snapshot.category(품목구분) 기준, product_code별
 * - 월별 재고 자산: snapshot_date >= 차트 시작월의 모든 행을 읽고, 월별 **마지막 snapshot_date**만 카테고리별 total_price 합산 (limit 미사용)
 * - ?debug=1: 출고 금액 샘플 20건 + 월별 채널 금액 집계 메타
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";
import {
  normalizeDestWarehouse,
  normalizeSalesChannelKr,
  WAREHOUSE_COUPANG,
} from "@/lib/inventoryChannels";
import { fetchNaverSearchTrendMonthly, NAVER_CATEGORIES } from "@/lib/naverSearchTrend";

const emptyResponse = {
  months: [] as string[],
  categories: [] as string[],
  chartData: [] as Record<string, string | number>[],
  naverSearchTrend: {} as Record<string, Record<string, number>>,
  momRates: {} as Record<string, Record<string, number | null>>,
  monthlyTotals: {} as Record<string, { outbound: number; inbound: number; outboundValue: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; outboundValueCoupang: number; outboundValueGeneral: number; inboundByChannel: Record<string, number> }>,
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
  },
};

const PAGE_SIZE = 2000;

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  gteCol: string,
  gteVal: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .gte(gteCol, gteVal)
      .order(gteCol, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) break;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/** DB·엑셀에서 온 숫자(쉼표 문자열 등) 파싱 — Number()만 쓰면 NaN → 원가 폴백으로 잘못 집계됨 */
function parseMoney(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, "").replace(/\s/g, "").trim();
  if (s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 출고 라인 금액 — DB SUM(total_price)와 동일 우선순위.
 * total_price > 0 → 그대로, 아니면 unit_price×qty, 마지막만 마스터 unit_cost×qty
 */
function chosenOutboundAmount(
  row: { quantity?: unknown; total_price?: unknown; unit_price?: unknown },
  codeKey: string,
  codeToCost: Map<string, number>
): number {
  const qty = Number(row.quantity ?? 0);
  const totalPrice = parseMoney(row.total_price);
  const unitPrice = parseMoney(row.unit_price);
  const masterUnitCost = Number(codeToCost.get(codeKey) ?? 0);
  if (totalPrice > 0) return totalPrice;
  if (unitPrice > 0 && qty > 0) return unitPrice * qty;
  if (masterUnitCost > 0 && qty > 0) return masterUnitCost * qty;
  return 0;
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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.log("[category-trend] 데이터소스: env 미설정 → empty");
      return NextResponse.json(emptyResponse, { status: 200 });
    }

    const supabase = createClient(url, key);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    // 최근 14개월 기간 (예: 25-02 ~ 26-03): 입·출고·재고 스냅샷 동일 기준일 이상
    const fourteenMonthsAgo = new Date(year, month - 13, 1);
    const dateFrom = `${fourteenMonthsAgo.getFullYear()}-${String(fourteenMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

    const fourteenMonthsSlots: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      fourteenMonthsSlots.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const monthsPreset = fourteenMonthsSlots;

    const [productsRes, outbound, inbound, stockSnapshotRows] = await Promise.all([
      supabase.from("inventory_products").select("product_code,product_name,unit_cost,category").limit(5000),
      fetchAllRows<{
        product_code: string;
        quantity: number;
        outbound_date: string;
        sales_channel?: string;
        product_name?: string;
        category?: string;
        total_price?: number;
        unit_price?: number;
      }>(supabase, "inventory_outbound", "product_code,quantity,outbound_date,sales_channel,product_name,category,total_price,unit_price", "outbound_date", dateFrom),
      fetchAllRows<{ product_code: string; quantity: number; inbound_date: string; dest_warehouse?: string; category?: string }>(
        supabase,
        "inventory_inbound",
        "product_code,quantity,inbound_date,dest_warehouse,category",
        "inbound_date",
        dateFrom
      ),
      fetchAllRows<{
        product_code: string;
        category?: string;
        snapshot_date?: string;
        quantity?: number;
        unit_cost?: number;
        total_price?: number;
        dest_warehouse?: string;
      }>(
        supabase,
        "inventory_stock_snapshot",
        "product_code,category,snapshot_date,quantity,unit_cost,total_price,dest_warehouse",
        "snapshot_date",
        dateFrom
      ),
    ]);

    // DB 0건이면 네이버 API 호출 없이 즉시 empty 반환 (이전 데이터 표시 방지)
    const products = (productsRes.data ?? []) as { product_code: string; product_name?: string; unit_cost?: number; category?: string; group_name?: string }[];
    const snapData = stockSnapshotRows as { product_code: string; category?: string; snapshot_date?: string }[];
    if (outbound.length === 0 && inbound.length === 0 && products.length === 0 && snapData.length === 0) {
      console.log("[category-trend] 데이터소스: inventory_* 0건 → empty (DB)");
      return NextResponse.json(emptyResponse, {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" },
      });
    }

    const naverMonthly = await fetchNaverSearchTrendMonthly();

    /** product_code → category(품목구분): inventory_stock_snapshot 우선 */
    const codeToCategory = new Map<string, string>();
    const byCodeDate = new Map<string, { category: string; date: string }>();
    for (const row of snapData) {
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      const cat = String(row.category ?? "").trim();
      const date = (row.snapshot_date ?? "").slice(0, 10);
      if (!code) continue;
      const existing = byCodeDate.get(code);
      const useCat = cat || (existing?.category ?? "");
      if (!existing || date >= existing.date) byCodeDate.set(code, { category: useCat, date });
    }
    for (const [code, v] of byCodeDate.entries()) {
      if (v.category) codeToCategory.set(code, v.category);
    }

    const codeToCost = new Map<string, number>();
    const categoriesSet = new Set<string>();
    for (const p of products) {
      const k = normalizeCode(p.product_code) || String(p.product_code).trim();
      const fromProduct = String(p.category ?? p.group_name ?? "").trim();
      const catFromSnapshot = codeToCategory.get(k) ?? codeToCategory.get(String(p.product_code).trim());
      const group = (fromProduct && fromProduct !== "기타") ? fromProduct : (catFromSnapshot || "기타");
      if (!codeToCategory.has(k)) codeToCategory.set(k, group);
      if (!codeToCategory.has(String(p.product_code).trim())) codeToCategory.set(String(p.product_code).trim(), group);
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
      const m = (o.outbound_date ?? "").slice(0, 7);
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
    }

    const ordered = [...categoriesSet];
    const finalCategories = CATEGORY_ORDER.filter((c) => ordered.includes(c));

    const months = monthsPreset;

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

    const monthlyTotals: Record<string, { outbound: number; inbound: number; outboundValue: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; outboundValueCoupang: number; outboundValueGeneral: number; inboundByChannel: Record<string, number> }> = {};
    for (const m of months) monthlyTotals[m] = { outbound: 0, inbound: 0, outboundValue: 0, inboundValue: 0, outboundCoupang: 0, outboundGeneral: 0, outboundValueCoupang: 0, outboundValueGeneral: 0, inboundByChannel: {} };

    const outboundDebugSamples: Array<{
      monthKey: string;
      sales_channel: string;
      quantity: number;
      total_price_raw: unknown;
      unit_price_raw: unknown;
      chosen_amount: number;
      channel_kr: string;
    }> = [];

    for (const o of outbound) {
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!monthlyTotals[m]) continue;
      const qty = Number(o.quantity ?? 0);
      const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
      const val = chosenOutboundAmount(o, codeKey, codeToCost);
      const channelKr = normalizeSalesChannelKr(o.sales_channel ?? "");
      const isCoupang = channelKr === WAREHOUSE_COUPANG;

      monthlyTotals[m].outbound += qty;
      monthlyTotals[m].outboundValue += val;
      if (isCoupang) {
        monthlyTotals[m].outboundCoupang += qty;
        monthlyTotals[m].outboundValueCoupang += val;
      } else {
        monthlyTotals[m].outboundGeneral += qty;
        monthlyTotals[m].outboundValueGeneral += val;
      }

      if (debug && outboundDebugSamples.length < 20) {
        outboundDebugSamples.push({
          monthKey: m,
          sales_channel: String(o.sales_channel ?? ""),
          quantity: qty,
          total_price_raw: o.total_price,
          unit_price_raw: o.unit_price,
          chosen_amount: val,
          channel_kr: channelKr,
        });
      }
    }

    if (debug && outboundDebugSamples.length > 0) {
      console.log(
        "[category-trend:debug] outbound amount samples (20)",
        JSON.stringify(outboundDebugSamples, null, 0)
      );
    }
    for (const i of inbound) {
      const m = (i.inbound_date ?? "").slice(0, 7);
      if (!monthlyTotals[m]) continue;
      const qty = Number(i.quantity ?? 0);
      const codeKey = normalizeCode(i.product_code) || String(i.product_code).trim();
      const cost = codeToCost.get(codeKey) ?? 0;
      monthlyTotals[m].inbound += qty;
      monthlyTotals[m].inboundValue += qty * cost;
      const ch = normalizeDestWarehouse(i.dest_warehouse);
      monthlyTotals[m].inboundByChannel[ch] = (monthlyTotals[m].inboundByChannel[ch] ?? 0) + qty;
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
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!byMonthCategoryOutboundValue[m]) continue;
      const rowCat = (o.category ?? "").trim();
      let cat = (rowCat && rowCat !== "기타") ? rowCat : codeToCategory.get(normalizeCode(o.product_code) || "") || codeToCategory.get(String(o.product_code).trim()) || "";
      if (cat === "기타") continue;
      cat = normalizeCategoryName(cat) || "기타";
      if (cat === "기타" || !finalCategories.includes(cat)) continue;
      const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
      const val = chosenOutboundAmount(o, codeKey, codeToCost);
      byMonthCategoryOutboundValue[m][cat] = (byMonthCategoryOutboundValue[m][cat] ?? 0) + val;
    }
    for (const i of inbound) {
      const m = (i.inbound_date ?? "").slice(0, 7);
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

    // 월별 재고 자산: 해당 월의 **마지막 snapshot_date** 1일만 사용 → 카테고리별 total_price 합 (행 전량은 snapshot_date>=dateFrom 페이지네이션으로 로드)
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
    for (const m of months) {
      monthlyValueByCategory[m] = {};
      for (const c of finalCategories) monthlyValueByCategory[m][c] = 0;
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
        const totalPrice = Number(row.total_price ?? 0);
        const val = totalPrice > 0 ? totalPrice : qty * (cost > 0 ? cost : (codeToCost.get(code) ?? codeToCost.get(String(row.product_code ?? "").trim()) ?? 0));
        monthlyValueByCategory[m][cat] = (monthlyValueByCategory[m][cat] ?? 0) + val;
      }
      for (const c of finalCategories) {
        monthlyValueByCategory[m][c] = Math.round(monthlyValueByCategory[m][c] ?? 0);
      }
    }

    /** 증감률 표시 상한: ±50% (비정상 수치 방지) */
    const MOM_RATE_CLAMP = 50;
    const clampMomRate = (r: number) => Math.max(-MOM_RATE_CLAMP, Math.min(MOM_RATE_CLAMP, r));

    const momRates: Record<string, Record<string, number | null>> = {};
    for (const cat of finalCategories) {
      momRates[cat] = {};
      for (let i = 0; i < months.length; i++) {
        const curr = (byMonthCategory[months[i]] ?? {})[cat] ?? 0;
        if (i === 0) momRates[cat][months[i]] = null;
        else {
          const prev = (byMonthCategory[months[i - 1]] ?? {})[cat] ?? 0;
          const raw = prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : (curr > 0 ? 100 : 0);
          momRates[cat][months[i]] = clampMomRate(raw);
        }
      }
    }

    const thisMonthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const prevMonthKey = month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, "0")}`;
    const thisOut = monthlyTotals[thisMonthKey]?.outbound ?? 0;
    const thisIn = monthlyTotals[thisMonthKey]?.inbound ?? 0;
    const prevOut = monthlyTotals[prevMonthKey]?.outbound ?? 0;
    const prevIn = monthlyTotals[prevMonthKey]?.inbound ?? 0;

    const naverSearchTrend: Record<string, Record<string, number>> = {};
    for (const [kw, data] of Object.entries(naverMonthly ?? {})) {
      for (const d of data) {
        const m = d.period.slice(0, 7);
        if (!naverSearchTrend[m]) naverSearchTrend[m] = {};
        naverSearchTrend[m][kw] = d.ratio;
      }
    }

    console.log(
      "[category-trend] 데이터소스: outbound=" +
        outbound.length +
        ", inbound=" +
        inbound.length +
        ", products=" +
        products.length +
        ", snapshot_rows=" +
        snapRows.length +
        ", months_with_last_snapshot=" +
        maxDateByMonth.size
    );

    const monthlySalesByChannel: Record<string, { 일반: number; 쿠팡: number }> = {};
    for (const mk of months) {
      const t = monthlyTotals[mk];
      monthlySalesByChannel[mk] = {
        일반: t?.outboundValueGeneral ?? 0,
        쿠팡: t?.outboundValueCoupang ?? 0,
      };
    }

    const payload: Record<string, unknown> = {
      months,
      categories: finalCategories,
      chartData,
      naverSearchTrend,
      momRates,
      monthlyTotals,
      monthlyValueByCategory,
      momIndicators: {
        outbound: prevOut > 0 ? clampMomRate(Math.round(((thisOut - prevOut) / prevOut) * 1000) / 10) : null,
        inbound: prevIn > 0 ? clampMomRate(Math.round(((thisIn - prevIn) / prevIn) * 1000) / 10) : null,
        thisMonthOutbound: thisOut,
        thisMonthInbound: thisIn,
        /** 출고 금액: chosenOutboundAmount 합 (total_price 우선) — DB SUM(total_price)와 동일 기준 */
        thisMonthOutboundValue: monthlyTotals[thisMonthKey]?.outboundValue ?? 0,
        thisMonthInboundValue: monthlyTotals[thisMonthKey]?.inboundValue ?? 0,
        thisMonthOutboundCoupang: monthlyTotals[thisMonthKey]?.outboundCoupang ?? 0,
        thisMonthOutboundGeneral: monthlyTotals[thisMonthKey]?.outboundGeneral ?? 0,
        thisMonthInboundByChannel: monthlyTotals[thisMonthKey]?.inboundByChannel ?? {},
        /** 채널별 출고 금액(동일 월·동일 규칙) — 그래프 막대 비율 검증용 */
        thisMonthOutboundValueCoupang: monthlyTotals[thisMonthKey]?.outboundValueCoupang ?? 0,
        thisMonthOutboundValueGeneral: monthlyTotals[thisMonthKey]?.outboundValueGeneral ?? 0,
      },
    };

    if (debug) {
      payload.outboundValueDebug = {
        rule:
          "amount: total_price>0 ? total_price : (unit_price>0 && qty>0 ? unit_price*qty : master unit_cost*qty); channel: normalizeSalesChannelKr(sales_channel)",
        samples: outboundDebugSamples,
        monthlySalesByChannel,
      };
    }

    return NextResponse.json(
      payload,
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" },
    }
    );
  } catch (e) {
    console.error("[category-trend] error:", e);
    return NextResponse.json(
      { ...emptyResponse, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 200 }
    );
  }
}
