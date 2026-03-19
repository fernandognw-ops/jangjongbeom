/**
 * previewToken 저장소 (서버 메모리)
 * validate 성공 시 발급, commit 시 검증 후 삭제
 * TTL 5분
 */

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
      stockCount: number;
      totalStockValue: number;
      destWarehouseDistribution: Record<string, number>;
      snapshotDates: string[];
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
