/**
 * 생산수불 재고 스냅샷 — 파일명 vs 파싱된 snapshot_date 검증 (웹 업로드)
 */

import { defaultDateFromFilename, monthYearFromFilename } from "@/lib/excelParser/parser";

export type StockSnapshotLike = { snapshot_date?: string };

export type SnapshotDateValidation = {
  snapshotDateValid: boolean;
  /** 파일명에서 추출한 YYYY-MM-DD (없으면 undefined) */
  filenameExpectedDate?: string;
  /** 기대 월 YYYY-MM (파일명 또는 추출) */
  filenameExpectedMonth?: string;
  /** YYYY-MM-DD / YYYYMMDD / YYYY-MM / ○년○월 등 */
  filenameHasDatePattern: boolean;
  snapshotDateMismatchReason?: string;
};

export type SnapshotFilenameValidateOptions = {
  /** false면 재고 행이 있는데 기준일 열을 못 찾은 경우 — DB 반영 금지 */
  stockDateColumnFound?: boolean;
};

/**
 * 파일명에 년·월·일 힌트가 있으면, 재고 snapshot_date의 달력 월이 그것과 일치해야 함.
 * 파일명 힌트가 없으면 통과(재고 시트 기준일만 신뢰).
 */
export function validateSnapshotDatesAgainstFilename(
  filename: string,
  stockSnapshot: StockSnapshotLike[],
  opts?: SnapshotFilenameValidateOptions
): SnapshotDateValidation {
  const fileDay = defaultDateFromFilename(filename);
  const refYm = fileDay ? fileDay.slice(0, 7) : monthYearFromFilename(filename) ?? undefined;
  const hasPattern = !!refYm;

  if (stockSnapshot.length === 0) {
    return {
      snapshotDateValid: true,
      filenameHasDatePattern: hasPattern,
      filenameExpectedDate: fileDay,
      filenameExpectedMonth: refYm,
    };
  }

  if (opts?.stockDateColumnFound === false) {
    return {
      snapshotDateValid: false,
      filenameHasDatePattern: hasPattern,
      filenameExpectedDate: fileDay,
      filenameExpectedMonth: refYm,
      snapshotDateMismatchReason:
        "재고 시트에서 기준일(기준일자·재고일자 등) 열을 찾지 못했습니다. 「일자」 동의어가 입고일자 열만 선택되는 문제를 막기 위해 전용 매칭을 사용합니다 — 헤더를 확인하세요.",
    };
  }

  const months = new Set(
    stockSnapshot
      .map((r) => String(r.snapshot_date ?? "").trim().slice(0, 7))
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
  );

  if (months.size === 0) {
    return {
      snapshotDateValid: false,
      filenameHasDatePattern: hasPattern,
      filenameExpectedDate: fileDay,
      filenameExpectedMonth: refYm,
      snapshotDateMismatchReason: "재고 snapshot_date가 비어 있거나 형식이 아닙니다.",
    };
  }

  if (months.size > 1) {
    return {
      snapshotDateValid: false,
      filenameHasDatePattern: hasPattern,
      filenameExpectedDate: fileDay,
      filenameExpectedMonth: refYm,
      snapshotDateMismatchReason: `한 파일에 서로 다른 달의 snapshot_date가 섞여 있습니다: ${[...months].sort().join(", ")}`,
    };
  }

  const onlyYm = [...months][0];

  if (!refYm) {
    return {
      snapshotDateValid: true,
      filenameHasDatePattern: false,
      filenameExpectedMonth: onlyYm,
    };
  }

  if (onlyYm !== refYm) {
    return {
      snapshotDateValid: false,
      filenameHasDatePattern: true,
      filenameExpectedDate: fileDay,
      filenameExpectedMonth: refYm,
      snapshotDateMismatchReason: `파싱된 재고 기준일 월(${onlyYm})이 파일명에서 기대한 월(${refYm})과 다릅니다. 시트 「기준일자」·파일명을 확인하세요.`,
    };
  }

  return {
    snapshotDateValid: true,
    filenameHasDatePattern: true,
    filenameExpectedDate: fileDay,
    filenameExpectedMonth: refYm,
  };
}
