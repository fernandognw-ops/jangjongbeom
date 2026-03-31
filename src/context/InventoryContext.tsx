"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

/** `/api/inventory/summary` → dashboard-aggregate에서 내려오는 요약(오늘 수불 등) */
type SupabaseSummaryState = {
  stockByProduct: Record<string, number>;
  stockByProductByChannel?: { coupang: Record<string, number>; general: Record<string, number> };
  safetyStockByProduct: Record<string, number>;
  todayInOutCount: { inbound: number; outbound: number };
  recommendedOrderByProduct: Record<string, number>;
  totalValue: number;
  avg60DayOutbound?: Record<string, number>;
};

function asRecord(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  return obj as Record<string, unknown>;
}

function summaryFromDashboardApi(raw: unknown): SupabaseSummaryState | null {
  const s = asRecord(raw);
  if (!s) return null;
  if (typeof s.error === "string" && s.error.length > 0) return null;
  const tio = asRecord(s.todayInOutCount);
  const sp = asRecord(s.stockByProduct);
  const ss = asRecord(s.safetyStockByProduct);
  const ro = asRecord(s.recommendedOrderByProduct);
  const ch = asRecord(s.stockByProductByChannel);
  const avg = asRecord(s.avg60DayOutbound ?? s.avg30DayOutbound);

  const coupang = asRecord(ch?.coupang);
  const general = asRecord(ch?.general);

  const todayInOutCount = {
    inbound: Math.max(0, Math.trunc(Number(tio?.inbound) || 0)),
    outbound: Math.max(0, Math.trunc(Number(tio?.outbound) || 0)),
  };

  const stockByProduct: Record<string, number> = {};
  if (sp) {
    for (const [k, v] of Object.entries(sp)) {
      stockByProduct[k] = Number(v) || 0;
    }
  }

  const safetyStockByProduct: Record<string, number> = {};
  if (ss) {
    for (const [k, v] of Object.entries(ss)) {
      safetyStockByProduct[k] = Number(v) || 0;
    }
  }

  const recommendedOrderByProduct: Record<string, number> = {};
  if (ro) {
    for (const [k, v] of Object.entries(ro)) {
      recommendedOrderByProduct[k] = Number(v) || 0;
    }
  }

  const avg60DayOutbound: Record<string, number> = {};
  if (avg) {
    for (const [k, v] of Object.entries(avg)) {
      avg60DayOutbound[k] = Number(v) || 0;
    }
  }

  let stockByProductByChannel: SupabaseSummaryState["stockByProductByChannel"];
  if (coupang || general) {
    stockByProductByChannel = { coupang: {}, general: {} };
    if (coupang) {
      for (const [k, v] of Object.entries(coupang)) {
        stockByProductByChannel.coupang[k] = Number(v) || 0;
      }
    }
    if (general) {
      for (const [k, v] of Object.entries(general)) {
        stockByProductByChannel.general[k] = Number(v) || 0;
      }
    }
  }

  return {
    stockByProduct,
    ...(stockByProductByChannel ? { stockByProductByChannel } : {}),
    safetyStockByProduct,
    todayInOutCount,
    recommendedOrderByProduct,
    totalValue: Math.max(0, Number(s.totalValue) || 0),
    ...(Object.keys(avg60DayOutbound).length > 0 ? { avg60DayOutbound } : {}),
  };
}

