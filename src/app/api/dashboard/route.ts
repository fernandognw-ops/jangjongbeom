/**
 * 대시보드 데이터 API (inventory와 동일)
 * GET /api/dashboard
 *
 * /api/inventory와 동일한 데이터 반환. 404 방지용.
 * 에러 시에도 빈 배열 반환 (500 방지)
 */
import { NextResponse } from "next/server";
import { fetchInventoryData } from "@/lib/inventoryApi";
import { logApiError } from "@/lib/apiErrorLog";

const emptyResponse = {
  products: [] as unknown[],
  inbound: [] as unknown[],
  outbound: [] as unknown[],
  stockSnapshot: [] as unknown[],
};

export async function GET() {
  try {
    const result = await fetchInventoryData();
    if (!result.ok) {
      logApiError("api/dashboard/route.ts", 25, result.message ?? result.reason);
      return NextResponse.json(emptyResponse, { status: 200 });
    }
    const data = result.data ?? {};
    const response = {
      products: Array.isArray(data.products) ? data.products : [],
      inbound: Array.isArray(data.inbound) ? data.inbound : [],
      outbound: Array.isArray(data.outbound) ? data.outbound : [],
      stockSnapshot: Array.isArray(data.stockSnapshot) ? data.stockSnapshot : [],
    };
    console.log(
      `[api/dashboard] DB에서 가져온 전체 품목 수: ${response.products.length}개, 입고: ${response.inbound.length}건, 출고: ${response.outbound.length}건`
    );
    if (response.inbound.length > 0 || response.outbound.length > 0) {
      try {
        const sampleIn = response.inbound[0] as { inbound_date?: string } | undefined;
        const sampleOut = response.outbound[0] as { outbound_date?: string } | undefined;
        const sampleDates = [
          sampleIn?.inbound_date ? { raw: sampleIn.inbound_date, parsed: new Date(sampleIn.inbound_date).toISOString() } : null,
          sampleOut?.outbound_date ? { raw: sampleOut.outbound_date, parsed: new Date(sampleOut.outbound_date).toISOString() } : null,
        ];
        console.log("[api/dashboard] 날짜 파싱 로그 (25-10 등 → 실제 Date):", JSON.stringify(sampleDates));
      } catch {
        // 날짜 로그 실패 시 무시
      }
    }
    return NextResponse.json(response);
  } catch (e) {
    logApiError("api/dashboard/route.ts", 54, e);
    return NextResponse.json(emptyResponse, { status: 200 });
  }
}
