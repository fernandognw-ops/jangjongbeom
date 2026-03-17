"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { StockMap, Transaction } from "@/lib/types";
import {
  getShortageItems,
  storage,
  STORAGE_KEYS,
} from "@/lib/store";
import {
  getStoredSyncCode,
  getDefaultWorkspaceId,
  fetchFromCloud,
  fetchDefaultWorkspace,
  pushToCloud,
  pushDefaultWorkspace,
} from "@/lib/sync";
import type { ProductMasterRow } from "@/lib/types";
import { mapGroupToItemId } from "@/lib/unifiedImport";
import {
  computeStockByCategory,
  getStockFromSnapshot,
  computeTotalValueFromSnapshot,
  toTransactions,
  computeInOutByItem,
  getTodayInOutCount,
  computeSafetyStockByProduct,
  computeAvgNDayOutboundByProduct,
  computeRecommendedOrderByProduct,
  normalizeCode,
  type InventoryProduct,
  type InventoryInbound,
  type InventoryOutbound,
  type StockSnapshotRow,
} from "@/lib/inventoryApi";

export type SupabaseFetchStatus =
  | "idle"
  | "ok"
  | "supabase_not_configured"
  | "fetch_error"
  | "empty_data";

interface InventoryContextValue {
  stock: StockMap;
  stockByProduct: Record<string, number>;
  baseStock: StockMap;
  transactions: Transaction[];
  products: ProductMasterRow[];
  totalValue: number;
  /** 전월 말 마감 재고 금액 (스냅샷 기준) */
  lastMonthEndValue?: number;
  /** 현재 재고 - 전월 말 (Variance) */
  valueVariance?: number;
  shortageItems: ReturnType<typeof getShortageItems>;
  safetyStockMap: Record<string, number>;
  safetyStockByProduct: Record<string, number>;
  productCostMap: Record<string, number>;
  addTransaction: (tx: Omit<Transaction, "id" | "createdAt">) => void;
  addTransactions: (txs: Array<Omit<Transaction, "id" | "createdAt">>) => void;
  setProducts: (rows: ProductMasterRow[]) => void;
  setBaseStock: (baseStock: StockMap, baseStockByProduct?: Record<string, number>) => void;
  dailyStock: StockMap;
  setDailyStock: (dailyStock: StockMap) => void;
  resetAll: () => void;
  refresh: () => void;
  /** 로딩 중 Supabase 대기 없이 로컬(localStorage) 모드로 전환 */
  switchToLocalMode?: () => void;
  useSupabaseInventory: boolean;
  /** Supabase fetch 실패 시 원인 (localStorage 모드일 때만 의미 있음) */
  supabaseFetchStatus: SupabaseFetchStatus;
  supabaseFetchError?: string;
  /** Supabase 데이터 로딩 중 (초기 로드 또는 refresh) */
  isSupabaseLoading?: boolean;
  /** KPI (snapshot 단일 출처) */
  kpiData?: { productCount: number; totalValue: number; totalQuantity: number; totalSku: number };
  /** Supabase 대시보드용 (useSupabaseInventory일 때만) */
  inventoryProducts?: InventoryProduct[];
  inventoryInbound?: InventoryInbound[];
  inventoryOutbound?: InventoryOutbound[];
  stockSnapshot?: StockSnapshotRow[];
  stockByProductByChannel?: { coupang: Record<string, number>; general: Record<string, number> };
  /** 창고별 재고 수량 (테이칼튼, 제이에스 등) */
  stockByWarehouse?: Record<string, number>;
  todayInOutCount?: { inbound: number; outbound: number };
  /** 수요 예측: 제품별 권장 발주량 (부족분만) */
  recommendedOrderByProduct?: Record<string, number>;
  /** 제품별 최근 14일 일평균 출고 (재고 상태 분류용) */
  avg14DayOutboundByProduct?: Record<string, number>;
  /** 제품별 일일 평균 판매량 (최근 30일 출고/30, 보유일수 계산용) */
  dailyVelocityByProduct?: Record<string, number>;
  /** 제품별 일평균 출고 - 쿠팡 채널 판매 기준 */
  dailyVelocityByProductCoupang?: Record<string, number>;
  /** 제품별 일평균 출고 - 일반 채널 판매 기준 */
  dailyVelocityByProductGeneral?: Record<string, number>;
  /** refresh() 성공 시 증가. CategoryTrendChart 등이 이 값 변경 시 재조회 */
  dataRefreshKey?: number;
  /** 통합 새로고침 시 한 번에 로드 (판매·입고 추세) */
  categoryTrendData?: {
    months: string[];
    categories: string[];
    chartData: Record<string, string | number>[];
    momRates: Record<string, Record<string, number | null>>;
    monthlyTotals?: Record<string, { outbound: number; inbound: number; outboundValue?: number; inboundValue?: number; outboundValueCoupang?: number; outboundValueGeneral?: number }>;
    monthlyValueByCategory?: Record<string, Record<string, number>>;
    momIndicators?: {
      outbound: number | null;
      inbound: number | null;
      thisMonthOutbound: number;
      thisMonthInbound: number;
      thisMonthOutboundValue?: number;
      thisMonthInboundValue?: number;
      thisMonthOutboundCoupang?: number;
      thisMonthOutboundGeneral?: number;
      thisMonthInboundByWarehouse?: Record<string, number>;
    };
  } | null;
  /** 통합 새로고침 시 한 번에 로드 (AI 수요 예측) */
  aiForecastByProduct?: Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }>;
  /** 판매·입고 백그라운드 로드 완료 여부 (null=로딩중, true=완료) */
  categoryTrendLoaded?: boolean | null;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

