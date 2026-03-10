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
  getTotalValue,
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

interface InventoryContextValue {
  stock: StockMap;
  stockByProduct: Record<string, number>; // 제품별 재고 (품목코드 기준)
  baseStock: StockMap;
  transactions: Transaction[];
  products: ProductMasterRow[];
  totalValue: number;
  shortageItems: ReturnType<typeof getShortageItems>;
  safetyStockMap: Record<string, number>; // 최근 2주 출고 기준 (카테고리)
  safetyStockByProduct: Record<string, number>; // 최근 2주 출고 기준 (제품별)
  productCostMap: Record<string, number>; // 품목별 원가
  addTransaction: (tx: Omit<Transaction, "id" | "createdAt">) => void;
  addTransactions: (txs: Array<Omit<Transaction, "id" | "createdAt">>) => void;
  setProducts: (rows: ProductMasterRow[]) => void;
  setBaseStock: (baseStock: StockMap, baseStockByProduct?: Record<string, number>) => void;
  dailyStock: StockMap;
  setDailyStock: (dailyStock: StockMap) => void;
  resetAll: () => void;
  refresh: () => void;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

const DEFAULT_STOCK: StockMap = {
  mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0,
};

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
  // Hydration 방지: 서버/클라이언트 초기값을 동일하게 (localStorage는 useEffect에서만 로드)
  const [baseStock, setBaseStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [baseStockByProduct, setBaseStockByProductState] = useState<Record<string, number>>(
    () => ({})
  );
  const [dailyStock, setDailyStockState] = useState<StockMap>(() => DEFAULT_STOCK);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProductsState] = useState<ProductMasterRow[]>([]);

  const refresh = useCallback(() => {
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

  // 앱 로드 시: Supabase 설정 시 클라우드에서 먼저 가져옴 (전 직원 공유)
  useEffect(() => {
    const defaultWorkspace = getDefaultWorkspaceId();
    const syncCode = getStoredSyncCode();

    if (defaultWorkspace) {
      // Supabase 기본 워크스페이스: 전 직원이 동일 데이터 공유
      fetchDefaultWorkspace()
        .then((r) => {
          if (r.ok && r.data) storage.restoreFromBackup(r.data);
        })
        .catch(() => {})
        .finally(() => refresh());
    } else if (syncCode) {
      // 연동코드 방식 (Supabase 미설정 시)
      fetchFromCloud(syncCode)
        .then((r) => {
          if (r.ok && r.data) storage.restoreFromBackup(r.data);
        })
        .catch(() => {})
        .finally(() => refresh());
    } else {
      refresh();
    }
  }, [refresh]);

  // Supabase 설정 시 데이터 변경 시 클라우드에 자동 저장 (전 직원 실시간 공유)
  useEffect(() => {
    const defaultWorkspace = getDefaultWorkspaceId();
    const syncCode = getStoredSyncCode();
    const targetCode = defaultWorkspace ?? syncCode;
    if (!targetCode) return;

    const hasData =
      transactions.length > 0 ||
      products.length > 0 ||
      Object.values(baseStock).some((v) => v > 0) ||
      Object.values(dailyStock).some((v) => v > 0);
    if (!hasData) return; // 빈 데이터로 클라우드 덮어쓰기 방지

    const t = setTimeout(() => {
      const json = storage.exportBackup();
      if (defaultWorkspace) {
        pushDefaultWorkspace(json).catch(() => {});
      } else {
        pushToCloud(syncCode!, json).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [transactions, baseStock, baseStockByProduct, dailyStock, products]);

  // 다른 탭에서 localStorage 수정 시 브라우저에 반영
  useEffect(() => {
    const handler = (e: StorageEvent) => {
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
        storage.saveTransactions(next);
        return next;
      });
    },
    []
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
        storage.saveTransactions(next);
        return next;
      });
    },
    []
  );

  const setBaseStock = useCallback(
    (base: StockMap, baseByProduct?: Record<string, number>) => {
      setBaseStockState(base);
      if (baseByProduct !== undefined) {
        setBaseStockByProductState(baseByProduct);
        storage.saveBaseStockByProduct(baseByProduct);
      }
      storage.saveBaseStock(base);
    },
    []
  );

  const setProducts = useCallback((rows: ProductMasterRow[]) => {
    setProductsState(rows);
    storage.saveProducts(rows);
  }, []);

  const setDailyStock = useCallback((daily: StockMap) => {
    setDailyStockState(daily);
    storage.saveDailyStock(daily);
  }, []);

  const resetAll = useCallback(() => {
    storage.resetAll();
    setTransactions([]);
    setBaseStockState({ ...DEFAULT_STOCK });
    setBaseStockByProductState({});
    setDailyStockState({ ...DEFAULT_STOCK });
    setProductsState([]);
  }, []);

  const { stock, stockByProduct } = useMemo(() => {
    const txDelta = applyTransactionsToStockDelta(transactions);
    const txProductDelta = applyTransactionsToProductDelta(transactions);
    return computeStock(baseStock, baseStockByProduct, txDelta, txProductDelta);
  }, [baseStock, baseStockByProduct, transactions]);

  useEffect(() => {
    storage.saveStock(stock);
  }, [stock]);

  const productCostMap = useMemo(() => computeProductCostMap(products), [products]);
  const { byItem: safetyStockMap, byProduct: safetyStockByProduct } = useMemo(
    () => compute2WeekSafetyStock(transactions),
    [transactions]
  );
  const totalValue = useMemo(() => getTotalValue(stock, productCostMap), [stock, productCostMap]);
  const shortageItems = useMemo(
    () => getShortageItems(stock, safetyStockMap),
    [stock, safetyStockMap]
  );

  const value = useMemo(
    () => ({
      stock,
      stockByProduct,
      baseStock,
      transactions,
      products,
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
    }),
    [
      stock,
      stockByProduct,
      baseStock,
      transactions,
      products,
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
