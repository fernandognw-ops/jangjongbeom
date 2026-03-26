/**
 * inventory_stock_snapshot 행 집계 — quick / KPI / snapshot 공통
 * - 집계 축은 **`sales_channel`(판매채널)만** — dest_warehouse·storage_center·channel 컬럼으로 축 대체 없음
 */
import {
  normalizeSalesChannelKr,
  pickOutboundSalesChannelRawFromRow,
  WAREHOUSE_COUPANG,
  WAREHOUSE_GENERAL,
  type NormalizedWarehouse,
} from "@/lib/inventoryChannels";

export type SnapshotRow = {
  product_code?: string;
  product_name?: string;
  quantity?: unknown;
  pack_size?: unknown;
  total_price?: unknown;
  unit_cost?: unknown;
  /** 레거시: 물류/표시용 (집계 축 아님) */
  dest_warehouse?: string;
  /** 보관센터 (집계 키 아님) */
  storage_center?: string;
  /** 판매채널 — 집계 유일 축 */
  sales_channel?: string;
  category?: string;
  snapshot_date?: string;
};

/** `channelForSnapshotRow` / 집계용 — 선택 소스와 정규화된 채널 */
export type SnapshotChannelResolution = {
  channel: NormalizedWarehouse;
  source: "sales_channel" | "empty";
};

/** 디버그·카운터용 (선택) */
export type SnapshotChannelDebugStats = {
  sales_channel_used: number;
  empty_source: number;
  chosen_coupang: number;
  chosen_general: number;
};

export function createEmptySnapshotChannelDebugStats(): SnapshotChannelDebugStats {
  return {
    sales_channel_used: 0,
    empty_source: 0,
    chosen_coupang: 0,
    chosen_general: 0,
  };
}

/** DB 행의 `sales_channel`만으로 정규화 (쿠팡|일반). dest_warehouse 미사용. */
export function resolveSnapshotChannelWithSource(r: SnapshotRow): SnapshotChannelResolution {
  const picked = pickOutboundSalesChannelRawFromRow(r as Record<string, unknown>);
  if (picked) {
    return { channel: normalizeSalesChannelKr(picked, { lenient: true }), source: "sales_channel" };
  }
  return { channel: WAREHOUSE_GENERAL, source: "empty" };
}

function applySnapshotChannelStats(
  stats: SnapshotChannelDebugStats | undefined,
  res: SnapshotChannelResolution
): void {
  if (!stats) return;
  if (res.source === "sales_channel") stats.sales_channel_used += 1;
  else stats.empty_source += 1;
  if (res.channel === WAREHOUSE_COUPANG) stats.chosen_coupang += 1;
  else stats.chosen_general += 1;
}

/**
 * quick/snapshot/summary/kpi 공통 — `stats` 넘기면 건별 소스·채널 카운트
 */
