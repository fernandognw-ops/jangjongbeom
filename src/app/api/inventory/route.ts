/**
 * 재고 데이터 API (서버 사이드)
 * GET /api/inventory
 *
 * Supabase inventory_* 테이블 데이터를 서버에서 조회 후 반환.
 * 에러 시에도 빈 배열 반환 (500 방지)
 */
export const dynamic = "force-dynamic";
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
      logApiError("api/inventory/route.ts", 25, result.message ?? result.reason);
      return NextResponse.json(emptyResponse, { status: 200 });
    }
    const data = result.data ?? {};
    const response = {
      products: Array.isArray(data?.products) ? data.products : [],
      inbound: Array.isArray(data?.inbound) ? data.inbound : [],
      outbound: Array.isArray(data?.outbound) ? data.outbound : [],
      stockSnapshot: Array.isArray(data?.stockSnapshot) ? data.stockSnapshot : [],
    };
    console.log(
      `[api/inventory] DB에서 가져온 전체 품목 수: ${response.products.length}개, 입고: ${response.inbound.length}건, 출고: ${response.outbound.length}건, 스냅샷: ${response.stockSnapshot.length}건`
    );
    if (response.inbound.length > 0 || response.outbound.length > 0) {
      try {
        const sampleIn = response.inbound[0] as { inbound_date?: string } | undefined;
        const sampleOut = response.outbound[0] as { outbound_date?: string } | undefined;
        const sampleDates = [
          sampleIn?.inbound_date ? { raw: sampleIn.inbound_date, parsed: new Date(sampleIn.inbound_date).toISOString() } : null,
          sampleOut?.outbound_date ? { raw: sampleOut.outbound_date, parsed: new Date(sampleOut.outbound_date).toISOString() } : null,
        ];
        console.log("[api/inventory] 날짜 파싱 로그 (엑셀 25-10이 실제 어떤 Date로 변환되는지):", JSON.stringify(sampleDates));
      } catch {
        // 날짜 로그 실패 시 무시
      }
    }
    return NextResponse.json(response);
  } catch (e) {
    logApiError("api/inventory/route.ts", 48, e);
    return NextResponse.json(emptyResponse, { status: 200 });
  }
}