export type SupabaseFetchStatus =
  | "idle"
  | "ok"
  | "success"
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
  /** Supabase 단일 출처 모드: 로컬 모드 복원 비활성화 */
  supabaseSingleSource?: boolean;
  useSupabaseInventory: boolean;
  /** Supabase fetch 실패 시 원인 (localStorage 모드일 때만 의미 있음) */
  supabaseFetchStatus: SupabaseFetchStatus;
  supabaseFetchError?: string;
  /** 데이터는 렌더 가능하지만 일부 API에서 발생한 비차단 경고 */
  supabaseNonBlockingError?: string;
  /** Supabase 데이터 로딩 중 (초기 로드 또는 refresh) */
  isSupabaseLoading?: boolean;
  /** category-trend와 무관한 재고 코어 데이터(snapshot/summary) 존재 여부 */
  hasSupabaseCoreData?: boolean;
  /** KPI (snapshot 단일 출처) */
  kpiData?: { productCount: number; totalValue: number; totalQuantity: number; totalSku: number };
  /** Supabase 대시보드용 (useSupabaseInventory일 때만) */
  inventoryProducts?: InventoryProduct[];
  inventoryInbound?: InventoryInbound[];
  inventoryOutbound?: InventoryOutbound[];
  stockSnapshot?: StockSnapshotRow[];
  stockByProductByChannel?: { coupang: Record<string, number>; general: Record<string, number> };
  /** 판매채널별 재고 수량 — `channelForSnapshotRow`(sales_channel 우선) → `"쿠팡"` | `"일반"` */
  channelTotals?: Record<string, number>;
  /** @deprecated channelTotals와 동일 (호환용) */
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
    /** 마스터 5개(차트 축에 출고_미분류가 붙기 전) */
    chartCategoriesMaster?: string[];
    chartUncategorizedOutboundLabel?: string | null;
    chartData: Record<string, string | number>[];
    sourceTablesEmpty?: boolean;
    rowCounts?: { inbound: number; outbound: number; snapshot: number };
    momRates: Record<string, Record<string, number | null>>;
    monthlyTotals?: Record<string, { outbound: number; inbound: number; inboundValue?: number; outboundValueCoupang?: number; outboundValueGeneral?: number }>;
    monthlyValueByCategory?: Record<string, Record<string, number>>;
    momIndicators?: {
      outbound: number | null;
      inbound: number | null;
      kpiMonthKey?: string | null;
      kpiMonthKeyOutbound?: string | null;
      kpiMonthKeyInbound?: string | null;
      prevKpiMonthKey?: string | null;
      thisMonthOutbound: number;
      thisMonthInbound: number;
      thisMonthOutboundValue?: number;
      thisMonthInboundValue?: number;
      thisMonthOutboundCoupang?: number;
      thisMonthOutboundGeneral?: number;
      thisMonthInboundByChannel?: Record<string, number>;
      /** @deprecated API 구버전 — thisMonthInboundByChannel 사용 */
      thisMonthInboundByWarehouse?: Record<string, number>;
    };
  } | null;
  /** 통합 새로고침 시 한 번에 로드 (AI 수요 예측) */
  aiForecastByProduct?: Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }>;
  /** AI 예측보고 당월 예측 (카테고리별 forecast_this_month) - CategoryTrendChart 당월 표시용 */
  categoryForecastThisMonth?: { thisMonthKey: string; byCategory: Record<string, number> };
  /** 판매·입고 백그라운드 로드 완료 여부 (null=로딩중, true=완료) */
  categoryTrendLoaded?: boolean | null;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

const DEFAULT_STOCK: StockMap = {
  mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0,
};

