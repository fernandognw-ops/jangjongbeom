import type { SupabaseClient } from "@supabase/supabase-js";

export type OutboundPageDebug = {
  table: "inventory_outbound";
  pageIndex: number;
  rangeStart: number;
  rangeEnd: number;
  fetchedRowCount: number;
  cumulativeRowCount: number;
  hasNextPage: boolean;
  breakReason: "continue" | "normal_end_short_page" | "max_pages_guard" | "error";
  error: string | null;
};

export type OutboundFetchMeta = {
  table: "inventory_outbound";
  sourceType: "table";
  clientType: "supabase-js";
  queryFilter: {
    outbound_date_gte: string;
    outbound_date_lt?: string;
  };
  orderCondition: "order by outbound_date asc, id asc";
  selectedColumns: string;
};

export function monthRange(monthKey: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const start = `${monthKey}-01`;
  if (m === 12) return { start, end: `${y + 1}-01-01` };
  return { start, end: `${y}-${String(m + 1).padStart(2, "0")}-01` };
}

export async function fetchOutboundRowsUnified<T>(
  supabase: SupabaseClient,
  opts: {
    selectedColumns: string;
    startDate: string;
    endDate?: string;
    pageSize?: number;
    maxPages?: number;
    onPageDebug?: (d: OutboundPageDebug) => void;
  }
): Promise<{ rows: T[]; meta: OutboundFetchMeta }> {
  const pageSize = opts.pageSize ?? 2000;
  const maxPages = opts.maxPages ?? 500;
  const rows: T[] = [];
  let offset = 0;
  let pageIndex = 0;
  while (true) {
    if (pageIndex >= maxPages) {
      console.error(`[fetchOutboundRowsUnified] max pages reached pageIndex=${pageIndex}, returning partial rows=${rows.length}`);
      opts.onPageDebug?.({
        table: "inventory_outbound",
        pageIndex,
        rangeStart: offset,
        rangeEnd: offset + pageSize - 1,
        fetchedRowCount: 0,
        cumulativeRowCount: rows.length,
        hasNextPage: false,
        breakReason: "max_pages_guard",
        error: null,
      });
      break;
    }
    const rangeStart = offset;
    const rangeEnd = offset + pageSize - 1;
    let q = supabase
      .from("inventory_outbound")
      .select(opts.selectedColumns)
      .gte("outbound_date", opts.startDate)
      .order("outbound_date", { ascending: true })
      .order("id", { ascending: true });
    if (opts.endDate) q = q.lt("outbound_date", opts.endDate);
    const { data, error } = await q.range(rangeStart, rangeEnd);
    if (error) {
      console.error(
        `[fetchOutboundRowsUnified] query failed page=${pageIndex} range=${rangeStart}-${rangeEnd} error=${error.message}`
      );
      opts.onPageDebug?.({
        table: "inventory_outbound",
        pageIndex,
        rangeStart,
        rangeEnd,
        fetchedRowCount: 0,
        cumulativeRowCount: rows.length,
        hasNextPage: false,
        breakReason: "error",
        error: error.message,
      });
      break;
    }
    const fetched = (data ?? []) as T[];
    rows.push(...fetched);
    const hasNextPage = fetched.length === pageSize;
    opts.onPageDebug?.({
      table: "inventory_outbound",
      pageIndex,
      rangeStart,
      rangeEnd,
      fetchedRowCount: fetched.length,
      cumulativeRowCount: rows.length,
      hasNextPage,
      breakReason: hasNextPage ? "continue" : "normal_end_short_page",
      error: null,
    });
    if (!hasNextPage) break;
    offset += pageSize;
    pageIndex += 1;
  }
  return {
    rows,
    meta: {
      table: "inventory_outbound",
      sourceType: "table",
      clientType: "supabase-js",
      queryFilter: {
        outbound_date_gte: opts.startDate,
        ...(opts.endDate ? { outbound_date_lt: opts.endDate } : {}),
      },
      orderCondition: "order by outbound_date asc, id asc",
      selectedColumns: opts.selectedColumns,
    },
  };
}

/** 입고도 출고와 동일하게 기간 내 전 행을 페이지로 가져옴 (단일 limit로 최신 누락 방지) */
export async function fetchInboundRowsUnified<T>(
  supabase: SupabaseClient,
  opts: {
    selectedColumns: string;
    startDate: string;
    endDate?: string;
    pageSize?: number;
    maxPages?: number;
  }
): Promise<{ rows: T[] }> {
  const pageSize = opts.pageSize ?? 2000;
  const maxPages = opts.maxPages ?? 500;
  const rows: T[] = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    let q = supabase
      .from("inventory_inbound")
      .select(opts.selectedColumns)
      .gte("inbound_date", opts.startDate)
      .order("inbound_date", { ascending: true })
      .order("id", { ascending: true });
    if (opts.endDate) q = q.lt("inbound_date", opts.endDate);
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) {
      console.error(
        `[fetchInboundRowsUnified] query failed page=${pageIndex} offset=${offset} error=${error.message}`
      );
      break;
    }
    const fetched = (data ?? []) as T[];
    rows.push(...fetched);
    if (fetched.length < pageSize) break;
    offset += pageSize;
  }
  return { rows };
}
