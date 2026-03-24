/**
 * 출고 행 — 파일명 기대 월(YYYY-MM)과 outbound_date 월 일치 검증 (25-04 등 월별 파일)
 */

import { defaultDateFromFilename, monthYearFromFilename } from "@/lib/excelParser/parser";

export type OutboundRowLike = {
  outbound_date?: string;
  quantity?: number;
  total_price?: number;
};

export type OutboundMonthValidation = {
  outboundDatePeriodValid: boolean;
  /** 파일명에서 추출한 YYYY-MM (없으면 undefined) */
  filenameExpectedMonth?: string;
  /** 고유 출고일(YYYY-MM-DD) 정렬 */
  outboundDates: string[];
  outboundTotalQty: number;
  /** 엑셀 합계 열 합(없으면 0) — DB 적재 total과 다를 수 있음 */
  outboundTotalAmountExcel: number;
  /** 기대 월이 아닌 행 수 */
  outboundOutsideMonthCount: number;
  outboundOutsideMonthRatio: number;
  outboundDateMismatchReason?: string;
};

/** 기대 월 외 출고가 전체의 10% 초과이거나 50건 이상이면 차단 */
const OUTSIDE_RATIO_BLOCK = 0.1;
const OUTSIDE_COUNT_BLOCK = 50;

/**
 * 파일명에 YYYY-MM 등이 있으면, 해당 월이 아닌 출고 행이 과다하면 invalid.
 * 파일명 힌트가 없으면 검증 통과(출고 시트만 신뢰).
 */
export function validateOutboundDatesForFilenameMonth(
  filename: string,
  outbound: OutboundRowLike[]
): OutboundMonthValidation {
  const fileDay = defaultDateFromFilename(filename);
  const refYm = fileDay ? fileDay.slice(0, 7) : monthYearFromFilename(filename) ?? undefined;

  const outboundTotalQty = outbound.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const outboundTotalAmountExcel = outbound.reduce((s, r) => s + (Number(r.total_price) || 0), 0);

  const outboundDates = [
    ...new Set(
      outbound
        .map((r) => String(r.outbound_date ?? "").trim().slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    ),
  ].sort();

  if (!refYm || outbound.length === 0) {
    return {
      outboundDatePeriodValid: true,
      filenameExpectedMonth: refYm,
      outboundDates,
      outboundTotalQty,
      outboundTotalAmountExcel,
      outboundOutsideMonthCount: 0,
      outboundOutsideMonthRatio: 0,
    };
  }

  let outside = 0;
  for (const r of outbound) {
    const ymd = String(r.outbound_date ?? "").trim().slice(0, 10);
    const ym = ymd.length >= 7 ? ymd.slice(0, 7) : "";
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      outside++;
      continue;
    }
    if (ym !== refYm) outside++;
  }

  const ratio = outbound.length ? outside / outbound.length : 0;
  const tooMany = outside >= OUTSIDE_COUNT_BLOCK || ratio > OUTSIDE_RATIO_BLOCK;
  let reason: string | undefined;
  if (tooMany) {
    reason = `출고 ${outbound.length}건 중 기대 월(${refYm})이 아닌 행 ${outside}건(${Math.round(ratio * 100)}%). 출고일 열·파일명을 확인하세요.`;
  }

  return {
    outboundDatePeriodValid: !tooMany,
    filenameExpectedMonth: refYm,
    outboundDates,
    outboundTotalQty,
    outboundTotalAmountExcel,
    outboundOutsideMonthCount: outside,
    outboundOutsideMonthRatio: ratio,
    outboundDateMismatchReason: reason,
  };
}