const DEFAULT_STOCK: StockMap = {
  mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0,
};

/** InventoryProduct → ProductMasterRow */
function toProductMasterRow(p: InventoryProduct): ProductMasterRow {
  return {
    code: p.product_code,
    name: p.product_name,
    group: p.category ?? p.group_name,
    subGroup: p.sub_group,
    spec: p.spec,
    unitCost: p.unit_cost,
    packSize: p.pack_size,
  };
}

/** 입고·출고 트랜잭션만으로 카테고리 델타 계산 (기초 재고 제외) */
function applyTransactionsToStockDelta(transactions: Transaction[]): StockMap {
  const delta: StockMap = { ...DEFAULT_STOCK };
  for (const tx of transactions) {
    const sign = tx.type === "in" ? 1 : -1;
    delta[tx.itemId] = (delta[tx.itemId] ?? 0) + sign * tx.quantity;
  }
  return delta;
}

/** 입고·출고 트랜잭션만으로 제품별 델타 계산 (기초 재고 제외) */
function applyTransactionsToProductDelta(transactions: Transaction[]): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const tx of transactions) {
    if (!tx.productCode) continue;
    const sign = tx.type === "in" ? 1 : -1;
    delta[tx.productCode] = (delta[tx.productCode] ?? 0) + sign * tx.quantity;
  }
  return delta;
}

/** 기초 재고 + 입출고 델타 → 최종 재고 */
function computeStock(
  baseStock: StockMap,
  baseStockByProduct: Record<string, number>,
  txDelta: StockMap,
  txProductDelta: Record<string, number>
): { stock: StockMap; stockByProduct: Record<string, number> } {
  const stock: StockMap = { ...DEFAULT_STOCK };
  for (const itemId of Object.keys(DEFAULT_STOCK) as (keyof StockMap)[]) {
    stock[itemId] = (baseStock[itemId] ?? 0) + (txDelta[itemId] ?? 0);
  }
  const allProductCodes = new Set([
    ...Object.keys(baseStockByProduct),
    ...Object.keys(txProductDelta),
  ]);
  const stockByProduct: Record<string, number> = {};
  for (const code of Array.from(allProductCodes)) {
    stockByProduct[code] = (baseStockByProduct[code] ?? 0) + (txProductDelta[code] ?? 0);
  }
  return { stock, stockByProduct };
}

// 전체 기간 출고 합계 → 안전재고 기준 (카테고리 + 제품별), 없으면 20% 적용
function compute2WeekSafetyStock(transactions: Transaction[]): {
  byItem: Record<string, number>;
  byProduct: Record<string, number>;
} {
  const outByItem: Record<string, number> = {};
  const outByProduct: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.type !== "out") continue;
    outByItem[tx.itemId] = (outByItem[tx.itemId] ?? 0) + tx.quantity;
    if (tx.productCode) {
      outByProduct[tx.productCode] = (outByProduct[tx.productCode] ?? 0) + tx.quantity;
    }
  }
  for (const k of Object.keys(outByItem)) {
    outByItem[k] = Math.max(1, Math.ceil(outByItem[k] * 0.2));
  }
  for (const k of Object.keys(outByProduct)) {
    outByProduct[k] = Math.max(1, Math.ceil(outByProduct[k] * 0.2));
  }
  return { byItem: outByItem, byProduct: outByProduct };
}

// 제품 원가 → 품목별 평균 원가 (품목구분 기준)
function computeProductCostMap(products: ProductMasterRow[]): Record<string, number> {
  const byItem: Record<string, number[]> = {};
  for (const p of products) {
    if (p.unitCost == null || p.unitCost <= 0) continue;
    const itemId = mapGroupToItemId(p.group);
    if (!byItem[itemId]) byItem[itemId] = [];
    byItem[itemId].push(p.unitCost);
  }
  const result: Record<string, number> = {};
  for (const [itemId, costs] of Object.entries(byItem)) {
    result[itemId] = Math.round(costs.reduce((a, b) => a + b, 0) / costs.length);
  }
  return result;
}

