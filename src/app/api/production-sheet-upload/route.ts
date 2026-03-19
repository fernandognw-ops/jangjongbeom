/**
 * @deprecated 웹 UI 승인 기반 구조로 전환됨.
 * POST /api/production-sheet-validate → 검증 후 previewToken 발급
 * POST /api/production-sheet-commit → previewToken으로 DB 반영
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "이 API는 deprecated입니다. validate → commit 흐름을 사용하세요.",
      redirect: {
        validate: "/api/production-sheet-validate",
        commit: "/api/production-sheet-commit",
      },
    },
    { status: 410 }
  );
}
