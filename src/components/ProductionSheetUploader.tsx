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
        if (json.inbound?.upserted > 0) parts.push(`입고 ${json.inbound.upserted}건`);
        if (json.outbound?.upserted > 0) parts.push(`출고 ${json.outbound.upserted}건`);
        if (json.stockSnapshot > 0) parts.push(`재고 ${json.stockSnapshot}건`);
        setMessage(`DB 갱신 완료. ${parts.join(", ")}`);
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
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 md:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 md:text-base">
        생산수불현황 업로드
      </h2>
      <p className="mt-1 text-xs text-zinc-500 md:text-sm">
        담당자가 매일 아침 집계한 생산수불현황.xlsx를 드래그 앤 드롭하여 DB를 갱신합니다.
      </p>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`relative mt-4 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors md:min-h-[180px] ${
          isDragging
            ? "border-cyan-500 bg-cyan-500/10"
            : "border-zinc-600 bg-zinc-800/50 hover:border-zinc-500 hover:bg-zinc-800/70"
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
              <span className="text-sm text-cyan-400">{progress || (status === "parsing" ? "파일 파싱 중…" : "DB 저장 중…")}</span>
              <span className="text-xs text-zinc-500">{status === "parsing" ? "날짜 변환 중…" : "배치 저장 중…"}</span>
            </div>
          ) : file ? (
            <span className="text-sm font-medium text-cyan-400">{file.name}</span>
          ) : (
            <>
              <span className="text-4xl text-zinc-500" aria-hidden>
                📄
              </span>
              <span className="mt-2 text-sm text-zinc-400">
                생산수불현황.xlsx를 여기에 드래그하거나 클릭하여 선택
              </span>
              <span className="mt-1 text-xs text-zinc-500">
                입고·출고·재고 시트 필수
              </span>
            </>
          )}
        </label>
      </div>

      {message && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            status === "error"
              ? "border border-red-500/40 bg-red-500/10 text-red-300"
              : status === "success"
                ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border border-zinc-600 bg-zinc-800/50 text-zinc-300"
          }`}
          role="alert"
        >
          {message}
        </div>
      )}
    </div>
  );
}
