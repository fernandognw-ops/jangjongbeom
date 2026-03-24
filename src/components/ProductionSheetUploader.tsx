"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useInventory } from "@/context/InventoryContext";

const ACCEPT = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

interface ValidationResult {
  rawdataCount: number;
  inboundCount: number;
  outboundCount: number;
  outboundParsedCount?: number;
  outboundTrace?: { rawRows?: number; parsedRows: number; filteredOut?: number };
  stockCount: number;
  totalStockValue?: number;
  destWarehouseDistribution: Record<string, number>;
  destWarehouseBySource?: { inbound: Record<string, number>; outbound: Record<string, number>; stock: Record<string, number> };
  snapshotDates: string[];
  destWarehouseValid: boolean;
  invalidDestWarehouses: string[];
  /** false면 DB 반영 불가 (재고 snapshot_date ↔ 파일명 월 불일치 등) */
  snapshotDateValid?: boolean;
  filenameHasDatePattern?: boolean;
  filenameExpectedDate?: string;
  filenameExpectedMonth?: string;
  snapshotDateMismatchReason?: string;
  snapshotLooksLikeServerTodayOnly?: boolean;
  stockDateColumnFound?: boolean;
  stockDateColumnHeader?: string;
  outboundDates?: string[];
  outboundTotalQty?: number;
  outboundTotalAmountExcel?: number;
  outboundDatePeriodValid?: boolean;
  outboundOutsideMonthCount?: number;
  outboundOutsideMonthRatio?: number;
  outboundDateMismatchReason?: string;
  outboundDateColumnFound?: boolean;
  outboundDateColumnHeader?: string;
  outboundRawRowCount?: number;
  uploadPeriodValid?: boolean;
  outboundChannelBreakdown?: Record<string, number>;
  outboundSalesChannelColumnFound?: boolean;
  outboundSalesChannelColumnHeader?: string;
  outboundSalesChannelClassifiedRaw?: { coupang: string[]; general: string[] };
  outboundSalesChannelGeneralWithCoupangHint?: string[];
  outboundSumTotalAmountParsed?: number;
  outboundSumUnitPriceXQty?: number;
  outboundTotalAmountColumnFound?: boolean;
  outboundTotalAmountColumnHeader?: string;
  autoValidation?: {
    targetMonthKey?: string | null;
    monthRowCounts?: { inbound: Record<string, number>; outbound: Record<string, number>; snapshot: Record<string, number> };
    sums?: { sumOutboundTotalAmountField: number; sumTotalPrice: number; sumUnitPriceXQty: number };
    chosenSum?: number;
    channelAmountsKrw?: { 일반: number; 쿠팡: number };
    sourceSelection?: {
      rowCounts?: Record<string, number>;
      sumAmountBySource?: Record<string, number>;
      outboundTotalAmountVsTotalPriceRatio?: number | null;
    };
    outboundTotalEqualsUnitPriceRowCount?: number;
    outboundTotalEqualsUnitPriceSamples?: Array<{
      product_code: string;
      quantity: number;
      unit_price: number;
      total_price: number;
    }>;
    anomalyRowCount?: number;
    blockReasons?: string[];
  };
}

