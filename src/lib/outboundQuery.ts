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
      throw new Error(`[fetchOutboundRowsUnified] max pages reached pageIndex=${pageIndex}`);
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
      throw new Error(
        `[fetchOutboundRowsUnified] query failed page=${pageIndex} range=${rangeStart}-${rangeEnd} error=${error.message}`
      );
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