const EMPTY_CATEGORY_TREND: NonNullable<InventoryContextValue["categoryTrendData"]> = {
  months: [],
  categories: [],
  chartData: [],
  momRates: {},
  monthlyTotals: {},
  momIndicators: {
    outbound: null,
    inbound: null,
    kpiMonthKey: null,
    kpiMonthKeyOutbound: null,
    kpiMonthKeyInbound: null,
    prevKpiMonthKey: null,
    thisMonthOutbound: 0,
    thisMonthInbound: 0,
    thisMonthOutboundValue: 0,
    thisMonthInboundValue: 0,
    thisMonthOutboundCoupang: 0,
    thisMonthOutboundGeneral: 0,
    thisMonthInboundByChannel: {},
  },
  sourceTablesEmpty: true,
  rowCounts: { inbound: 0, outbound: 0, snapshot: 0 },
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

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [useSupabaseInventory, setUseSupabaseInventory] = useState(false);
  const [supabaseFetchStatus, setSupabaseFetchStatus] = useState<SupabaseFetchStatus>("idle");
  const [supabaseFetchError, setSupabaseFetchError] = useState<string | undefined>();
  const [supabaseNonBlockingError, setSupabaseNonBlockingError] = useState<string | undefined>();
  const [isSupabaseLoading, setIsSupabaseLoading] = useState(true);
  const [hasSupabaseCoreData, setHasSupabaseCoreData] = useState(false);
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
  const [channelTotals, setChannelTotals] = useState<Record<string, number>>({});
  const [categoryTrendData, setCategoryTrendData] = useState<InventoryContextValue["categoryTrendData"]>(EMPTY_CATEGORY_TREND);
  const [categoryTrendLoaded, setCategoryTrendLoaded] = useState<boolean | null>(null);
  const [aiForecastByProduct, setAiForecastByProduct] = useState<Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }>>({});
  const [categoryForecastThisMonth, setCategoryForecastThisMonth] = useState<{ thisMonthKey: string; byCategory: Record<string, number> } | undefined>(undefined);
  /** refresh 1단계 quick 응답의 channelTotals — 2단계 snapshot 덮어쓰기 시 비교용 */
  const quickChannelTotalsRef = useRef<Record<string, number> | null>(null);
  /** 동시 refresh 시 늦게 도착한 응답이 최신 상태를 덮어쓰지 않도록 */
  const refreshGenerationRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const [supabaseSummary, setSupabaseSummary] = useState<SupabaseSummaryState | null>(null);

  const [baseStock, setBaseStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [baseStockByProduct, setBaseStockByProductState] = useState<Record<string, number>>(
    () => ({})
  );
  const [dailyStock, setDailyStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProductsState] = useState<ProductMasterRow[]>([]);

  const refresh = useCallback(async () => {
    refreshGenerationRef.current += 1;
    const generation = refreshGenerationRef.current;
    refreshAbortRef.current?.abort();
    const ac = new AbortController();
    refreshAbortRef.current = ac;
    setIsSupabaseLoading(true);

    const delayNull = (ms: number) =>
      new Promise<null>((r) => setTimeout(() => r(null), ms));

    type RefreshApply = {
      supabaseFetchStatus: SupabaseFetchStatus;
      supabaseFetchError?: string;
      supabaseNonBlockingError?: string;
      useSupabaseInventory: boolean;
      hasSupabaseCoreData: boolean;
      baseStock: StockMap;
      baseStockByProduct: Record<string, number>;
      transactions: Transaction[];
      dailyStock: StockMap;
      products: ProductMasterRow[];
      supabaseProducts: InventoryProduct[];
      supabaseInbound: InventoryInbound[];
      supabaseOutbound: InventoryOutbound[];
      supabaseStockSnapshot: StockSnapshotRow[];
      dailyVelocityByProduct: Record<string, number>;
      dailyVelocityByProductCoupang: Record<string, number>;
      dailyVelocityByProductGeneral: Record<string, number>;
      stockByChannelFromApi: { coupang: Record<string, number>; general: Record<string, number> };
      channelTotals: Record<string, number>;
      kpiData: { productCount: number; totalValue: number; totalQuantity: number; totalSku: number };
      supabaseSummary: SupabaseSummaryState | null;
      categoryTrendData: NonNullable<InventoryContextValue["categoryTrendData"]>;
      categoryTrendLoaded: boolean;
      aiForecastByProduct: Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }>;
      categoryForecastThisMonth: { thisMonthKey: string; byCategory: Record<string, number> } | undefined;
      dataRefreshIncrement: boolean;
      quickChannelTotals: Record<string, number> | null;
    };

    const baseApply = (status: SupabaseFetchStatus, err?: string): RefreshApply => ({
      supabaseFetchStatus: status,
      supabaseFetchError: err,
      supabaseNonBlockingError: undefined,
      useSupabaseInventory: true,
      hasSupabaseCoreData: false,
      baseStock: { ...DEFAULT_STOCK },
      baseStockByProduct: {},
      transactions: [],
      dailyStock: { ...DEFAULT_STOCK },
      products: [],
      supabaseProducts: [],
      supabaseInbound: [],
      supabaseOutbound: [],
      supabaseStockSnapshot: [],
      dailyVelocityByProduct: {},
      dailyVelocityByProductCoupang: {},
      dailyVelocityByProductGeneral: {},
      stockByChannelFromApi: { coupang: {}, general: {} },
      channelTotals: {},
      kpiData: { productCount: 0, totalValue: 0, totalQuantity: 0, totalSku: 0 },
      supabaseSummary: null,
      categoryTrendData: EMPTY_CATEGORY_TREND,
      categoryTrendLoaded: true,
      aiForecastByProduct: {},
      categoryForecastThisMonth: undefined,
      dataRefreshIncrement: false,
      quickChannelTotals: null,
    });

    let applyResult: RefreshApply = baseApply("fetch_error", "알 수 없는 오류로 대시보드를 불러오지 못했습니다.");
    let setStateSnapshot: Record<string, unknown> = EMPTY_CATEGORY_TREND;
    let setStateSummary: Record<string, unknown> = EMPTY_CATEGORY_TREND;

    try {
      const cacheBust = `_t=${Date.now()}`;
      const opts = {
        cache: "no-store" as RequestCache,
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        signal: ac.signal,
      };
      const unifiedRes = await Promise.race([
        fetch(`/api/inventory/dashboard-aggregate?${cacheBust}`, opts).catch((e) => {
          if (e instanceof Error && e.name === "AbortError") return null;
          console.error("[InventoryContext] dashboard-aggregate fetch failed", e);
          return null;
        }),
        delayNull(60_000),
      ]);

      const unified = unifiedRes
        ? ((await unifiedRes.json().catch(() => null)) as
            | {
                snapshot?: any;
                summary?: any;
                inventoryData?: any;
                categoryTrend?: InventoryContextValue["categoryTrendData"] | null;
                forecast?: any;
                error?: string;
              }
            | null)
        : null;

      if (!unifiedRes) {
        const msg = "대시보드 연합 API 응답 없음(시간 초과 또는 네트워크 오류).";
        console.error("[InventoryContext] dashboard-aggregate:", msg);
        applyResult = baseApply("fetch_error", msg);
      } else if (!unifiedRes.ok) {
        const msg = `대시보드 데이터 요청 실패 (${unifiedRes.status}${unifiedRes.statusText ? ` ${unifiedRes.statusText}` : ""}).`;
        console.error("[InventoryContext] dashboard-aggregate HTTP", unifiedRes.status, unifiedRes.statusText, unified);
        applyResult = baseApply("fetch_error", msg);
      } else if (unified == null) {
        const msg = "대시보드 응답을 해석할 수 없습니다.";
        console.error("[InventoryContext] dashboard-aggregate:", msg);
        applyResult = baseApply("fetch_error", msg);
      } else {
        const normalizedState = {
          snapshot: {
            items: Array.isArray(unified?.snapshot?.items) ? unified.snapshot.items : [],
            totalValue: Number(unified?.snapshot?.totalValue ?? 0) || 0,
            productCount: Number(unified?.snapshot?.productCount ?? 0) || 0,
            totalQuantity: Number(unified?.snapshot?.totalQuantity ?? 0) || 0,
            totalSku: Number(unified?.snapshot?.totalSku ?? 0) || 0,
            dailyVelocityByProduct:
              unified?.snapshot?.dailyVelocityByProduct && typeof unified.snapshot.dailyVelocityByProduct === "object"
                ? unified.snapshot.dailyVelocityByProduct
                : {},
            dailyVelocityByProductCoupang:
              unified?.snapshot?.dailyVelocityByProductCoupang &&
              typeof unified.snapshot.dailyVelocityByProductCoupang === "object"
                ? unified.snapshot.dailyVelocityByProductCoupang
                : {},
            dailyVelocityByProductGeneral:
              unified?.snapshot?.dailyVelocityByProductGeneral &&
              typeof unified.snapshot.dailyVelocityByProductGeneral === "object"
                ? unified.snapshot.dailyVelocityByProductGeneral
                : {},
            stockByChannel:
              unified?.snapshot?.stockByChannel && typeof unified.snapshot.stockByChannel === "object"
                ? unified.snapshot.stockByChannel
                : { coupang: {}, general: {} },
            channelTotals:
              unified?.snapshot?.channelTotals && typeof unified.snapshot.channelTotals === "object"
                ? unified.snapshot.channelTotals
                : {},
            error: typeof unified?.snapshot?.error === "string" ? unified.snapshot.error : "",
          },
          summary: {
            items: Array.isArray(unified?.summary?.items) ? unified.summary.items : [],
            totalValue: Number(unified?.summary?.totalValue ?? 0) || 0,
            productCount: Number(unified?.summary?.productCount ?? 0) || 0,
            products: Array.isArray(unified?.summary?.products) ? unified.summary.products : [],
            stockSnapshot: Array.isArray(unified?.summary?.stockSnapshot) ? unified.summary.stockSnapshot : [],
            error: typeof unified?.summary?.error === "string" ? unified.summary.error : "",
          },
          inventoryData: Array.isArray(unified?.inventoryData) ? unified.inventoryData : [],
        };
        const inventoryDataSafe = {
          products: Array.isArray((unified?.inventoryData as Record<string, unknown> | null)?.products)
            ? ((unified?.inventoryData as Record<string, unknown>).products as unknown[])
            : [],
          outbound: Array.isArray((unified?.inventoryData as Record<string, unknown> | null)?.outbound)
            ? ((unified?.inventoryData as Record<string, unknown>).outbound as unknown[])
            : [],
          inbound: Array.isArray((unified?.inventoryData as Record<string, unknown> | null)?.inbound)
            ? ((unified?.inventoryData as Record<string, unknown>).inbound as unknown[])
            : [],
        };
        const snapshot = normalizedState.snapshot;
        const summary = normalizedState.summary;
        const inventoryData = normalizedState.inventoryData;
        const categoryTrend =
          (unified?.categoryTrend as NonNullable<InventoryContextValue["categoryTrendData"]> | null) ?? EMPTY_CATEGORY_TREND;
        const forecastJson = unified?.forecast ?? null;
        const aggregateError = typeof unified?.error === "string" ? unified.error : "";

        setStateSnapshot = snapshot as Record<string, unknown>;
        setStateSummary = summary as Record<string, unknown>;

        const items = (snapshot.items ?? []) as Array<{ product_code: string; product_name?: string; quantity: number; pack_size: number; total_price: number; sku: number; category?: string }>;
        const totalVal = snapshot.totalValue ?? 0;
        const summaryProducts = (summary.products ?? []) as InventoryProduct[];
        const summaryStockSnapshot = (summary.stockSnapshot ?? []) as StockSnapshotRow[];
        const hasSnapshotData =
          items.length > 0 ||
          Number(snapshot.productCount ?? 0) > 0 ||
          Number(snapshot.totalValue ?? 0) > 0;
        const hasSummaryData =
          summaryProducts.length > 0 ||
          summaryStockSnapshot.length > 0 ||
          Number(summary.productCount ?? 0) > 0 ||
          Number(summary.totalValue ?? 0) > 0;
        const hasInventoryData =
          inventoryData.length > 0 ||
          inventoryDataSafe.outbound.length > 0 ||
          inventoryDataSafe.inbound.length > 0 ||
          inventoryDataSafe.products.length > 0;
        const hasCoreInventoryData = hasSnapshotData || hasSummaryData || hasInventoryData;
        const isEmpty = !hasCoreInventoryData && items.length === 0 && totalVal === 0;
        const isNoSnapshot = snapshot.error === "no_snapshot";

        if (isEmpty || (isNoSnapshot && !hasSummaryData && !hasInventoryData)) {
          applyResult = {
            ...baseApply("empty_data"),
            categoryTrendData: categoryTrend,
          };
        } else {
          const fallbackProductsFromSnapshot: InventoryProduct[] = items.map((it) => ({
            id: String(it.product_code ?? ""),
            product_code: String(it.product_code ?? ""),
            product_name: String(it.product_name ?? it.product_code ?? ""),
            category: String(it.category ?? "생활용품"),
            unit_cost: 0,
            pack_size: Math.max(1, Number(it.pack_size ?? 1) || 1),
            is_active: true,
            sales_channel: "general",
          })) as InventoryProduct[];
          const fallbackProductsFromInventoryData: InventoryProduct[] = [
            ...inventoryDataSafe.products,
            ...inventoryDataSafe.outbound,
            ...inventoryDataSafe.inbound,
          ]
            .map((row: unknown) => {
              const r = row as Record<string, unknown>;
              const product_code = String(r.product_code ?? "").trim();
              if (!product_code) return null;
              return {
                id: product_code,
                product_code,
                product_name: String(r.product_name ?? product_code),
                category: String(r.category ?? "생활용품"),
                unit_cost: Number(r.unit_cost ?? 0),
                pack_size: Math.max(1, Number(r.pack_size ?? 1) || 1),
                is_active: true,
                sales_channel: "general",
              } as InventoryProduct;
            })
            .filter((v): v is InventoryProduct => !!v);
          const productsSource =
            summaryProducts.length > 0
              ? summaryProducts
              : fallbackProductsFromSnapshot.length > 0
                ? fallbackProductsFromSnapshot
                : fallbackProductsFromInventoryData;
          const products: InventoryProduct[] = (productsSource ?? []).map((p) => ({
            ...p,
            sales_channel: "general",
          })) as InventoryProduct[];
          const mappedOutbound: InventoryOutbound[] = inventoryDataSafe.outbound.map((row: unknown) => {
            const o = row as Record<string, unknown>;
            return {
              id: String(o.id ?? ""),
              product_code: String(o.product_code ?? ""),
              quantity: Number(o.quantity) || 0,
              sales_channel: String(o.sales_channel ?? "general"),
              outbound_date: String(o.outbound_date ?? "").slice(0, 10),
              source_warehouse: o.source_warehouse != null ? String(o.source_warehouse) : null,
              dest_warehouse: o.dest_warehouse != null ? String(o.dest_warehouse) : null,
              note: null,
              category: o.category != null ? String(o.category) : null,
            };
          });
          const mappedInbound: InventoryInbound[] = inventoryDataSafe.inbound.map((row: unknown) => {
            const r = row as Record<string, unknown>;
            return {
              id: String(r.id ?? ""),
              product_code: String(r.product_code ?? ""),
              quantity: Number(r.quantity) || 0,
              sales_channel: String(r.sales_channel ?? "general"),
              inbound_date: String(r.inbound_date ?? "").slice(0, 10),
              source_warehouse: r.source_warehouse != null ? String(r.source_warehouse) : null,
              dest_warehouse: r.dest_warehouse != null ? String(r.dest_warehouse) : null,
              note: null,
              category: r.category != null ? String(r.category) : null,
            };
          });
          const parsedSummary = summaryFromDashboardApi(unified?.summary);

          let forecastMap: Record<string, { forecast_month1: number; forecast_month2: number; forecast_month3: number }> = {};
          let categoryForecast: { thisMonthKey: string; byCategory: Record<string, number> } | undefined;
          if (forecastJson && typeof forecastJson === "object") {
            const forecasts = (forecastJson?.product_forecasts ?? []) as Array<{ product_code: string; forecast_month1: number; forecast_month2: number; forecast_month3: number }>;
            for (const row of forecasts) {
              const code = String(row.product_code ?? "").trim();
              if (!code) continue;
              const v = {
                forecast_month1: Number(row.forecast_month1) || 0,
                forecast_month2: Number(row.forecast_month2) || 0,
                forecast_month3: Number(row.forecast_month3) || 0,
              };
              forecastMap[code] = v;
              forecastMap[normalizeCode(code) || code] = v;
            }
            const cf = forecastJson?.category_forecast as Record<string, { forecast_this_month?: number }> | undefined;
            const label = forecastJson?.forecast_this_month_label as string | undefined;
            if (label && cf && typeof cf === "object") {
              const byCategory: Record<string, number> = {};
              for (const [cat, val] of Object.entries(cf)) {
                const v = val?.forecast_this_month;
                if (typeof v === "number" && v >= 0) byCategory[cat] = v;
              }
              if (Object.keys(byCategory).length > 0) categoryForecast = { thisMonthKey: label, byCategory };
            }
          }

          const nonBlockingErrors = [
            aggregateError,
            typeof snapshot.error === "string" ? snapshot.error : "",
            typeof summary.error === "string" ? summary.error : "",
          ].filter(Boolean);
          const chTotals = (snapshot.channelTotals as Record<string, number>) ?? {};
          applyResult = {
            ...baseApply("success"),
            hasSupabaseCoreData: hasCoreInventoryData,
            supabaseNonBlockingError: nonBlockingErrors.length > 0 ? nonBlockingErrors.join(" | ") : undefined,
            supabaseProducts: products,
            supabaseStockSnapshot: summaryStockSnapshot,
            supabaseInbound: mappedInbound,
            supabaseOutbound: mappedOutbound,
            supabaseSummary: parsedSummary,
            dailyVelocityByProduct: (snapshot.dailyVelocityByProduct as Record<string, number>) ?? {},
            dailyVelocityByProductCoupang: (snapshot.dailyVelocityByProductCoupang as Record<string, number>) ?? {},
            dailyVelocityByProductGeneral: (snapshot.dailyVelocityByProductGeneral as Record<string, number>) ?? {},
            stockByChannelFromApi: (snapshot.stockByChannel as { coupang: Record<string, number>; general: Record<string, number> }) ?? { coupang: {}, general: {} },
            channelTotals: chTotals,
            kpiData: {
              productCount: snapshot.productCount ?? summary.productCount ?? products.length,
              totalValue: snapshot.totalValue ?? summary.totalValue ?? 0,
              totalQuantity: snapshot.totalQuantity ?? 0,
              totalSku: snapshot.totalSku ?? 0,
            },
            categoryTrendData: categoryTrend,
            aiForecastByProduct: forecastMap,
            categoryForecastThisMonth: categoryForecast,
            dataRefreshIncrement: true,
            quickChannelTotals: chTotals,
          };
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        if (generation === refreshGenerationRef.current) setIsSupabaseLoading(false);
        return;
      }
      console.error("[InventoryContext] refresh unexpected", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      applyResult = baseApply("fetch_error", errMsg || "알 수 없는 오류로 대시보드를 불러오지 못했습니다.");
    }

    if (generation !== refreshGenerationRef.current) {
      return;
    }

    console.log("SET STATE", setStateSnapshot, setStateSummary);
    quickChannelTotalsRef.current = applyResult.quickChannelTotals;
    setSupabaseFetchStatus(applyResult.supabaseFetchStatus);
    setSupabaseFetchError(applyResult.supabaseFetchError);
    setSupabaseNonBlockingError(applyResult.supabaseNonBlockingError);
    setUseSupabaseInventory(applyResult.useSupabaseInventory);
    setHasSupabaseCoreData(applyResult.hasSupabaseCoreData);
    setBaseStockState(applyResult.baseStock);
    setBaseStockByProductState(applyResult.baseStockByProduct);
    setTransactions(applyResult.transactions);
    setDailyStockState(applyResult.dailyStock);
    setProductsState(applyResult.products);
    setSupabaseProducts(applyResult.supabaseProducts);
    setSupabaseInbound(applyResult.supabaseInbound);
    setSupabaseOutbound(applyResult.supabaseOutbound);
    setSupabaseStockSnapshot(applyResult.supabaseStockSnapshot);
    setDailyVelocityByProduct(applyResult.dailyVelocityByProduct);
    setDailyVelocityByProductCoupang(applyResult.dailyVelocityByProductCoupang);
    setDailyVelocityByProductGeneral(applyResult.dailyVelocityByProductGeneral);
    setStockByChannelFromApi(applyResult.stockByChannelFromApi);
    setChannelTotals(applyResult.channelTotals);
    setKpiData(applyResult.kpiData);
    setSupabaseSummary(applyResult.supabaseSummary);
    setCategoryTrendData(applyResult.categoryTrendData);
    setCategoryTrendLoaded(applyResult.categoryTrendLoaded);
    setAiForecastByProduct(applyResult.aiForecastByProduct);
    setCategoryForecastThisMonth(applyResult.categoryForecastThisMonth);
    if (applyResult.dataRefreshIncrement) setDataRefreshKey((k) => k + 1);
    setIsSupabaseLoading(false);
  }, []);

  const switchToLocalMode = useCallback(async () => {
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

  const hasInitializedRefreshRef = useRef(false);
  useEffect(() => {
    if (hasInitializedRefreshRef.current) return;
    hasInitializedRefreshRef.current = true;
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

  // Supabase 사용 시: 자동 새로고침 비활성화. 새로고침 버튼 클릭 시에만 refresh

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
    const todayInOutCount =
      supabaseSummary != null
        ? supabaseSummary.todayInOutCount
        : getTodayInOutCount(supabaseInbound, supabaseOutbound);
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
    supabaseSummary,
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
      supabaseSingleSource: true,
      useSupabaseInventory,
      supabaseFetchStatus,
      supabaseFetchError,
      supabaseNonBlockingError,
      isSupabaseLoading,
      hasSupabaseCoreData,
      kpiData: kpiData ?? undefined,
      inventoryProducts: useSupabaseInventory ? supabaseProducts : undefined,
      inventoryInbound: useSupabaseInventory ? supabaseInbound : undefined,
      inventoryOutbound: useSupabaseInventory ? supabaseOutbound : undefined,
      stockSnapshot: useSupabaseInventory ? supabaseStockSnapshot : undefined,
      stockByProductByChannel: supabaseDerived?.stockByProductByChannel,
      channelTotals: useSupabaseInventory ? channelTotals : undefined,
      stockByWarehouse: useSupabaseInventory ? channelTotals : undefined,
      todayInOutCount: supabaseDerived?.todayInOutCount,
      recommendedOrderByProduct: supabaseDerived?.recommendedOrderByProduct,
      avg14DayOutboundByProduct: supabaseDerived?.avg14DayOutboundByProduct ?? {},
      dailyVelocityByProduct: useSupabaseInventory ? dailyVelocityByProduct : undefined,
      dailyVelocityByProductCoupang: useSupabaseInventory ? dailyVelocityByProductCoupang : undefined,
      dailyVelocityByProductGeneral: useSupabaseInventory ? dailyVelocityByProductGeneral : undefined,
      dataRefreshKey,
      categoryTrendData: useSupabaseInventory ? categoryTrendData : null,
      aiForecastByProduct: useSupabaseInventory ? aiForecastByProduct : undefined,
      categoryForecastThisMonth: useSupabaseInventory ? categoryForecastThisMonth : undefined,
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
      supabaseNonBlockingError,
      isSupabaseLoading,
      hasSupabaseCoreData,
      kpiData,
      supabaseProducts,
      supabaseInbound,
      supabaseOutbound,
      supabaseStockSnapshot,
      supabaseDerived?.stockByProductByChannel,
      channelTotals,
      supabaseDerived?.todayInOutCount,
      supabaseDerived?.recommendedOrderByProduct,
      supabaseDerived?.avg14DayOutboundByProduct,
      dailyVelocityByProduct,
      dailyVelocityByProductCoupang,
      dailyVelocityByProductGeneral,
      dataRefreshKey,
      categoryTrendData,
      aiForecastByProduct,
      categoryForecastThisMonth,
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
