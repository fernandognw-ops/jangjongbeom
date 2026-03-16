/**
 * 네이버 검색 트렌드 API (서버 사이드 - CORS 회피)
 * GET /api/naver-search-trend
 *
 * 네이버 데이터랩 검색어 트렌드 (WoW + 월별 + 일별)
 * 에러 시 error 필드에 네이버 응답 내용 그대로 포함
 */
import { NextResponse } from "next/server";
import { fetchNaverSearchTrend, fetchNaverSearchTrendMonthly, fetchNaverSearchTrendDaily } from "@/lib/naverSearchTrend";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [weekly, monthly, daily] = await Promise.all([
      fetchNaverSearchTrend(),
      fetchNaverSearchTrendMonthly(),
      fetchNaverSearchTrendDaily(),
    ]);

    return NextResponse.json({
      byCategory: weekly.byCategory,
      monthlyData: monthly,
      dailyData: daily,
      error: weekly.error,
      _debug: {
        hasClientId: !!process.env.NAVER_CLIENT_ID,
        hasClientSecret: !!process.env.NAVER_CLIENT_SECRET,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[naver-search-trend] error:", msg);
    return NextResponse.json(
      { byCategory: {}, monthlyData: {}, dailyData: {}, error: msg },
      { status: 200 }
    );
  }
}
