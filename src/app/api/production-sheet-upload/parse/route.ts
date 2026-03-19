/**
 * @deprecated 웹 UI 승인 기반 구조로 전환됨.
 * POST /api/production-sheet-validate 사용
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "이 API는 deprecated입니다. POST /api/production-sheet-validate 를 사용하세요.",
      redirect: "/api/production-sheet-validate",
    },
    { status: 410 }
  );
}
