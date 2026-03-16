"use client";

import { useState, useCallback } from "react";
import { parseProductionSheet } from "@/lib/productionSheetParser";
import { useInventory } from "@/context/InventoryContext";

const ACCEPT = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

function yearFromFilename(name: string): number | null {
  if (/26년|2026|_26\b|\(26\)/.test(name)) return 2026;
  if (/25년|2025|_25\b|\(25\)/.test(name)) return 2025;
  return null;
}

export function ProductionSheetUploader() {
  const { refresh } = useInventory();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    async (f: File | null) => {
      setFile(f);
      setMessage("");
      setProgress("");
      setStatus("idle");
      if (!f) return;

      const yearHint = yearFromFilename(f.name);

      setStatus("parsing");
      setProgress(yearHint ? `${yearHint}년 데이터 파싱 중…` : "파일 파싱 중…");
      const result = await parseProductionSheet(f);

      if (!result.ok) {
        setStatus("error");
        setMessage(result.message);
        setProgress("");
        return;
      }

      if (
        result.inbound.length === 0 &&
        result.outbound.length === 0 &&
        result.stockSnapshot.length === 0
      ) {
        setStatus("error");
        setMessage("입고·출고·재고 시트에서 유효한 데이터를 찾을 수 없습니다.");
        setProgress("");
        return;
      }

      const year = result.yearInferred ?? yearHint;
      const total = result.inbound.length + result.outbound.length + result.stockSnapshot.length;

      setStatus("uploading");
      setProgress(year ? `${year}년 데이터 DB 저장 중… (입고 ${result.inbound.length}건, 출고 ${result.outbound.length}건)` : `DB 저장 중… (총 ${total}건)`);
      try {
        const res = await fetch("/api/production-sheet-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inbound: result.inbound,
            outbound: result.outbound,
            stockSnapshot: result.stockSnapshot,
            currentProductCodes: result.currentProductCodes,
          }),
        });
        const json = await res.json();

        if (!res.ok) {
          setStatus("error");
          setMessage(json.error ?? `업로드 실패 (${res.status})`);
          return;
        }

        setStatus("success");
        setProgress("");
        const parts: string[] = [];
        if ((json.inbound?.inserted ?? 0) > 0) parts.push(`입고 ${json.inbound.inserted}건`);
        if ((json.outbound?.inserted ?? 0) > 0) parts.push(`출고 ${json.outbound.inserted}건`);
        if ((json.stockSnapshot ?? 0) > 0) parts.push(`재고 ${json.stockSnapshot}건`);
        setMessage(`DB 갱신 완료. ${parts.join(", ")} 대시보드가 자동으로 새로고침됩니다.`);
        setFile(null);
        refresh();
      } catch (e) {
        setStatus("error");
        setProgress("");
        setMessage(e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.");
      }
    },
    [refresh]
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
        생산수불현황 업로드
      </h2>
      <p className="mt-1 text-xs text-slate-500 md:text-sm">
        담당자가 매일 아침 집계한 생산수불현황.xlsx를 드래그 앤 드롭하여 DB를 갱신합니다.
      </p>
      <p className="mt-0.5 text-xs text-slate-500 md:text-sm">
        노형우 과장 수불 붙여넣기 — 중복은 알아서 거름
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
          {status === "parsing" || status === "uploading" ? (
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm text-indigo-600">{progress || (status === "parsing" ? "파일 파싱 중…" : "DB 저장 중…")}</span>
              <span className="text-xs text-slate-500">{status === "parsing" ? "날짜 변환 중…" : "배치 저장 중…"}</span>
            </div>
          ) : file ? (
            <span className="text-sm font-medium text-indigo-600">{file.name}</span>
          ) : (
            <>
              <span className="text-4xl text-slate-400" aria-hidden>
                📄
              </span>
              <span className="mt-2 text-sm text-slate-600">
                생산수불현황.xlsx를 여기에 드래그하거나 클릭하여 선택
              </span>
              <span className="mt-1 text-xs text-slate-500">
                입고·출고·재고 시트 필수
              </span>
            </>
          )}
        </label>
      </div>

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