/** Supabase 강제 모드: env 설정 시 항상 Supabase만 사용, localStorage로 전환 불가 */
const FORCE_SUPABASE = typeof process !== "undefined" && !!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [useSupabaseInventory, setUseSupabaseInventory] = useState(FORCE_SUPABASE);
  const [supabaseFetchStatus, setSupabaseFetchStatus] = useState<SupabaseFetchStatus>("idle");
  const [supabaseFetchError, setSupabaseFetchError] = useState<string | undefined>();
  const [isSupabaseLoading, setIsSupabaseLoading] = useState(true);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [kpiData, setKpiData] = useState<{ productCount: number; totalValue: number; totalQuantity: number; totalSku: number } | null>(null);
  const [supabaseProducts, setSupabaseProducts] = useState<InventoryProduct[]>([]);
  const [supabaseInbound, setSupabaseInbound] = useState<InventoryInbound[]>([]);
  const [supabaseOutbound, setSupabaseOutbound] = useState<InventoryOutbound[]>([]);
  const [supabaseStockSnapshot, setSupabaseStockSnapshot] = useState<StockSnapshotRow[]>([]);
  const [dailyVelocityByProduct, setDailyVelocityByProduct] = useState<Record<string, number>>({});
  const [dailyVelocityByProductCoupang, setDailyVelocityByProductCoupang] = useState<Record<string, number>>({});
  const [dailyVelocityByProductGeneral, setDailyVelocityByProductGeneral] = useState<Record<string, number>>({});
  const [stockByChannelFromApi, setStockByChannelFromApi] = useState<{ coupang: Record<string, number>; general: Record<string, number> }>({ coupang: {}, general: {} });
  const [stockByWarehouse, setStockByWarehouse] = useState<Record<string, number>>({});
  const [categoryTrendData, setCategoryTrendData] = useState<InventoryContextValue["categoryTrendData"]>(null);
  const [categoryTrendLoaded, setCategoryTrendLoaded] = useState<boolean | null>(null);
  const [aiForecastByProduct, setAiForecastByProduct] = useState<Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }>>({});
  const [supabaseSummary, setSupabaseSummary] = useState<{
    stockByProduct: Record<string, number>;
    stockByProductByChannel?: { coupang: Record<string, number>; general: Record<string, number> };
    safetyStockByProduct: Record<string, number>;
    todayInOutCount: { inbound: number; outbound: number };
    recommendedOrderByProduct: Record<string, number>;
    totalValue: number;
    avg60DayOutbound?: Record<string, number>;
  } | null>(null);

  const [baseStock, setBaseStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [baseStockByProduct, setBaseStockByProductState] = useState<Record<string, number>>(
    () => ({})
  );
  const [dailyStock, setDailyStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProductsState] = useState<ProductMasterRow[]>([]);

  const refresh = useCallback(async () => {
    setSupabaseFetchStatus("idle");
    setSupabaseFetchError(undefined);
    setIsSupabaseLoading(true);
    setKpiData(null);
    setCategoryTrendData(null);
    setCategoryTrendLoaded(null);
    setAiForecastByProduct({});

    const timeout = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("요청 시간 초과")), ms)
      );

    try {
      const cacheBust = `_t=${Date.now()}`;
      const opts = { cache: "no-store" as RequestCache, headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" } };

      // 1단계: quick(초고속) → 실패 시 snapshot?lite=1 (각 20초 타임아웃 - 콜드스타트·대용량 대비)
      let snapshotRes: Response | null = null;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 20_000);
      try {
        snapshotRes = await fetch(`/api/inventory/quick?${cacheBust}`, { ...opts, signal: ctrl.signal });
      } catch {
        clearTimeout(tid);
        const ctrl2 = new AbortController();
        const tid2 = setTimeout(() => ctrl2.abort(), 20_000);
        try {
          snapshotRes = await fetch(`/api/inventory/snapshot?lite=1&${cacheBust}`, { ...opts, signal: ctrl2.signal });
        } finally {
          clearTimeout(tid2);
        }
      }
      clearTimeout(tid);

      if (!snapshotRes?.ok) throw new Error(snapshotRes?.statusText ?? "API 오류");
      const data = (await snapshotRes.json()) as {
        items?: Array<{ product_code: string; product_name?: string; quantity: number; pack_size: number; total_price: number; sku: number; category?: string }>;
        productCount?: number;
        totalValue?: number;
        totalQuantity?: number;
        totalSku?: number;
        dailyVelocityByProduct?: Record<string, number>;
        stockByChannel?: { coupang: Record<string, number>; general: Record<string, number> };
        error?: string;
      };

      if (data.error) throw new Error(data.error);
      const items = data.items ?? [];
      if (items.length === 0 && (data.totalValue ?? 0) === 0) {
        setSupabaseFetchStatus("empty_data");
        if (!FORCE_SUPABASE) setUseSupabaseInventory(false);
        setIsSupabaseLoading(false);
        return;
      }

      let summaryProducts: InventoryProduct[] = [];
      try {
        const summaryPromise = fetch(`/api/inventory/summary?${cacheBust}`, opts).then((r) => r.ok ? r.json() : null);
        const summaryData = await Promise.race([
          summaryPromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        if (summaryData?.products) summaryProducts = summaryData.products as InventoryProduct[];
      } catch {
        /* summary 실패해도 snapshot만으로 진행 */
      }

      const today = new Date().toISOString().slice(0, 10);
      const snapshot: StockSnapshotRow[] = items.map((i) => ({
        product_code: i.product_code,
        quantity: i.quantity,
        unit_cost: i.quantity > 0 ? Math.round((i.total_price / i.quantity) * 100) / 100 : 0,
        snapshot_date: today,
      }));

      const codeToSummaryProduct = new Map<string, InventoryProduct>();
      for (const p of summaryProducts) {
        const code = String(p.product_code ?? "").trim();
        if (code) codeToSummaryProduct.set(code, p);
      }

      const seenCodes = new Set<string>();
      const products: InventoryProduct[] = items
        .filter((i) => {
          if (seenCodes.has(i.product_code)) return false;
          seenCodes.add(i.product_code);
          return true;
        })
        .map((i) => {
          const fromSummary = codeToSummaryProduct.get(i.product_code) ?? codeToSummaryProduct.get(String(i.product_code).trim());
          const raw = String(i.category ?? "").trim();
          const validFromApi = raw && raw !== "전체" && raw !== "기타" && !/^\d{10,}$/.test(raw);
          const fromSum = String(fromSummary?.category ?? "").trim();
          const validFromSum = fromSum && fromSum !== "기타" && !/^\d{10,}$/.test(fromSum);
          const cat = validFromApi ? raw : (validFromSum ? fromSum : "생활용품");
          return {
            id: i.product_code,
            product_code: i.product_code,
            product_name: (i.product_name && i.product_name.trim()) ? i.product_name : (fromSummary?.product_name ?? i.product_code),
            group_name: cat,
            category: cat,
            sub_group: fromSummary?.sub_group ?? "",
            spec: fromSummary?.spec ?? "",
            unit_cost: i.quantity > 0 ? i.total_price / i.quantity : (fromSummary?.unit_cost ?? 0),
            pack_size: i.pack_size ?? fromSummary?.pack_size ?? 1,
            sales_channel: "general" as const,
            is_active: fromSummary?.is_active ?? true,
          } satisfies InventoryProduct;
        });
      const stockByProduct: Record<string, number> = {};
      for (const i of items) stockByProduct[i.product_code] = i.quantity;

      setSupabaseProducts(products);
      setSupabaseStockSnapshot(snapshot);
      setDailyVelocityByProduct(data.dailyVelocityByProduct ?? {});
      setStockByChannelFromApi(data.stockByChannel ?? { coupang: {}, general: {} });
      setStockByWarehouse((data as { stockByWarehouse?: Record<string, number> }).stockByWarehouse ?? {});
      setSupabaseSummary(null);
      setUseSupabaseInventory(true);
      setSupabaseFetchStatus("ok");
      setKpiData({
        productCount: data.productCount ?? items.length,
        totalValue: data.totalValue ?? 0,
        totalQuantity: data.totalQuantity ?? 0,
        totalSku: data.totalSku ?? 0,
      });

      // 2단계: inbound/outbound + snapshot + category-trend + forecast + KPI 모두 await (대시보드 완전 갱신)
      const [snapshotApiRes, inventoryRes, categoryTrendRes, forecastRes, kpiRes] = await Promise.all([
        fetch(`/api/inventory/snapshot?${cacheBust}`, opts).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/inventory?${cacheBust}`, opts).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/category-trend?${cacheBust}`, opts).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/forecast?${cacheBust}`, opts).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/inventory/kpi?${cacheBust}`, opts).then((r) => (r.ok ? r.json() : null)),
      ]);

      const fullData = snapshotApiRes as { dailyVelocityByProduct?: Record<string, number>; dailyVelocityByProductCoupang?: Record<string, number>; dailyVelocityByProductGeneral?: Record<string, number>; stockByChannel?: { coupang: Record<string, number>; general: Record<string, number> }; stockByWarehouse?: Record<string, number> } | null;
      if (fullData?.dailyVelocityByProduct) setDailyVelocityByProduct(fullData.dailyVelocityByProduct);
      if (fullData?.dailyVelocityByProductCoupang) setDailyVelocityByProductCoupang(fullData.dailyVelocityByProductCoupang);
      if (fullData?.dailyVelocityByProductGeneral) setDailyVelocityByProductGeneral(fullData.dailyVelocityByProductGeneral);
      if (fullData?.stockByChannel) setStockByChannelFromApi(fullData.stockByChannel);
      if (fullData?.stockByWarehouse) setStockByWarehouse(fullData.stockByWarehouse);

      const invData = inventoryRes as {
        inbound?: InventoryInbound[];
        outbound?: InventoryOutbound[];
        stockSnapshot?: StockSnapshotRow[];
        products?: InventoryProduct[];
      } | null;
      // inventory API가 DB 직접 조회 결과 → stockSnapshot/products/inbound/outbound 모두 반영 (대시보드 완전 갱신)
      if (invData?.stockSnapshot && invData.stockSnapshot.length > 0) {
        setSupabaseStockSnapshot(invData.stockSnapshot);
      }
      if (invData?.products && invData.products.length > 0) {
        setSupabaseProducts(invData.products);
      }
      if (invData?.inbound) setSupabaseInbound(invData.inbound);
      if (invData?.outbound) setSupabaseOutbound(invData.outbound);

      // KPI API가 최신 snapshot_date 기준 단일 출처 → 항상 우선 적용 (데이터 새로고침 시 갱신 보장)
      let kpiDataRes = kpiRes as { productCount?: number; totalValue?: number; totalQuantity?: number; totalSku?: number; error?: string } | null;
      if (!kpiDataRes || kpiDataRes.error) {
        const retry = await fetch(`/api/inventory/kpi?${cacheBust}&retry=1`, opts).then((r) => (r.ok ? r.json() : null));
        kpiDataRes = retry as typeof kpiDataRes;
      }
      if (kpiDataRes && !kpiDataRes.error) {
        setKpiData({
          productCount: kpiDataRes.productCount ?? 0,
          totalValue: kpiDataRes.totalValue ?? 0,
          totalQuantity: kpiDataRes.totalQuantity ?? 0,
          totalSku: kpiDataRes.totalSku ?? 0,
        });
      } else if (invData?.stockSnapshot && invData.stockSnapshot.length > 0) {
        const totalVal = computeTotalValueFromSnapshot(invData.stockSnapshot, invData.products ?? []);
        const qtyByCode: Record<string, number> = {};
        for (const r of invData.stockSnapshot) {
          const code = String(r.product_code ?? "").trim();
          if (!code) continue;
          qtyByCode[code] = (qtyByCode[code] ?? 0) + (r.quantity ?? 0);
        }
        let totalSku = 0;
        for (const code of Object.keys(qtyByCode)) {
          const p = (invData.products ?? []).find((x) => String(x.product_code).trim() === code);
          const pack = Math.max(1, p?.pack_size ?? 1);
          totalSku += Math.floor((qtyByCode[code] ?? 0) / pack);
        }
        setKpiData({
          productCount: Object.keys(qtyByCode).length,
          totalValue: Math.round(totalVal),
          totalQuantity: Object.values(qtyByCode).reduce((a, b) => a + b, 0),
          totalSku,
        });
      }

      let categoryTrend: InventoryContextValue["categoryTrendData"] = null;
      if (categoryTrendRes && typeof categoryTrendRes === "object" && !(categoryTrendRes as { error?: string }).error) {
        categoryTrend = categoryTrendRes as InventoryContextValue["categoryTrendData"];
      }
      let forecastMap: Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }> = {};
      const forecasts = (forecastRes as { product_forecasts?: Array<{ product_code: string; forecast_month1: number; forecast_month2: number; forecast_month3: number }> })?.product_forecasts ?? [];
      for (const row of forecasts) {
        const code = String(row.product_code ?? "").trim();
        if (code) {
          forecastMap[code] = {
            forecast_month1: Number(row.forecast_month1) || 0,
            forecast_month2: Number(row.forecast_month2) || 0,
            forecast_month3: Number(row.forecast_month3) || 0,
          };
          forecastMap[normalizeCode(code) || code] = forecastMap[code];
        }
      }
      setCategoryTrendData(categoryTrend);
      setAiForecastByProduct(forecastMap);
      setCategoryTrendLoaded(true);
      setDataRefreshKey((k) => k + 1);
      setIsSupabaseLoading(false);
      router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const errMsg = /abort|signal is aborted/i.test(raw)
        ? "요청 시간 초과. 잠시 후 새로고침해 주세요."
        : raw;
      setSupabaseFetchStatus("fetch_error");
      setSupabaseFetchError(errMsg);
      if (!FORCE_SUPABASE) {
        setUseSupabaseInventory(false);
        try {
          const defaultWorkspace = getDefaultWorkspaceId();
          const syncCode = getStoredSyncCode();
          if (defaultWorkspace) {
            const r = await fetchDefaultWorkspace();
            if (r.ok && r.data) storage.restoreFromBackup(r.data);
          } else if (syncCode) {
            const r = await fetchFromCloud(syncCode);
            if (r.ok && r.data) storage.restoreFromBackup(r.data);
          }
        } catch {
          /* ignore */
        }
        const tx = storage.loadTransactions();
        const base = storage.loadBaseStock();
        const baseByProduct = storage.loadBaseStockByProduct();
        const daily = storage.loadDailyStock();
        setTransactions(tx);
        setBaseStockState(base);
        setBaseStockByProductState(baseByProduct);
        setDailyStockState(daily);
        setProductsState(storage.loadProducts() as ProductMasterRow[]);
      }
    } finally {
      setIsSupabaseLoading(false);
    }
  }, [router]);

  const switchToLocalMode = useCallback(async () => {
    if (FORCE_SUPABASE) return; // Supabase 강제 모드: 로컬 전환 불가
    setSupabaseFetchStatus("fetch_error");
    setSupabaseFetchError("로컬 모드로 전환됨. Supabase 데이터는 '새로고침'으로 다시 불러올 수 있습니다.");
    setUseSupabaseInventory(false);
    try {
      const defaultWorkspace = getDefaultWorkspaceId();
      const syncCode = getStoredSyncCode();
      if (defaultWorkspace) {
        const r = await fetchDefaultWorkspace();
        if (r.ok && r.data) storage.restoreFromBackup(r.data);
      } else if (syncCode) {
        const r = await fetchFromCloud(syncCode);
        if (r.ok && r.data) storage.restoreFromBackup(r.data);
      }
    } catch {
      /* ignore */
    }
    const tx = storage.loadTransactions();
    const base = storage.loadBaseStock();
    const baseByProduct = storage.loadBaseStockByProduct();
    const daily = storage.loadDailyStock();
    setTransactions(tx);
    setBaseStockState(base);
    setBaseStockByProductState(baseByProduct);
    setProductsState(storage.loadProducts() as ProductMasterRow[]);
    setIsSupabaseLoading(false);
  }, []);

  useEffect(() => {
    if (supabaseFetchStatus !== "idle") setIsSupabaseLoading(false);
  }, [supabaseFetchStatus]);

  // 로딩 10초 초과 시 강제 해제 (fetch가 응답하지 않을 때)
  useEffect(() => {
    if (!isSupabaseLoading || supabaseFetchStatus !== "idle") return;
    const t = setTimeout(() => {
      setSupabaseFetchStatus("fetch_error");
      setSupabaseFetchError("요청 시간 초과 (10초). Supabase 연결·테이블 확인 후 새로고침하세요.");
      setIsSupabaseLoading(false);
    }, 10_000);
    return () => clearTimeout(t);
  }, [isSupabaseLoading, supabaseFetchStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Supabase inventory 사용 시: localStorage sync 비활성화
  useEffect(() => {
    if (useSupabaseInventory) return;
    const defaultWorkspace = getDefaultWorkspaceId();
    const syncCode = getStoredSyncCode();
    const targetCode = defaultWorkspace ?? syncCode;
    if (!targetCode) return;

    const hasData =
      transactions.length > 0 ||
      products.length > 0 ||
      Object.values(baseStock).some((v) => v > 0) ||
      Object.values(dailyStock).some((v) => v > 0);
    if (!hasData) return;

    const t = setTimeout(() => {
      const json = storage.exportBackup();
      if (defaultWorkspace) {
        pushDefaultWorkspace(json).catch(() => {});
      } else {
        pushToCloud(syncCode!, json).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [useSupabaseInventory, transactions, baseStock, baseStockByProduct, dailyStock, products]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (useSupabaseInventory) return;
      if (
        e.key === STORAGE_KEYS.transactions ||
        e.key === STORAGE_KEYS.products ||
        e.key === STORAGE_KEYS.baseStock ||
        e.key === STORAGE_KEYS.baseStockByProduct ||
        e.key === STORAGE_KEYS.dailyStock
      ) {
        refresh();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [refresh, useSupabaseInventory]);

  // Supabase 강제 모드: 탭 복귀 시 자동 새로고침 (Supabase에서 직접 수정 후 돌아올 때 반영)
  useEffect(() => {
    if (!FORCE_SUPABASE) return;
    let hiddenAt = 0;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState === "visible" && hiddenAt > 0 && Date.now() - hiddenAt > 1500) {
        refresh();
        hiddenAt = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  // Supabase Realtime 구독: INSERT/UPDATE/DELETE 시 refresh (디바운스로 연속 갱신 방지)
  useEffect(() => {
    if (!FORCE_SUPABASE) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refresh();
      }, 500);
    };

    const supabase = createClient(url, key);
    const channel = supabase
      .channel("inventory-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_stock_snapshot",
        },
        debouncedRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_inbound",
        },
        debouncedRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_outbound",
        },
        debouncedRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_products",
        },
        debouncedRefresh
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[Realtime] inventory 테이블 구독 시작");
        } else if (status === "CHANNEL_ERROR") {
          console.warn("[Realtime] 구독 오류 - Replication 설정 확인");
        }
      });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const addTransaction = useCallback(
    (tx: Omit<Transaction, "id" | "createdAt">) => {
      const newTx: Transaction = {
        ...tx,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      setTransactions((prev) => {
        const next = [newTx, ...prev];
        if (!useSupabaseInventory) storage.saveTransactions(next);
        return next;
      });
    },
    [useSupabaseInventory]
  );

  const addTransactions = useCallback(
    (txs: Array<Omit<Transaction, "id" | "createdAt">>) => {
      if (txs.length === 0) return;
      const now = Date.now();
      const batch: Transaction[] = txs.map((tx, idx) => ({
        ...tx,
        id: crypto.randomUUID(),
        createdAt: now + idx,
      }));
      setTransactions((prev) => {
        const next = [...batch, ...prev];
        if (!useSupabaseInventory) storage.saveTransactions(next);
        return next;
      });
    },
    [useSupabaseInventory]
  );

  const setBaseStock = useCallback(
    (base: StockMap, baseByProduct?: Record<string, number>) => {
      setBaseStockState(base);
      if (baseByProduct !== undefined) {
        setBaseStockByProductState(baseByProduct);
        if (!useSupabaseInventory) storage.saveBaseStockByProduct(baseByProduct);
      }
      if (!useSupabaseInventory) storage.saveBaseStock(base);
    },
    [useSupabaseInventory]
  );

  const setProducts = useCallback((rows: ProductMasterRow[]) => {
    setProductsState(rows);
    if (!useSupabaseInventory) storage.saveProducts(rows);
  }, [useSupabaseInventory]);

  const setDailyStock = useCallback((daily: StockMap) => {
    setDailyStockState(daily);
    storage.saveDailyStock(daily);
  }, []);

  const resetAll = useCallback(() => {
    if (!useSupabaseInventory) storage.resetAll();
    setTransactions([]);
    setBaseStockState({ ...DEFAULT_STOCK });
    setBaseStockByProductState({});
    setDailyStockState({ ...DEFAULT_STOCK });
    setProductsState([]);
  }, [useSupabaseInventory]);

  // Supabase: [직관적 데이터 우선] 스냅샷만 사용. 과거 입출고로 현재 재고 계산하지 않음.
  const supabaseDerived = useMemo(() => {
    if (!useSupabaseInventory) return null;
    const hasSnapshot = supabaseStockSnapshot.length > 0;
    const stockByProduct = hasSnapshot
      ? getStockFromSnapshot(supabaseStockSnapshot)
      : {};
    const stock = computeStockByCategory(stockByProduct, supabaseProducts);
    const totalValue = hasSnapshot
      ? computeTotalValueFromSnapshot(supabaseStockSnapshot, supabaseProducts)
      : 0;
    const lastMonthEndValue = 0;
    const valueVariance = 0;
    const transactions = toTransactions(
      supabaseInbound,
      supabaseOutbound,
      supabaseProducts
    );
    const products = supabaseProducts.map(toProductMasterRow);
    const costsByItem: Record<string, number[]> = {};
    for (const p of supabaseProducts) {
      if (p.unit_cost == null || p.unit_cost <= 0) continue;
      const itemId = mapGroupToItemId(p.category ?? p.group_name);
      if (!costsByItem[itemId]) costsByItem[itemId] = [];
      costsByItem[itemId].push(p.unit_cost);
    }
    const productCostMap: Record<string, number> = {};
    for (const [itemId, costs] of Object.entries(costsByItem)) {
      productCostMap[itemId] = Math.round(
        costs.reduce((a, b) => a + b, 0) / costs.length
      );
    }
    const safetyByProduct = computeSafetyStockByProduct(supabaseOutbound, supabaseProducts);
    const safetyStockMap = (() => {
      const byItem: Record<string, number> = {};
      for (const p of supabaseProducts) {
        const itemId = mapGroupToItemId(p.category ?? p.group_name);
        const v = safetyByProduct[p.product_code] ?? safetyByProduct[normalizeCode(p.product_code)] ?? 0;
        byItem[itemId] = (byItem[itemId] ?? 0) + v;
      }
      return byItem;
    })();
    const { inByItem, outByItem } = computeInOutByItem(transactions);
    const stockByProductByChannel = hasSnapshot && stockByChannelFromApi.coupang && Object.keys(stockByChannelFromApi.coupang).length + Object.keys(stockByChannelFromApi.general).length > 0
      ? stockByChannelFromApi
      : hasSnapshot
        ? { coupang: {} as Record<string, number>, general: { ...stockByProduct } }
        : { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
    const todayInOutCount = getTodayInOutCount(supabaseInbound, supabaseOutbound);
    const avg14DayOutbound = computeAvgNDayOutboundByProduct(supabaseOutbound, 14);
    const recommendedOrderByProduct = computeRecommendedOrderByProduct(
      stockByProduct,
      avg14DayOutbound,
      supabaseProducts,
      safetyByProduct
    );

    return {
      stock,
      stockByProduct,
      transactions,
      products,
      totalValue,
      lastMonthEndValue,
      valueVariance,
      productCostMap,
      safetyStockMap,
      safetyStockByProduct: safetyByProduct,
      inByItem,
      outByItem,
      stockByProductByChannel,
      todayInOutCount,
      recommendedOrderByProduct,
      avg14DayOutboundByProduct: avg14DayOutbound,
    };
  }, [
    useSupabaseInventory,
    supabaseProducts,
    supabaseInbound,
    supabaseOutbound,
    supabaseStockSnapshot,
    stockByChannelFromApi,
  ]);

  // localStorage 사용 시: 기존 로직
  const localDerived = useMemo(() => {
    if (useSupabaseInventory) return null;
    const txDelta = applyTransactionsToStockDelta(transactions);
    const txProductDelta = applyTransactionsToProductDelta(transactions);
    const { stock, stockByProduct } = computeStock(
      baseStock,
      baseStockByProduct,
      txDelta,
      txProductDelta
    );
    const productCostMap = computeProductCostMap(products);
    const { byItem: safetyStockMap, byProduct: safetyStockByProduct } =
      compute2WeekSafetyStock(transactions);
    const { getTotalValue } = require("@/lib/store");
    const totalValueLocal = getTotalValue(stock, productCostMap);

    return {
      stock,
      stockByProduct,
      transactions,
      products,
      totalValue: totalValueLocal,
      lastMonthEndValue: undefined,
      valueVariance: undefined,
      productCostMap,
      safetyStockMap,
      safetyStockByProduct,
    };
  }, [
    useSupabaseInventory,
    baseStock,
    baseStockByProduct,
    transactions,
    products,
  ]);

  const effective = useSupabaseInventory ? supabaseDerived : localDerived;
  const stock = effective?.stock ?? DEFAULT_STOCK;
  const stockByProduct = effective?.stockByProduct ?? {};
  const displayTransactions = effective?.transactions ?? transactions;
  const displayProducts = effective?.products ?? products;
  const totalValue = useSupabaseInventory && kpiData
    ? kpiData.totalValue
    : (effective?.totalValue ?? 0);
  const lastMonthEndValue = effective?.lastMonthEndValue;
  const valueVariance = effective?.valueVariance;
  const productCostMap = effective?.productCostMap ?? {};
  const safetyStockMap = effective?.safetyStockMap ?? {};
  const safetyStockByProduct = effective?.safetyStockByProduct ?? {};

  useEffect(() => {
    if (!useSupabaseInventory) storage.saveStock(stock);
  }, [useSupabaseInventory, stock]);

  const shortageItems = useMemo(
    () => getShortageItems(stock, safetyStockMap),
    [stock, safetyStockMap]
  );

  // BaseStockAndDailyStock: Supabase 사용 시 baseStock=0, in/out은 transactions에서
  const baseStockForDisplay = useSupabaseInventory ? DEFAULT_STOCK : baseStock;
  const inOutByItem = useMemo(() => {
    if (useSupabaseInventory && supabaseDerived) {
      return {
        inByItem: supabaseDerived.inByItem!,
        outByItem: supabaseDerived.outByItem!,
      };
    }
    const inBy: Record<string, number> = {};
    const outBy: Record<string, number> = {};
    for (const item of ["mask", "capsule", "fabric", "liquid", "living"] as const) {
      inBy[item] = 0;
      outBy[item] = 0;
    }
    for (const tx of transactions) {
      if (tx.type === "in") inBy[tx.itemId] = (inBy[tx.itemId] ?? 0) + tx.quantity;
      else outBy[tx.itemId] = (outBy[tx.itemId] ?? 0) + tx.quantity;
    }
    return { inByItem: inBy, outByItem: outBy };
  }, [useSupabaseInventory, supabaseDerived, transactions]);

  const value = useMemo(
    () => ({
      stock,
      stockByProduct,
      baseStock: baseStockForDisplay,
      transactions: displayTransactions,
      products: displayProducts,
      totalValue,
      lastMonthEndValue,
      valueVariance,
      shortageItems,
      safetyStockMap,
      safetyStockByProduct,
      productCostMap,
      addTransaction,
      addTransactions,
      setProducts,
      setBaseStock,
      dailyStock,
      setDailyStock,
      resetAll,
      refresh,
      switchToLocalMode,
      useSupabaseInventory,
      supabaseFetchStatus,
      supabaseFetchError,
      isSupabaseLoading,
      kpiData: kpiData ?? undefined,
      inventoryProducts: useSupabaseInventory ? supabaseProducts : undefined,
      inventoryInbound: useSupabaseInventory ? supabaseInbound : undefined,
      inventoryOutbound: useSupabaseInventory ? supabaseOutbound : undefined,
      stockSnapshot: useSupabaseInventory ? supabaseStockSnapshot : undefined,
      stockByProductByChannel: supabaseDerived?.stockByProductByChannel,
      stockByWarehouse: useSupabaseInventory ? stockByWarehouse : undefined,
      todayInOutCount: supabaseDerived?.todayInOutCount,
      recommendedOrderByProduct: supabaseDerived?.recommendedOrderByProduct,
      avg14DayOutboundByProduct: supabaseDerived?.avg14DayOutboundByProduct ?? {},
      dailyVelocityByProduct: useSupabaseInventory ? dailyVelocityByProduct : undefined,
      dailyVelocityByProductCoupang: useSupabaseInventory ? dailyVelocityByProductCoupang : undefined,
      dailyVelocityByProductGeneral: useSupabaseInventory ? dailyVelocityByProductGeneral : undefined,
      dataRefreshKey,
      categoryTrendData: useSupabaseInventory ? categoryTrendData : null,
      aiForecastByProduct: useSupabaseInventory ? aiForecastByProduct : undefined,
      categoryTrendLoaded: useSupabaseInventory ? categoryTrendLoaded : null,
    }),
    [
      stock,
      stockByProduct,
      baseStockForDisplay,
      displayTransactions,
      displayProducts,
      totalValue,
      lastMonthEndValue,
      valueVariance,
      shortageItems,
      safetyStockMap,
      safetyStockByProduct,
      productCostMap,
      addTransaction,
      addTransactions,
      setProducts,
      setBaseStock,
      dailyStock,
      setDailyStock,
      resetAll,
      refresh,
      switchToLocalMode,
      useSupabaseInventory,
      supabaseFetchStatus,
      supabaseFetchError,
      isSupabaseLoading,
      kpiData,
      supabaseProducts,
      supabaseInbound,
      supabaseOutbound,
      supabaseStockSnapshot,
      supabaseDerived?.stockByProductByChannel,
      stockByWarehouse,
      supabaseDerived?.todayInOutCount,
      supabaseDerived?.recommendedOrderByProduct,
      supabaseDerived?.avg14DayOutboundByProduct,
      dailyVelocityByProduct,
      dailyVelocityByProductCoupang,
      dailyVelocityByProductGeneral,
      dataRefreshKey,
      categoryTrendData,
      aiForecastByProduct,
      categoryTrendLoaded,
    ]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error("useInventory must be used within InventoryProvider");
  return ctx;
}
