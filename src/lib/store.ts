import { ITEMS } from "./types";
import type { StockMap, Transaction } from "./types";

export const STORAGE_KEYS = {
  stock: "inventory-stock",
  baseStock: "inventory-base-stock",
  baseStockByProduct: "inventory-base-stock-by-product",
  dailyStock: "inventory-daily-stock",
  transactions: "inventory-transactions",
  products: "inventory-products",
} as const;

function getDefaultStock(): StockMap {
  return {
    mask: 0,
    capsule: 0,
    fabric: 0,
    liquid: 0,
    living: 0,
  };
}

function loadStock(): StockMap {
  if (typeof window === "undefined") return getDefaultStock();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.stock);
    if (!raw) return getDefaultStock();
    const parsed = JSON.parse(raw) as Record<string, number>;
    const def = getDefaultStock();
    // 이전 데이터 호환: detergent->capsule, raw->living
    const migrated: StockMap = { ...def };
    for (const [k, v] of Object.entries(parsed)) {
      if (k === "detergent") migrated.capsule = (migrated.capsule ?? 0) + v;
      else if (k === "raw") migrated.living = (migrated.living ?? 0) + v;
      else if (k in def) migrated[k as keyof StockMap] = v;
    }
    return migrated;
  } catch {
    return getDefaultStock();
  }
}

const LEGACY_ITEM_MAP: Record<string, string> = {
  detergent: "capsule",
  raw: "living",
};

function loadTransactions(): Transaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.transactions);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Transaction[];
    return arr.map((tx) => ({
      ...tx,
      itemId: (LEGACY_ITEM_MAP[tx.itemId] ?? tx.itemId) as Transaction["itemId"],
    }));
  } catch {
    return [];
  }
}

// 원가 = 제품별 원가 × 수량 (product.unitCost 또는 ITEMS 기본값)
export function getTotalValue(stock: StockMap, productCostMap?: Record<string, number>): number {
  return ITEMS.reduce((sum, item) => {
    const qty = stock[item.id] ?? 0;
    const unitCost = productCostMap?.[item.id] ?? item.unitCost;
    return sum + qty * unitCost;
  }, 0);
}

export function getItemValue(itemId: keyof StockMap, qty: number, unitCost?: number): number {
  const item = ITEMS.find((i) => i.id === itemId);
  const cost = unitCost ?? item?.unitCost ?? 0;
  return qty * cost;
}

/** 품절 임박: 재고 0 이거나 안전재고 이하만 (재고 > 0 && 재고 > 안전재고 → 제외) */
export function getShortageItems(stock: StockMap, safetyStockMap?: Record<string, number>) {
  return ITEMS.filter((item) => {
    const qty = stock[item.id] ?? 0;
    const safety = safetyStockMap?.[item.id] ?? item.safetyStock ?? 0;
    if (qty <= 0) return true;
    if (safety > 0 && qty <= safety) return true;
    return false;
  });
}

export const storage = {
  loadStock,
  loadTransactions,
  loadProducts() {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.products);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },
  saveStock(stock: StockMap) {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.stock, JSON.stringify(stock));
  },
  saveTransactions(tx: Transaction[]) {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(tx));
  },
  saveProducts(products: unknown[]) {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.products, JSON.stringify(products));
  },
  loadBaseStock(): StockMap {
    if (typeof window === "undefined") return getDefaultStock();
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.baseStock);
      if (!raw) return getDefaultStock();
      const parsed = JSON.parse(raw) as Record<string, number>;
      const def = getDefaultStock();
      const migrated: StockMap = { ...def };
      for (const [k, v] of Object.entries(parsed)) {
        if (k in def) migrated[k as keyof StockMap] = v;
      }
      return migrated;
    } catch {
      return getDefaultStock();
    }
  },
  loadBaseStockByProduct(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.baseStockByProduct);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  },
  saveBaseStock(baseStock: StockMap) {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.baseStock, JSON.stringify(baseStock));
  },
  saveBaseStockByProduct(byProduct: Record<string, number>) {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.baseStockByProduct, JSON.stringify(byProduct));
  },
  loadDailyStock(): StockMap {
    if (typeof window === "undefined") return getDefaultStock();
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.dailyStock);
      if (!raw) return getDefaultStock();
      const parsed = JSON.parse(raw) as Record<string, number>;
      const def = getDefaultStock();
      const migrated: StockMap = { ...def };
      for (const [k, v] of Object.entries(parsed)) {
        if (k in def) migrated[k as keyof StockMap] = v;
      }
      return migrated;
    } catch {
      return getDefaultStock();
    }
  },
  saveDailyStock(dailyStock: StockMap) {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.dailyStock, JSON.stringify(dailyStock));
  },
  resetAll() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEYS.stock);
    localStorage.removeItem(STORAGE_KEYS.baseStock);
    localStorage.removeItem(STORAGE_KEYS.baseStockByProduct);
    localStorage.removeItem(STORAGE_KEYS.dailyStock);
    localStorage.removeItem(STORAGE_KEYS.transactions);
    localStorage.removeItem(STORAGE_KEYS.products);
  },

  /** Supabase 단일 출처 모드: 로컬 재고 데이터만 삭제 (sync-code 유지) */
  clearLocalInventoryData() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEYS.stock);
    localStorage.removeItem(STORAGE_KEYS.baseStock);
    localStorage.removeItem(STORAGE_KEYS.baseStockByProduct);
    localStorage.removeItem(STORAGE_KEYS.dailyStock);
    localStorage.removeItem(STORAGE_KEYS.transactions);
    localStorage.removeItem(STORAGE_KEYS.products);
  },

  /** 웹 업로드 단일 반영: inventory-* 키 전체 삭제 (캐시/과거 데이터 제거) */
  clearAllInventoryKeys() {
    if (typeof window === "undefined") return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("inventory-")) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  },

  /** 전체 데이터 백업 (JSON) */
  exportBackup(): string {
    if (typeof window === "undefined") return "{}";
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      products: this.loadProducts(),
      transactions: loadTransactions(),
      baseStock: this.loadBaseStock(),
      baseStockByProduct: this.loadBaseStockByProduct(),
      dailyStock: this.loadDailyStock(),
    };
    return JSON.stringify(data, null, 2);
  },

  /** 백업에서 복구 */
  restoreFromBackup(jsonStr: string): { ok: boolean; error?: string } {
    if (typeof window === "undefined") return { ok: false, error: "브라우저 환경이 아님" };
    try {
      const data = JSON.parse(jsonStr) as {
        version?: number;
        products?: unknown[];
        transactions?: Transaction[];
        baseStock?: StockMap;
        baseStockByProduct?: Record<string, number>;
        dailyStock?: StockMap;
      };
      if (data.products) this.saveProducts(data.products);
      if (data.transactions) this.saveTransactions(data.transactions);
      if (data.baseStock) this.saveBaseStock(data.baseStock);
      if (data.baseStockByProduct) this.saveBaseStockByProduct(data.baseStockByProduct);
      if (data.dailyStock) this.saveDailyStock(data.dailyStock);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
