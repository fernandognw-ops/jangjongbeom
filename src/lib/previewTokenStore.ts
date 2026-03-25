/**
 * previewToken 저장소 (서버 메모리)
 * validate 성공 시 발급, commit 시 검증 후 삭제
 * TTL 5분
 */

import type { NormalizedWarehouse } from "@/lib/inventoryChannels";

const TTL_MS = 5 * 60 * 1000;

interface PreviewEntry {
  data: {
    filename: string;
    inbound: unknown[];
    outbound: unknown[];
    stockSnapshot: unknown[];
    rawdata: unknown[];
    currentProductCodes: string[];
    validation: {
      rawdataCount: number;
      inboundCount: number;
      outboundCount: number;
      outboundParsedCount?: number;
      outboundTrace?: { rawRows?: number; parsedRows: number; filteredOut?: number };
      stockCount: number;
      totalStockValue: number;
      destWarehouseDistribution: Record<string, number>;
      destWarehouseBySource?: { inbound: Record<string, number>; outbound: Record<string, number>; stock: Record<string, number> };
      snapshotDates: string[];
      destWarehouseValid: boolean;
      snapshotDateValid?: boolean;
      filenameHasDatePattern?: boolean;
      filenameExpectedDate?: string;
      filenameExpectedMonth?: string;
      snapshotDateMismatchReason?: string;
      snapshotLooksLikeServerTodayOnly?: boolean;
      stockDateColumnFound?: boolean;
      stockDateColumnHeader?: string;
      outboundDates?: string[];
      outboundTotalQty?: number;
      outboundTotalAmountExcel?: number;
      outboundDatePeriodValid?: boolean;
      outboundOutsideMonthCount?: number;
      outboundOutsideMonthRatio?: number;
      outboundDateMismatchReason?: string;
      outboundDateColumnFound?: boolean;
      outboundDateColumnHeader?: string;
      outboundRawRowCount?: number;
      uploadPeriodValid?: boolean;
      outboundChannelBreakdown?: Record<string, number>;
      outboundSalesChannelColumnFound?: boolean;
      outboundSalesChannelColumnHeader?: string;
      outboundSalesChannelDistinctRaw?: string[];
      outboundSalesChannelDistinctTrimmed?: string[];
      outboundSalesChannelSamples?: Array<{
        rowIndex: number;
        rawBeforeTrim: string;
        rawAfterTrim: string;
        mappedChannelKr: string;
        channel: NormalizedWarehouse;
      }>;
      outboundSalesChannelClassifiedRaw?: {
        coupang: string[];
        general: string[];
      };
    };
  };
  expiresAt: number;
}

const store = new Map<string, PreviewEntry>();

function prune() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < now) store.delete(k);
  }
}

export function createPreviewToken(data: PreviewEntry["data"]): string {
  prune();
  const token = crypto.randomUUID();
  store.set(token, {
    data,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

export function consumePreviewToken(token: string): PreviewEntry["data"] | null {
  prune();
  const entry = store.get(token);
  if (!entry || entry.expiresAt < Date.now()) return null;
  store.delete(token);
  return entry.data;
}