export function ProductionSheetUploader() {
  const { refresh } = useInventory();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "validating" | "applying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [validateWarnings, setValidateWarnings] = useState<string[]>([]);

  const reset = useCallback(() => {
    setFile(null);
    setValidation(null);
    setFilename("");
    setValidateWarnings([]);
    setMessage("");
    setProgress("");
    setStatus("idle");
  }, []);

  const handleFile = useCallback(
    async (f: File | null) => {
      reset();
      if (!f) return;

      setFile(f);
      setStatus("uploading");
      setProgress("파일 업로드 중…");

      try {
        const formData = new FormData();
        formData.append("file", f);
        setStatus("validating");
        setProgress("검증 중…");

        const res = await fetch("/api/production-sheet-validate", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();

        if (!res.ok) {
          setStatus("error");
          setMessage(json.error ?? `검증 실패 (${res.status})`);
          if (json.validation) setValidation(json.validation);
          setFilename(f.name);
          setValidateWarnings(Array.isArray(json.warnings) ? json.warnings : []);
          setProgress("");
          return;
        }

        if (!json.ok || !json.validation) {
          setStatus("error");
          setMessage(json.error ?? "검증 결과 형식 오류");
          setProgress("");
          return;
        }

        setValidation(json.validation);
        setFilename(f.name);
        setValidateWarnings(Array.isArray(json.warnings) ? json.warnings : []);
        setStatus("success");
        const ac = json.autoCommit;
        if (ac?.executed && ac?.result) {
          setMessage(
            `자동 반영 완료. 입고 ${ac.result.inboundInserted}건, 출고 ${ac.result.outboundInserted}건, 재고 ${ac.result.stockSnapshotCount}건`
          );
        } else {
          setMessage("검증은 완료되었지만 자동 반영 결과를 확인하지 못했습니다.");
        }
        setProgress("");
        try {
          await new Promise((r) => setTimeout(r, 1200));
          await refresh();
        } catch (e) {
          console.warn("[업로드] 새로고침 실패:", e);
        }
      } catch (e) {
        setStatus("error");
        setProgress("");
        setMessage(e instanceof Error ? e.message : "파싱 중 오류가 발생했습니다.");
      }
    },
    [refresh, reset]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f && (f.name.endsWith(".xlsx") || f.name.endsWith(".xls"))) {
        handleFile(f);
      } else {
        setStatus("error");
        setMessage("Excel 파일(.xlsx, .xls)만 업로드할 수 있습니다.");
      }
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      handleFile(f ?? null);
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 md:text-base">
        생산수불현황 업로드 (자동 검증·자동 반영)
      </h2>
      <p className="mt-1 text-xs text-slate-500 md:text-sm">
        파일 업로드 1회로 검증 통과 시 자동 DB 반영
      </p>
      <p className="mt-0.5 text-xs text-slate-500 md:text-sm">
        웹 UI 승인 경로만 DB 반영 (로컬 스크립트·직접 API 호출 차단)
      </p>
      <p className="mt-1 text-xs text-slate-500">
        <Link href="/admin/upload-logs" className="text-indigo-600 hover:underline">
          업로드 검증 이력 (관리자)
        </Link>
      </p>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`relative mt-4 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors md:min-h-[180px] ${
          isDragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/50"
        }`}
      >
        <input
          type="file"
          accept={ACCEPT}
          onChange={onInputChange}
          className="absolute inset-0 z-10 cursor-pointer opacity-0"
          id="production-sheet-input"
        />
        <label
          htmlFor="production-sheet-input"
          className="pointer-events-none flex w-full flex-col items-center justify-center px-4 py-6"
        >
          {status === "uploading" || status === "validating" || status === "applying" ? (
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm text-indigo-600">
                {progress ||
                  (status === "uploading"
                    ? "업로드 중…"
                    : status === "validating"
                      ? "검증 중…"
                      : "DB 반영 중…")}
              </span>
            </div>
          ) : status === "success" ? (
            <span className="text-sm font-medium text-emerald-600">{filename} — 자동 반영 완료</span>
          ) : file ? (
            <span className="text-sm font-medium text-indigo-600">{file.name}</span>
          ) : (
            <>
              <span className="text-4xl text-slate-400" aria-hidden>📄</span>
              <span className="mt-2 text-sm text-slate-600">
                생산수불현황.xlsx를 여기에 드래그하거나 클릭하여 선택
              </span>
              <span className="mt-1 text-xs text-slate-500">입고·출고·재고 시트 필수</span>
            </>
          )}
        </label>
      </div>

      {/* 검증 결과 (성공·실패 모두 상세 표시) */}
      {validation && (status === "success" || status === "error") && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">자동 검증 결과</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {status === "error"
              ? "반영 차단 — 아래 차단 사유·금액·행 수를 확인하세요."
              : "검증 통과 후 DB에 반영되었습니다."}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            <dt className="text-slate-500">rawdata 건수</dt>
            <dd className="font-mono">{validation.rawdataCount}건</dd>
            <dt className="text-slate-500">입고 건수</dt>
            <dd className="font-mono">{validation.inboundCount}건</dd>
            <dt className="text-slate-500">출고 건수</dt>
            <dd className="font-mono">
              {validation.outboundTrace && (validation.outboundTrace.filteredOut ?? 0) > 0 ? (
                <>
                  {validation.outboundTrace.rawRows}건 (원본) → {validation.outboundCount}건 (필터 후, {validation.outboundTrace.filteredOut}건 제외)
                </>
              ) : (
                `${validation.outboundCount}건`
              )}
            </dd>
            <dt className="text-slate-500">재고 건수</dt>
            <dd className="font-mono">{validation.stockCount}건</dd>
            <dt className="text-slate-500">재고 총 금액</dt>
            <dd className="font-mono">{(validation.totalStockValue ?? 0).toLocaleString()}원</dd>
            <dt className="text-slate-500">입고+출고+재고 합산 행 기준 채널 분포</dt>
            <dd className="font-mono">
              일반 {validation.destWarehouseDistribution["일반"] ?? 0} / 쿠팡 {validation.destWarehouseDistribution["쿠팡"] ?? 0}
            </dd>
            {validation.destWarehouseBySource && (
              <>
                <dt className="text-slate-500 col-span-2 md:col-span-3 text-xs">센터 분포 상세 (채널 아님)</dt>
                <dd className="col-span-2 md:col-span-3 text-xs text-slate-600">
                  입고: 일반 {(validation.destWarehouseBySource.inbound?.["일반"] ?? 0)} / 쿠팡 {(validation.destWarehouseBySource.inbound?.["쿠팡"] ?? 0)} · 
                  재고: 일반 {(validation.destWarehouseBySource.stock?.["일반"] ?? 0)} / 쿠팡 {(validation.destWarehouseBySource.stock?.["쿠팡"] ?? 0)}
                </dd>
              </>
            )}
            <dt className="text-slate-500">snapshot_date (파싱)</dt>
            <dd className="font-mono text-xs">{validation.snapshotDates.join(", ") || "-"}</dd>
            {validation.filenameExpectedMonth != null && (
              <>
                <dt className="text-slate-500">기대 월 (파일명·파싱)</dt>
                <dd className="font-mono text-xs">
                  {validation.filenameExpectedMonth}
                  {validation.filenameExpectedDate ? ` · 일자 ${validation.filenameExpectedDate}` : ""}
                  {validation.filenameHasDatePattern === false ? " · 파일명에 날짜 패턴 없음" : ""}
                </dd>
              </>
            )}
            <dt className="text-slate-500">출고일 열(헤더)</dt>
            <dd className="font-mono text-xs">{validation.outboundDateColumnHeader || "-"}</dd>
            <dt className="text-slate-500">판매 채널 열(헤더)</dt>
            <dd className="font-mono text-xs">{validation.outboundSalesChannelColumnHeader || "-"}</dd>
            <dt className="text-slate-500">판매 채널 열 인식</dt>
            <dd className="font-mono text-xs">
              {validation.outboundSalesChannelColumnFound === false ? "실패 (DB 반영 불가)" : "성공"}
            </dd>
            <dt className="text-slate-500">출고 날짜(파싱)</dt>
            <dd className="font-mono text-xs">{(validation.outboundDates ?? []).join(", ") || "-"}</dd>
            <dt className="text-slate-500">출고 채널별 수량 (판매 채널 기준)</dt>
            <dd className="font-mono text-xs">
              일반 {validation.outboundChannelBreakdown?.["일반"] ?? 0} · 쿠팡{" "}
              {validation.outboundChannelBreakdown?.["쿠팡"] ?? 0}
            </dd>
            {validation.outboundSumTotalAmountParsed != null && (
              <>
                <dt className="text-slate-500">SUM(total_price) 출고</dt>
                <dd className="font-mono text-xs">{(validation.outboundSumTotalAmountParsed ?? 0).toLocaleString()}원</dd>
                <dt className="text-slate-500">SUM(unit_price×qty)</dt>
                <dd className="font-mono text-xs">{(validation.outboundSumUnitPriceXQty ?? 0).toLocaleString()}원</dd>
              </>
            )}
            {validation.autoValidation?.sums && (
              <>
                <dt className="text-slate-500 col-span-2 md:col-span-3 text-xs font-medium text-slate-600">
                  자동 검증 합계 (동일 금액 선택 규칙)
                </dt>
                <dt className="text-slate-500">합계(outbound_total/total)</dt>
                <dd className="font-mono text-xs">
                  {validation.autoValidation.sums.sumOutboundTotalAmountField.toLocaleString()}원
                </dd>
                <dt className="text-slate-500">SUM(total_price)</dt>
                <dd className="font-mono text-xs">{validation.autoValidation.sums.sumTotalPrice.toLocaleString()}원</dd>
                <dt className="text-slate-500">SUM(unit×qty)</dt>
                <dd className="font-mono text-xs">{validation.autoValidation.sums.sumUnitPriceXQty.toLocaleString()}원</dd>
                <dt className="text-slate-500">채널별 금액(추정)</dt>
                <dd className="font-mono text-xs col-span-1 md:col-span-2">
                  일반 {(validation.autoValidation.channelAmountsKrw?.["일반"] ?? 0).toLocaleString()}원 · 쿠팡{" "}
                  {(validation.autoValidation.channelAmountsKrw?.["쿠팡"] ?? 0).toLocaleString()}원
                </dd>
                <dt className="text-slate-500">월별 행 수 (입고/출고/재고)</dt>
                <dd className="col-span-1 md:col-span-2 font-mono text-[11px] text-slate-700">
                  입고 {JSON.stringify(validation.autoValidation.monthRowCounts?.inbound ?? {})} · 출고{" "}
                  {JSON.stringify(validation.autoValidation.monthRowCounts?.outbound ?? {})} · 스냅{" "}
                  {JSON.stringify(validation.autoValidation.monthRowCounts?.snapshot ?? {})}
                </dd>
                <dt className="text-slate-500">source 분포 (행 수)</dt>
                <dd className="col-span-1 md:col-span-2 font-mono text-[11px]">
                  {JSON.stringify(validation.autoValidation.sourceSelection?.rowCounts ?? {})}
                  {validation.autoValidation.sourceSelection?.outboundTotalAmountVsTotalPriceRatio != null && (
                    <span className="ml-2 text-slate-500">
                      (outbound_total_amount 비중{" "}
                      {Math.round(
                        (validation.autoValidation.sourceSelection.outboundTotalAmountVsTotalPriceRatio ?? 0) * 100
                      )}
                      %)
                    </span>
                  )}
                </dd>
              </>
            )}
            {validation.outboundTotalAmountColumnFound === false && (
              <p className="col-span-2 md:col-span-3 text-xs font-medium text-red-600">
                합계금액 열 미탐지 — 반영 차단 대상입니다.
              </p>
            )}
            {!!validation.autoValidation?.blockReasons?.length && (
              <div className="col-span-2 md:col-span-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs font-semibold text-red-800">차단 사유</p>
                <ul className="mt-1 list-inside list-disc text-xs text-red-900">
                  {validation.autoValidation.blockReasons.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!validation.outboundSalesChannelGeneralWithCoupangHint?.length && (
              <>
                <dt className="text-slate-500 col-span-2 md:col-span-3 text-xs">일반으로 분류됐지만 쿠팡 힌트가 있는 원문</dt>
                <dd className="col-span-2 md:col-span-3 font-mono text-[11px] text-amber-700">
                  {validation.outboundSalesChannelGeneralWithCoupangHint.join(" | ")}
                </dd>
              </>
            )}
          </dl>
          {validateWarnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {validateWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {validation.uploadPeriodValid === false && (
            <p className="mt-2 text-xs font-medium text-red-600">
              기간 검증 실패(uploadPeriodValid) — DB 반영 불가
              {validation.outboundDateMismatchReason ? ` · ${validation.outboundDateMismatchReason}` : ""}
            </p>
          )}
          {(validation.stockCount ?? 0) > 0 && validation.snapshotDateValid === false && validation.snapshotDateMismatchReason && (
            <p className="mt-2 text-xs font-medium text-red-600">
              snapshot_date 검증 실패: {validation.snapshotDateMismatchReason} — DB 반영 불가
            </p>
          )}
          {!validation.destWarehouseValid && (
            <p className="mt-2 text-xs text-red-600">
              dest_warehouse 오류: {validation.invalidDestWarehouses.join(", ")} — 반영 버튼 비활성화
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              초기화
            </button>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 text-sm ${
            status === "error"
              ? "border border-red-200 bg-red-50 text-red-700"
              : status === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-slate-200 bg-slate-50 text-slate-700"
          }`}
          role="alert"
        >
          {message}
        </div>
      )}
    </div>
  );
}
