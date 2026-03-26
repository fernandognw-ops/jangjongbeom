/**
 * 생산수불 웹 업로드 — 파싱 직후 자동 검증 (commit 전).
 * month key: YYYY-MM. 집계 기준은 outboundAmountSelection과 동일.
 */

import { normalizeValue } from "@/lib/excelParser/classifier";
import {
  chosenOutboundAmount,
  parseMoney,
  type ChosenAmountSource,
} from "@/lib/outboundAmountSelection";
import type { InboundRow, OutboundRow, StockSnapshotRow } from "@/lib/productionSheetParser";
import type { OutboundSheetDateDiagnostics } from "@/lib/excelParser/parser";
import type { OutboundMonthValidation } from "@/lib/outboundUploadValidation";

function norm(s: string): string {
  return normalizeValue(s);
}

function isInvalidTotalHeaderLike(header: string): boolean {
  const n = norm(header || "");
  return n.includes(norm("단가")) || n.includes(norm("원가"));
}

function monthKeyFromYmd(ymd: string | undefined): string {
  const d = String(ymd ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(0, 7) : "";
}

function countRowsByMonth<T>(rows: T[], getYmd: (r: T) => string | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const mk = monthKeyFromYmd(getYmd(r));
    if (!mk) continue;
    m[mk] = (m[mk] ?? 0) + 1;
  }
  return m;
}

const OUTSIDE_RATIO_BLOCK = 0.1;
const OUTSIDE_COUNT_BLOCK = 50;

function outsideMonthCount<T>(
  rows: T[],
  getYmd: (r: T) => string | undefined,
  refYm: string | undefined
): number {
  if (!refYm || rows.length === 0) return 0;
  let n = 0;
  for (const r of rows) {
    const ymd = String(getYmd(r) ?? "").trim().slice(0, 10);
    const ym = ymd.length >= 7 ? ymd.slice(0, 7) : "";
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      n++;
      continue;
    }
    if (ym !== refYm) n++;
  }
  return n;
}

