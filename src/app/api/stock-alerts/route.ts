/**
 * 재고 알림 API
 * GET /api/stock-alerts
 *
 * 재고 가치 1,000만 원 이상 핵심 품목 중 품절 임박인 경우 알림 발송
 * - Vercel Cron 또는 외부 스케줄러에서 호출 (예: 매일 09:00)
 * - 수동 테스트: 브라우저에서 /api/stock-alerts 접속
 */

import { NextResponse } from "next/server";
import {
  fetchInventoryData,
  computeStockByProduct,
  getStockFromSnapshot,
  computeSafetyStockByProduct,
} from "@/lib/inventoryApi";
import { checkAndNotifyCriticalStockout } from "@/services/notificationService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  try {
    const result = await fetchInventoryData();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, message: result.message },
        { status: 500 }
      );
    }

    const { products, inbound, outbound, stockSnapshot } = result.data;
    const snapshotStock = getStockFromSnapshot(
      stockSnapshot?.length ? stockSnapshot : null
    );
    const computedStock = computeStockByProduct(products, inbound, outbound);
    const stockByProduct =
      Object.keys(snapshotStock).length > 0
        ? { ...computedStock, ...snapshotStock }
        : computedStock;
    const safetyStockByProduct = computeSafetyStockByProduct(outbound, products);

    const dashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://jangjongbeom.vercel.app");

    const { alerted, result: sendResult } =
      await checkAndNotifyCriticalStockout(
        products,
        stockByProduct,
        safetyStockByProduct,
        { dashboardUrl }
      );

    return NextResponse.json({
      ok: true,
      alerted,
      sentVia: sendResult.sentVia,
      message:
        alerted > 0
          ? `${alerted}건 품절 임박 핵심 품목 알림 발송`
          : "알림 대상 없음",
    });
  } catch (e) {
    console.error("[stock-alerts] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
