"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  fetchInventoryData,
  computeStockByProduct,
  computeStockByCategory,
  computeTotalValue,
  toTransactions,
  computeInOutByItem,
  computeStockByProductByChannel,
  getTodayInOutCount,
  computeSafetyStockByProduct,
  type InventoryProduct,
  type InventoryInbound,
  type InventoryOutbound,
} from "@/lib/inventoryApi";

interface InventoryContextValue {
  stock: StockMap;
  stockByProduct: Record<string, number>;
  baseStock: StockMap;
  transactions: Transaction[];
  products: ProductMasterRow[];
  totalValue: number;
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
  useSupabaseInventory: boolean;
  /** Supabase 대시보드용 (useSupabaseInventory일 때만) */
  inventoryProducts?: InventoryProduct[];
  inventoryInbound?: InventoryInbound[];
  inventoryOutbound?: InventoryOutbound[];
  stockByProductByChannel?: { coupang: Record<string, number>; general: Record<string, number> };
  todayInOutCount?: { inbound: number; outbound: number };
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

const DEFAULT_STOCK: StockMap = {
  mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0,
};

/** InventoryProduct → ProductMasterRow */
function toProductMasterRow(p: InventoryProduct): ProductMasterRow {
  return {
    code: p.code,
    name: p.name,
    group: p.group_name,
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

// 최근 2주(14일) 출고 합계 → 안전재고 기준 (카테고리 + 제품별)
function compute2WeekSafetyStock(transactions: Transaction[]): {
  byItem: Record<string, number>;
  byProduct: Record<string, number>;
} {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const outByItem: Record<string, number> = {};
  const outByProduct: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.type !== "out" || tx.date < cutoffStr) continue;
    outByItem[tx.itemId] = (outByItem[tx.itemId] ?? 0) + tx.quantity;
    if (tx.productCode) {
      outByProduct[tx.productCode] = (outByProduct[tx.productCode] ?? 0) + tx.quantity;
    }
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
  const [supabaseProducts, setSupabaseProducts] = useState<InventoryProduct[]>([]);
  const [supabaseInbound, setSupabaseInbound] = useState<InventoryInbound[]>([]);
  const [supabaseOutbound, setSupabaseOutbound] = useState<InventoryOutbound[]>([]);

  const [baseStock, setBaseStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [baseStockByProduct, setBaseStockByProductState] = useState<Record<string, number>>(
    () => ({})
  );
  const [dailyStock, setDailyStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProductsState] = useState<ProductMasterRow[]>([]);

  const refresh = useCallback(async () => {
    // 1. Supabase inventory_* 테이블에서 먼저 시도
    const invData = await fetchInventoryData();
    if (invData && (invData.products.length > 0 || invData.inbound.length > 0 || invData.outbound.length > 0)) {
      setSupabaseProducts(invData.products);
      setSupabaseInbound(invData.inbound);
      setSupabaseOutbound(invData.outbound);
      setUseSupabaseInventory(true);
      return;
    }

    // 2. Fallback: inventory_sync → localStorage
    setUseSupabaseInventory(false);
    const defaultWorkspace = getDefaultWorkspaceId();
    const syncCode = getStoredSyncCode();
    if (defaultWorkspace) {
      const r = await fetchDefaultWorkspace();
      if (r.ok && r.data) storage.restoreFromBackup(r.data);
    } else if (syncCode) {
      const r = await fetchFromCloud(syncCode);
      if (r.ok && r.data) storage.restoreFromBackup(r.data);
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
  }, []);

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

  // Supabase inventory_* 사용 시: 재고·금액 계산
  const supabaseDerived = useMemo(() => {
    if (!useSupabaseInventory) return null;
    const stockByProduct = computeStockByProduct(
      supabaseProducts,
      supabaseInbound,
      supabaseOutbound
    );
    const stock = computeStockByCategory(stockByProduct, supabaseProducts);
    const totalValue = computeTotalValue(stockByProduct, supabaseProducts);
    const transactions = toTransactions(
      supabaseInbound,
      supabaseOutbound,
      supabaseProducts
    );
    const products = supabaseProducts.map(toProductMasterRow);
    const costsByItem: Record<string, number[]> = {};
    for (const p of supabaseProducts) {
      if (p.unit_cost == null || p.unit_cost <= 0) continue;
      const itemId = mapGroupToItemId(p.group_name);
      if (!costsByItem[itemId]) costsByItem[itemId] = [];
      costsByItem[itemId].push(p.unit_cost);
    }
    const productCostMap: Record<string, number> = {};
    for (const [itemId, costs] of Object.entries(costsByItem)) {
      productCostMap[itemId] = Math.round(
        costs.reduce((a, b) => a + b, 0) / costs.length
      );
    }
    const { byItem: safetyStockMap, byProduct: safetyStockByProduct } =
      compute2WeekSafetyStock(transactions);
    const { inByItem, outByItem } = computeInOutByItem(transactions);
    const stockByProductByChannel = computeStockByProductByChannel(
      supabaseProducts,
      supabaseInbound,
      supabaseOutbound
    );
    const safetyByProduct = computeSafetyStockByProduct(
      supabaseOutbound,
      supabaseProducts
    );
    const todayInOutCount = getTodayInOutCount(supabaseInbound, supabaseOutbound);

    return {
      stock,
      stockByProduct,
      transactions,
      products,
      totalValue,
      productCostMap,
      safetyStockMap,
      safetyStockByProduct: safetyByProduct,
      inByItem,
      outByItem,
      stockByProductByChannel,
      todayInOutCount,
    };
  }, [
    useSupabaseInventory,
    supabaseProducts,
    supabaseInbound,
    supabaseOutbound,
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
  const totalValue = effective?.totalValue ?? 0;
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
      useSupabaseInventory,
      inventoryProducts: useSupabaseInventory ? supabaseProducts : undefined,
      inventoryInbound: useSupabaseInventory ? supabaseInbound : undefined,
      inventoryOutbound: useSupabaseInventory ? supabaseOutbound : undefined,
      stockByProductByChannel: supabaseDerived?.stockByProductByChannel,
      todayInOutCount: supabaseDerived?.todayInOutCount,
    }),
    [
      stock,
      stockByProduct,
      baseStockForDisplay,
      displayTransactions,
      displayProducts,
      totalValue,
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
      useSupabaseInventory,
      supabaseProducts,
      supabaseInbound,
      supabaseOutbound,
      supabaseDerived?.stockByProductByChannel,
      supabaseDerived?.todayInOutCount,
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