export type UploadAutoValidationReport = {
  targetMonthKey: string | null;
  monthRowCounts: {
    inbound: Record<string, number>;
    outbound: Record<string, number>;
    snapshot: Record<string, number>;
  };
  sums: {
    sumOutboundTotalAmountField: number;
    sumTotalPrice: number;
    sumUnitPriceXQty: number;
  };
  /** chosenOutboundAmount 기준 행별 합(마스터 원가 없음) */
  chosenSum: number;
  outboundTotalEqualsUnitPriceRowCount: number;
  outboundTotalEqualsUnitPriceSamples: Array<{
    product_code: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  channelAmountsKrw: { 일반: number; 쿠팡: number };
  sourceSelection: {
    rowCounts: Record<ChosenAmountSource, number>;
    sumAmountBySource: Record<ChosenAmountSource, number>;
    outboundTotalAmountVsTotalPriceRatio: number | null;
  };
  inboundOutsideTargetMonth: number;
  snapshotOutsideTargetMonth: number;
  anomalyRowCount: number;
  blockReasons: string[];
};

const emptySourceRecord = (): Record<ChosenAmountSource, number> => ({
  outbound_total_amount: 0,
  total_price: 0,
  unit_price_x_qty: 0,
  master_unit_cost_x_qty: 0,
  fallback_0: 0,
});

export function runUploadAutoValidation(input: {
  filename: string;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stockSnapshot: StockSnapshotRow[];
  outboundDateDiagnostics: OutboundSheetDateDiagnostics | undefined;
  outboundMonthValidation: OutboundMonthValidation;
  outboundRawRowCount: number | undefined;
}): UploadAutoValidationReport {
  const {
    inbound,
    outbound,
    stockSnapshot,
    outboundDateDiagnostics,
    outboundMonthValidation,
    outboundRawRowCount,
  } = input;

  const refYm = outboundMonthValidation.filenameExpectedMonth ?? null;

  const monthRowCounts = {
    inbound: countRowsByMonth(inbound, (r) => r.inbound_date),
    outbound: countRowsByMonth(outbound, (r) => r.outbound_date),
    snapshot: countRowsByMonth(stockSnapshot, (r) => r.snapshot_date),
  };

  const sumTotalPrice = outbound.reduce((s, r) => s + parseMoney(r.total_price), 0);
  const sumOutboundTotalAmountField = outbound.reduce((s, r) => s + parseMoney(r.outbound_total_amount ?? r.total_price), 0);
  const sumUnitPriceXQty = outbound.reduce(
    (s, r) => s + parseMoney(r.unit_price) * (Number(r.quantity) || 0),
    0
  );

  const emptyMaster = new Map<string, number>();
  const rowCounts = emptySourceRecord();
  const sumAmountBySource = emptySourceRecord();
  let chosenSum = 0;
  let outboundTotalEqualsUnitPriceRowCount = 0;
  const outboundTotalEqualsUnitPriceSamples: UploadAutoValidationReport["outboundTotalEqualsUnitPriceSamples"] = [];

  const channelAmountsKrw = { 일반: 0, 쿠팡: 0 };

  for (const r of outbound) {
    const ota = parseMoney(r.outbound_total_amount);
    const tp = parseMoney(r.total_price);
    const up = parseMoney(r.unit_price);
    const qty = Number(r.quantity) || 0;
    if (qty > 1 && up > 0 && (ota > 0 || tp > 0)) {
      const lineTotal = ota > 0 ? ota : tp;
      // 수량 1이면 합계=단가×1 이라 동일한 것이 정상(동일 품번·단가라도 판매 채널이 다르면 별도 행).
      // 수량>1 인데 합계≈단가만 '합계 열에 단가만 입력' 의심.
      if (Math.abs(lineTotal - up) < 0.01) {
        outboundTotalEqualsUnitPriceRowCount++;
        if (outboundTotalEqualsUnitPriceSamples.length < 15) {
          outboundTotalEqualsUnitPriceSamples.push({
            product_code: r.product_code,
            quantity: qty,
            unit_price: up,
            total_price: lineTotal,
          });
        }
      }
    }

    const chosen = chosenOutboundAmount(
      {
        quantity: r.quantity,
        outbound_total_amount: r.outbound_total_amount,
        total_price: r.total_price,
        unit_price: r.unit_price,
      },
      r.product_code,
      emptyMaster
    );
    chosenSum += chosen.amount;
    rowCounts[chosen.source]++;
    sumAmountBySource[chosen.source] += chosen.amount;

    channelAmountsKrw[r.channel] += chosen.amount;
  }

  const otaRows = rowCounts.outbound_total_amount;
  const tpRows = rowCounts.total_price;
  const mix = otaRows + tpRows;
  const outboundTotalAmountVsTotalPriceRatio =
    mix > 0 ? otaRows / mix : null;

  const inboundOutsideTargetMonth = outsideMonthCount(inbound, (r) => r.inbound_date, refYm ?? undefined);
  const snapshotOutsideTargetMonth = outsideMonthCount(stockSnapshot, (r) => r.snapshot_date, refYm ?? undefined);

  const inboundOutsideRatio = inbound.length ? inboundOutsideTargetMonth / inbound.length : 0;
  const snapOutsideRatio = stockSnapshot.length ? snapshotOutsideTargetMonth / stockSnapshot.length : 0;

  const avgTotal =
    outbound.length > 0 ? sumOutboundTotalAmountField / outbound.length : 0;
  const ratioUnitOverTotal =
    sumOutboundTotalAmountField > 0 ? sumUnitPriceXQty / sumOutboundTotalAmountField : null;

  const idxTotalFound = outboundDateDiagnostics?.outboundTotalAmountColumnFound === true;
  const totalHeader = outboundDateDiagnostics?.outboundTotalAmountColumnHeader ?? "";
  const headerLooksLikeUnitCost = isInvalidTotalHeaderLike(totalHeader);

  let anomalyRowCount =
    outboundTotalEqualsUnitPriceRowCount +
    (outboundDateDiagnostics?.outboundTotalAmountSamples ?? []).filter((s) => s.invalidBySanity).length;

  anomalyRowCount += outboundMonthValidation.outboundOutsideMonthCount;

  const blockReasons: string[] = [];

  if (outbound.length > 0 && !idxTotalFound) {
    blockReasons.push("합계금액 열 탐지 실패 (출고 시트 합계금액 후보 열 없음)");
  }
  if (headerLooksLikeUnitCost && idxTotalFound) {
    blockReasons.push(`합계금액 열로 선택된 헤더가 단가/원가 의심: "${totalHeader}"`);
  }
  if (outboundTotalEqualsUnitPriceRowCount > 0) {
    blockReasons.push(
      `합계금액이 단가(unit_price)와 동일한 행 ${outboundTotalEqualsUnitPriceRowCount}건 (합계 열에 단가가 들어갔을 수 있음)`
    );
  }
  if (ratioUnitOverTotal !== null && ratioUnitOverTotal >= 100 && avgTotal < 1000) {
    blockReasons.push("unit_price×qty 대비 합계금액 비율 비정상 (합계 열에 단가만 들어간 패턴 의심)");
  }
  if (outboundTotalAmountVsTotalPriceRatio !== null && otaRows > 0 && tpRows > 0) {
    const minShare = Math.min(otaRows, tpRows) / outbound.length;
    if (minShare >= 0.25) {
      blockReasons.push(
        `source selection 비정상 혼합: outbound_total_amount 행 ${otaRows}건, total_price 행 ${tpRows}건 (동일 파일 내 금액 기준 불일치)`
      );
    }
  }
  const fallbackRows = rowCounts.fallback_0;
  if (fallbackRows > 0 && outbound.length > 0) {
    blockReasons.push(
      `금액 산출 실패(fallback) 행 ${fallbackRows}건 (합계·단가·수량 확인)`
    );
  }

  if (refYm) {
    if (inboundOutsideTargetMonth > 0) {
      const bad = inboundOutsideRatio > OUTSIDE_RATIO_BLOCK || inboundOutsideTargetMonth >= OUTSIDE_COUNT_BLOCK;
      if (bad) {
        blockReasons.push(
          `입고일이 대상 월(${refYm})이 아닌 행 ${inboundOutsideTargetMonth}건 (${Math.round(inboundOutsideRatio * 100)}%)`
        );
      }
    }
    if (snapshotOutsideTargetMonth > 0) {
      const bad = snapOutsideRatio > OUTSIDE_RATIO_BLOCK || snapshotOutsideTargetMonth >= OUTSIDE_COUNT_BLOCK;
      if (bad) {
        blockReasons.push(
          `재고 snapshot_date가 대상 월(${refYm})이 아닌 행 ${snapshotOutsideTargetMonth}건 (${Math.round(snapOutsideRatio * 100)}%)`
        );
      }
    }
  }

  const rawLost =
    (outboundRawRowCount ?? 0) > 5 &&
    outbound.length === 0 &&
    outboundDateDiagnostics?.outboundDateColumnFound === false;
  if (rawLost) {
    blockReasons.push("출고 원본 행은 있는데 유효 출고 0건 (출고일/품번 열 누락)");
  }

  return {
    targetMonthKey: refYm,
    monthRowCounts,
    sums: {
      sumOutboundTotalAmountField,
      sumTotalPrice,
      sumUnitPriceXQty,
    },
    chosenSum,
    outboundTotalEqualsUnitPriceRowCount,
    outboundTotalEqualsUnitPriceSamples,
    channelAmountsKrw,
    sourceSelection: {
      rowCounts,
      sumAmountBySource,
      outboundTotalAmountVsTotalPriceRatio,
    },
    inboundOutsideTargetMonth,
    snapshotOutsideTargetMonth,
    anomalyRowCount,
    blockReasons,
  };
}
