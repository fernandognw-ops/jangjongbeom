/**
 * 재고 알림 서비스
 * - 재고 가치 1,000만 원 이상 핵심 품목의 품절 임박 시 카카오톡 알림
 * - 현재: 콘솔 출력 (테스트용)
 * - 추후: KAKAO_API_KEY 등으로 카카오 알림톡 API 연동
 */

import type { InventoryProduct } from "@/lib/inventoryApi";

/** 알림 기준: 재고 가치 1,000만 원 이상 */
export const CRITICAL_STOCK_VALUE_THRESHOLD = 10_000_000;

/** 품절 임박: 현재 재고 ≤ 안전재고의 20% */
export function isImpendingStockout(
  stock: number,
  safetyStock: number
): boolean {
  return safetyStock > 0 && stock <= safetyStock * 0.2;
}

/** 재고 가치 = 수량 × 단가 */
export function getStockValue(quantity: number, unitCost: number): number {
  return quantity * (unitCost ?? 0);
}

/** 핵심 품목 여부 (재고 가치 1,000만 원 이상) */
export function isCriticalItem(
  stock: number,
  unitCost: number
): boolean {
  return getStockValue(stock, unitCost) >= CRITICAL_STOCK_VALUE_THRESHOLD;
}

export interface StockAlertItem {
  product: InventoryProduct;
  stock: number;
  safetyStock: number;
  stockValue: number;
}

export interface AlertMessage {
  title: string;
  items: Array<{
    productName: string;
    skuCode: string;
    stock: number;
    stockValueWon: number;
    stockValueMan: string;
  }>;
  dashboardUrl: string;
}

/** 알림 대상 품목 필터링 (재고 가치 1,000만+ & 품절 임박) */
export function getCriticalStockoutItems(
  products: InventoryProduct[],
  stockByProduct: Record<string, number>,
  safetyStockByProduct: Record<string, number>
): StockAlertItem[] {
  const result: StockAlertItem[] = [];
  for (const p of products) {
    const stock = Math.max(0, stockByProduct[p.product_code] ?? 0);
    const safety = safetyStockByProduct[p.product_code] ?? 0;
    const unitCost = p.unit_cost ?? 0;
    const value = getStockValue(stock, unitCost);

    if (isCriticalItem(stock, unitCost) && isImpendingStockout(stock, safety)) {
      result.push({
        product: p,
        stock,
        safetyStock: safety,
        stockValue: value,
      });
    }
  }
  return result;
}

/** 알림 메시지 생성 */
export function buildAlertMessage(
  items: StockAlertItem[],
  dashboardUrl: string = typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL ?? "https://jangjongbeom.vercel.app"
): AlertMessage {
  return {
    title: "🚨 긴급 재고 알림",
    items: items.map(({ product, stock, stockValue }) => ({
      productName: product.product_name,
      skuCode: product.product_code,
      stock,
      stockValueWon: stockValue,
      stockValueMan: (stockValue / 1_000_000).toFixed(0),
    })),
    dashboardUrl,
  };
}

/** 단일 품목 알림 텍스트 (카카오톡용) */
export function formatSingleAlertText(
  item: AlertMessage["items"][0],
  dashboardUrl: string
): string {
  return [
    "🚨 긴급 재고 알림",
    "",
    `품목명: ${item.productName} (${item.skuCode})`,
    `현재 재고: ${item.stock.toLocaleString()}개 (재고 가치: ${item.stockValueMan}만원)`,
    "상태: 품절 임박 (즉시 발주 필요)",
    "",
    `바로가기: ${dashboardUrl}`,
  ].join("\n");
}

/** 전체 알림 텍스트 (여러 품목) */
export function formatAlertText(message: AlertMessage): string {
  const lines: string[] = [
    "🚨 긴급 재고 알림",
    "",
    `품절 임박 핵심 품목 ${message.items.length}건`,
    "",
  ];
  for (const item of message.items) {
    lines.push(
      `▸ ${item.productName} (${item.skuCode})`,
      `  현재 재고: ${item.stock.toLocaleString()}개 (${item.stockValueMan}만원)`,
      ""
    );
  }
  lines.push(`바로가기: ${message.dashboardUrl}`);
  return lines.join("\n");
}

/** 알림 전송 (현재: 콘솔 출력, 추후: 카카오 API) */
export async function sendStockAlert(
  message: AlertMessage
): Promise<{ ok: boolean; sentVia?: string; error?: string }> {
  const text = formatAlertText(message);

  // 1. 콘솔 출력 (테스트용)
  console.log("[notification] 재고 알림:", text);

  // 2. 카카오 API 연동 (환경변수 설정 시)
  const apiKey = process.env.KAKAO_REST_API_KEY ?? process.env.KAKAO_API_KEY;
  const chatWebhook = process.env.KAKAO_CHAT_WEBHOOK_URL;

  if (chatWebhook) {
    try {
      const res = await fetch(chatWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          items: message.items,
          dashboardUrl: message.dashboardUrl,
        }),
      });
      if (res.ok) {
        return { ok: true, sentVia: "webhook" };
      }
      return { ok: false, error: `Webhook ${res.status}: ${await res.text()}` };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (apiKey) {
    // 카카오 알림톡 API 연동 자리 (추후 구현)
    // https://developers.kakao.com/docs/latest/ko/message/rest-api
    console.log("[notification] KAKAO_API_KEY 설정됨 (알림톡 API 연동 예정)");
  }

  return { ok: true, sentVia: "console" };
}

/** 품절 임박 핵심 품목 확인 후 알림 발송 */
export async function checkAndNotifyCriticalStockout(
  products: InventoryProduct[],
  stockByProduct: Record<string, number>,
  safetyStockByProduct: Record<string, number>,
  options?: { dashboardUrl?: string }
): Promise<{ alerted: number; result: Awaited<ReturnType<typeof sendStockAlert>> }> {
  const items = getCriticalStockoutItems(
    products,
    stockByProduct,
    safetyStockByProduct
  );

  if (items.length === 0) {
    return { alerted: 0, result: { ok: true } };
  }

  const message = buildAlertMessage(items, options?.dashboardUrl);
  const result = await sendStockAlert(message);
  return { alerted: items.length, result };
}
