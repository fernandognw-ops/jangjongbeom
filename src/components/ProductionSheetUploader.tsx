"use client";

import { useState, useCallback } from "react";
import { useInventory } from "@/context/InventoryContext";

const ACCEPT = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

interface ValidationResult {
  rawdataCount: number;
  inboundCount: number;
  outboundCount: number;
  outboundParsedCount?: number;
  outboundTrace?: { rawRows?: number; parsedRows: number; filteredOut?: number };
  stockCount: number;
  totalStockValue: number;
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
}

interface ParsedData {
  previewToken: string;
}

export function ProductionSheetUploader() {
  const { refresh } = useInventory();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "validated" | "applying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [validateWarnings, setValidateWarnings] = useState<string[]>([]);

  const reset = useCallback(() => {
    setFile(null);
    setValidation(null);
    setParsedData(null);
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
      setStatus("parsing");
      setProgress("서버에서 파싱 중…");

      try {
        const formData = new FormData();
        formData.append("file", f);

        const res = await fetch("/api/production-sheet-validate", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();

        if (!res.ok) {
          setStatus("error");
          setMessage(json.error ?? `검증 실패 (${res.status})`);
          if (json.validation) setValidation(json.validation);
          setProgress("");
          return;
        }

        if (!json.ok || !json.validation || !json.previewToken) {
          setStatus("error");
          setMessage("검증 결과 형식 오류");
          setProgress("");
          return;
        }

        setValidation(json.validation);
        setParsedData({ previewToken: json.previewToken });
        setFilename(f.name);
        setValidateWarnings(Array.isArray(json.warnings) ? json.warnings : []);
        setStatus("validated");
        setProgress("");
        setMessage("");
      } catch (e) {
        setStatus("error");
        setProgress("");
        setMessage(e instanceof Error ? e.message : "파싱 중 오류가 발생했습니다.");
      }
    },
    [reset]
  );

  const handleApply = useCallback(async () => {
    if (!parsedData || !validation?.destWarehouseValid) return;
    if ((validation.stockCount ?? 0) > 0 && validation.snapshotDateValid === false) return;

    setStatus("applying");
    setProgress("DB 반영 중…");

    try {
      const res = await fetch("/api/production-sheet-commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-source": "web",
        },
        body: JSON.stringify({ previewToken: parsedData.previewToken }),
      });
      const json = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? `반영 실패 (${res.status})`);
        setProgress("");
        return;
      }

      setStatus("success");
      const parts: string[] = [];
      if ((json.inbound?.inserted ?? 0) > 0) parts.push(`입고 ${json.inbound.inserted}건`);
      if ((json.outbound?.inserted ?? 0) > 0) parts.push(`출고 ${json.outbound.inserted}건`);
      if ((json.stockSnapshot ?? 0) > 0) parts.push(`재고 ${json.stockSnapshot}건`);
      setMessage(`DB 갱신 완료. ${parts.join(", ")}`);
      setProgress("");

      try {
        await new Promise((r) => setTimeout(r, 1500));
        await refresh();
      } catch (e) {
        console.warn("[업로드] 새로고침 실패:", e);
      }

      reset();
    } catch (e) {
      setStatus("error");
      setProgress("");
      setMessage(e instanceof Error ? e.message : "반영 중 오류가 발생했습니다.");
    }
  }, [parsedData, validation, refresh, reset]);

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

  const snapshotOk =
    !validation ||
    (validation.stockCount ?? 0) === 0 ||
    validation.snapshotDateValid !== false;
  const periodOk = validation?.uploadPeriodValid !== false;
  const canApply =
    validation?.destWarehouseValid &&
    periodOk &&
    snapshotOk &&
    parsedData?.previewToken &&
    status === "validated";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 md:text-base">
        생산수불현황 업로드 (웹 UI 승인 기반)
      </h2>
      <p className="mt-1 text-xs text-slate-500 md:text-sm">
        1단계: 파일 업로드 → 서버 검증 → 2단계: DB 반영 클릭
      </p>
      <p className="mt-0.5 text-xs text-slate-500 md:text-sm">
        웹 UI 승인 경로만 DB 반영 (로컬 스크립트·직접 API 호출 차단)
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
          {status === "parsing" || status === "applying" ? (
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm text-indigo-600">{progress || (status === "parsing" ? "파싱 중…" : "DB 반영 중…")}</span>
            </div>
          ) : status === "validated" ? (
            <span className="text-sm font-medium text-emerald-600">{filename} — 검증 완료, DB 반영 버튼 클릭</span>
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
      {validation && (status === "validated" || status === "error") && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">업로드 전 검증</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {status === "error" ? "검증 실패 상세 (아래 값 확인)" : "이상 없을 때만 DB 반영 버튼 활성화"}
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
            <dd className="font-mono">{validation.totalStockValue.toLocaleString()}원</dd>
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
              onClick={handleApply}
              disabled={!canApply}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                canApply
                  ? "bg-indigo-500 text-white hover:bg-indigo-600"
                  : "cursor-not-allowed bg-slate-300 text-slate-500"
              }`}
            >
              DB 반영
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              취소
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