export function channelForSnapshotRow(
  r: SnapshotRow,
  stats?: SnapshotChannelDebugStats
): string {
  const res = resolveSnapshotChannelWithSource(r);
  applySnapshotChannelStats(stats, res);
  return res.channel;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `resolveSnapshotChannelWithSource`로 정한 채널만 반영 (한 번만 resolve 호출) */
export function applyChannelQtyToMetrics(
  code: string,
  wh: NormalizedWarehouse,
  qty: number,
  channelTotals: Record<string, number>,
  stockByChannel: { coupang: Record<string, number>; general: Record<string, number> }
): void {
  if (!code) return;
  channelTotals[wh] = (channelTotals[wh] ?? 0) + qty;
  if (wh === WAREHOUSE_COUPANG) {
    stockByChannel.coupang[code] = (stockByChannel.coupang[code] ?? 0) + qty;
  } else {
    stockByChannel.general[code] = (stockByChannel.general[code] ?? 0) + qty;
  }
}

/**
 * 재고 스냅샷 행 → channelTotals / stockByChannel — **유일한** 채널 집계 경로 (quick·snapshot·UI 동일)
 */
export function addSnapshotRowToChannelMetrics(
  r: SnapshotRow,
  channelTotals: Record<string, number>,
  stockByChannel: { coupang: Record<string, number>; general: Record<string, number> }
): void {
  const code = String(r.product_code ?? "").trim();
  if (!code) return;
  const wh = resolveSnapshotChannelWithSource(r).channel;
  const qty = toNum(r.quantity);
  applyChannelQtyToMetrics(code, wh, qty, channelTotals, stockByChannel);
}

export function buildChannelTotalsAndStockByChannel(rows: SnapshotRow[]): {
  channelTotals: Record<string, number>;
  stockByChannel: { coupang: Record<string, number>; general: Record<string, number> };
} {
  const stockByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
  const channelTotals: Record<string, number> = {};
  for (const r of rows) {
    addSnapshotRowToChannelMetrics(r, channelTotals, stockByChannel);
  }
  return { channelTotals, stockByChannel };
}

function effectivePack(
  code: string,
  rowPack: unknown,
  packByCode?: Map<string, number>
): number {
  const n = toNum(rowPack);
  if (n > 0) return Math.max(1, n);
  const fb = code ? packByCode?.get(code) : undefined;
  return Math.max(1, toNum(fb ?? 0) || 1);
}

export type SnapshotDebugRowSample = {
  product_code: string;
  storage_center: string | null;
  dest_warehouse: string | null;
  sales_channel: string | null;
  resolution_source: SnapshotChannelResolution["source"];
  chosen_channel: string;
  quantity: number;
};

export type AggregateSnapshotDebug = {
  debug_used_channel_source_counts: {
    sales_channel_used: number;
    empty_source: number;
  };
  debug_chosen_channel_counts: { coupang: number; general: number };
  /** 집계 순서 기준 앞 20건 */
  debug_sample_rows: SnapshotDebugRowSample[];
  /** sales_channel 비어 있지 않고 chosen_channel === 쿠팡 */
  debug_rows_sales_nonempty_and_chosen_coupang: SnapshotDebugRowSample[];
  /** sales_channel 정규화=일반 인데 chosen=쿠팡 (로직 불일치 시만) */
  debug_anomaly_sales_normalizes_general_but_chosen_coupang: SnapshotDebugRowSample[];
};

/**
 * totalQuantity = 모든 행 quantity 합
 * totalValue = 행마다 total_price, 0 이하면 quantity*unit_cost
 * totalSku = 품목별 floor(합계 quantity / 대표 pack) 합
 */
export function aggregateSnapshotRowsForDashboard(
  rows: SnapshotRow[],
  productFallback: Map<string, { product_name: string; category: string }>,
  packByCode?: Map<string, number>,
  options?: { debug?: boolean }
): {
  items: Array<{
    product_code: string;
    product_name?: string;
    quantity: number;
    pack_size: number;
    total_price: number;
    sku: number;
    category: string;
  }>;
  totalValue: number;
  totalQuantity: number;
  totalSku: number;
  productCount: number;
  stockByChannel: { coupang: Record<string, number>; general: Record<string, number> };
  channelTotals: Record<string, number>;
  debug_aggregate?: AggregateSnapshotDebug;
} {
  const debug = options?.debug === true;
  const stats = debug ? createEmptySnapshotChannelDebugStats() : undefined;

  const stockByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
  /** 판매채널별 수량 합 (dest_warehouse = 판매채널) */
  const channelTotals: Record<string, number> = {};
  const merged: Record<string, { qty: number; price: number; pack: number; name: string; category: string }> = {};

  const debugSample: SnapshotDebugRowSample[] = [];
  const debugSalesCoupang: SnapshotDebugRowSample[] = [];
  const debugAnomaly: SnapshotDebugRowSample[] = [];

  for (const r of rows) {
    const code = String(r.product_code ?? "").trim();
    if (!code) continue;
    const res = resolveSnapshotChannelWithSource(r);
    if (stats) applySnapshotChannelStats(stats, res);
    const wh = res.channel;

    const qty = toNum(r.quantity);

    if (debug) {
      const rowDebug: SnapshotDebugRowSample = {
        product_code: code,
        storage_center: r.storage_center != null ? String(r.storage_center) : null,
        dest_warehouse: r.dest_warehouse != null ? String(r.dest_warehouse) : null,
        sales_channel: r.sales_channel != null ? String(r.sales_channel) : null,
        resolution_source: res.source,
        chosen_channel: wh,
        quantity: qty,
      };
      if (debugSample.length < 20) debugSample.push(rowDebug);

      const salesTrim = String(r.sales_channel ?? "").trim();
      if (salesTrim !== "" && wh === WAREHOUSE_COUPANG && debugSalesCoupang.length < 20) {
        debugSalesCoupang.push(rowDebug);
      }
      if (salesTrim !== "") {
        const salesNorm = normalizeSalesChannelKr(r.sales_channel, { lenient: true });
        if (salesNorm === WAREHOUSE_GENERAL && wh === WAREHOUSE_COUPANG && debugAnomaly.length < 20) {
          debugAnomaly.push(rowDebug);
        }
      }
    }

    const pack = effectivePack(code, r.pack_size, packByCode);
    let price = toNum(r.total_price);
    if (price <= 0 && qty > 0) price = qty * toNum(r.unit_cost);

    applyChannelQtyToMetrics(code, wh, qty, channelTotals, stockByChannel);

    const fallback = productFallback.get(code);
    const name = String(r.product_name ?? "").trim() || fallback?.product_name || code;
    const category = String(r.category ?? "").trim() || fallback?.category || "기타";

    if (!merged[code]) {
      merged[code] = { qty: 0, price: 0, pack, name, category };
    } else {
      merged[code].pack = Math.max(merged[code].pack, pack);
    }
    merged[code].qty += qty;
    merged[code].price += price;
  }

  let totalValue = 0;
  let totalQuantity = 0;
  let totalSku = 0;
  const items = Object.entries(merged).map(([code, d]) => {
    const pack = Math.max(1, d.pack);
    const sku = Math.floor(d.qty / pack);
    totalValue += d.price;
    totalQuantity += d.qty;
    totalSku += sku;
    return {
      product_code: code,
      product_name: d.name || undefined,
      quantity: d.qty,
      pack_size: pack,
      total_price: d.price,
      sku,
      category: d.category,
    };
  });

  const base = {
    items,
    totalValue: Math.round(totalValue),
    totalQuantity,
    totalSku,
    productCount: items.length,
    stockByChannel,
    channelTotals,
  };

  if (debug && stats) {
    return {
      ...base,
      debug_aggregate: {
        debug_used_channel_source_counts: {
          sales_channel_used: stats.sales_channel_used,
          empty_source: stats.empty_source,
        },
        debug_chosen_channel_counts: {
          coupang: stats.chosen_coupang,
          general: stats.chosen_general,
        },
        debug_sample_rows: debugSample,
        debug_rows_sales_nonempty_and_chosen_coupang: debugSalesCoupang,
        debug_anomaly_sales_normalizes_general_but_chosen_coupang: debugAnomaly,
      },
    };
  }

  return base;
}
