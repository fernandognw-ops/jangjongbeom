"use client";

import { useState, useCallback } from "react";
import { useInventory } from "@/context/InventoryContext";
import {
  parseRawdataProducts,
  parseInboundCsv,
  parseStockCsvToBaseStock,
  parseOutboundCsv,
  type CsvImportTxDraft,
} from "@/lib/csvImport";
import { fileToCsvText } from "@/lib/fileReader";
import { SafetyStockManagement } from "@/components/SafetyStockManagement";
import type { Transaction, StockMap, ItemId } from "@/lib/types";
import type { ProductMasterRow } from "@/lib/types";
import { ITEMS } from "@/lib/types";

function parseStockInput(val: string): number {
  const n = Number.parseInt(String(val).replace(/[,.\s]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** 품목코드/상품명 → 품목코드 매핑 후 Transaction 형태로 변환 */
function draftsToTransactions(
  drafts: CsvImportTxDraft[],
  products: ProductMasterRow[]
): Array<Omit<Transaction, "id" | "createdAt">> {
  const nameToCode = new Map<string, string>();
  for (const p of products) {
    const pname = (p as { name?: string; product_code?: string }).product_code ?? (p as { name?: string }).name;
    const k = normalizeProductKey(pname ?? "");
    if (k) nameToCode.set(k, p.code);
  }

  return drafts.map((d) => {
    let productCode: string | undefined;
    if (d.productCode?.trim()) {
      productCode = d.productCode.trim();
    } else if (d.productName) {
      const norm = normalizeProductKey(d.productName);
      productCode =
        nameToCode.get(norm) ??
        products.find((p) => {
          const pn = (p as { name?: string; product_code?: string }).product_code ?? (p as { name?: string }).name ?? "";
          return normalizeProductKey(pn) === norm;
        })?.code ??
        products.find((p) => {
          const pn = (p as { name?: string; product_code?: string }).product_code ?? (p as { name?: string }).name ?? "";
          return pn.includes(d.productName!) || d.productName!.includes(pn);
        })?.code;
    }
    return {
      date: d.date,
      itemId: d.itemId,
      type: d.type,
      quantity: d.quantity,
      person: d.person,
      note: d.note,
      ...(productCode && { productCode }),
      ...(d.salesChannel && { salesChannel: d.salesChannel }),
    };
  });
}

function normalizeProductKey(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function DataManagement() {
  const { addTransactions, resetAll, setProducts, setBaseStock, setDailyStock, dailyStock, products, transactions } = useInventory();

  const [msg, setMsg] = useState<string>("");

  // Rawdata
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const rawParsed = rawText ? parseRawdataProducts(rawText) : null;

  // 입고
  const [inFile, setInFile] = useState<File | null>(null);
  const [inText, setInText] = useState("");
  const inParsed = inText ? parseInboundCsv(inText, inFile?.name ?? "입고") : null;

  // 재고
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [stockText, setStockText] = useState("");
  const stockParsed = stockText ? parseStockCsvToBaseStock(stockText, products) : null;

  // 출고
  const [outFile, setOutFile] = useState<File | null>(null);
  const [outText, setOutText] = useState("");
  const outParsed = outText ? parseOutboundCsv(outText, outFile?.name ?? "일자별출고") : null;

  // 당일 재고 (파일)
  const [dailyFile, setDailyFile] = useState<File | null>(null);
  const [dailyText, setDailyText] = useState("");
  const dailyParsed = dailyText ? parseStockCsvToBaseStock(dailyText, products) : null;

  const pickFile = useCallback(
    async (file: File | null, setFile: (f: File | null) => void, setText: (t: string) => void) => {
      setMsg("");
      setFile(file);
      if (!file) {
        setText("");
        return;
      }
      try {
        const text = await fileToCsvText(file);
        setText(text);
      } catch (err) {
        setMsg(`파일 읽기 실패: ${err instanceof Error ? err.message : String(err)}`);
        setText("");
      }
    },
    []
  );

  const onApplyRaw = () => {
    if (!rawParsed || rawParsed.products.length === 0) return;
    setProducts(rawParsed.products);
    setMsg(`Rawdata 저장 완료: ${rawParsed.products.length.toLocaleString()}개 품목`);
    setRawFile(null);
    setRawText("");
  };

  const onApplyIn = () => {
    if (!inParsed || inParsed.txs.length === 0) return;
    const txs = draftsToTransactions(inParsed.txs, products);
    addTransactions(txs);
    setMsg(`순수 입고 반영: ${txs.length.toLocaleString()}건 (일자별)`);
    setInFile(null);
    setInText("");
  };

  const onApplyStock = () => {
    if (!stockParsed) return;
    const hasData =
      Object.values(stockParsed.baseStock).some((v) => v > 0) ||
      Object.keys(stockParsed.baseStockByProduct).length > 0;
    if (!hasData) return;
    setBaseStock(stockParsed.baseStock, stockParsed.baseStockByProduct);
    setMsg(`기초 재고 반영 완료: ${stockParsed.summary.usedRows.toLocaleString()}건 (순수 현재고)`);
    setStockFile(null);
    setStockText("");
  };

  const onApplyOut = () => {
    if (!outParsed || outParsed.txs.length === 0) return;
    const txs = draftsToTransactions(outParsed.txs, products);
    addTransactions(txs);
    setMsg(`순수 출고 반영: ${txs.length.toLocaleString()}건 (일자별)`);
    setOutFile(null);
    setOutText("");
  };

  const onApplyDailyStock = () => {
    if (!dailyParsed) return;
    const hasData = Object.values(dailyParsed.baseStock).some((v) => v > 0);
    if (!hasData) return;
    setDailyStock(dailyParsed.baseStock);
    setMsg(`당일 재고 반영 완료: ${dailyParsed.summary.usedRows.toLocaleString()}건`);
    setDailyFile(null);
    setDailyText("");
  };

  const onReset = () => {
    resetAll();
    setMsg("데이터를 초기화했습니다.");
    setRawFile(null);
    setRawText("");
    setInFile(null);
    setInText("");
    setStockFile(null);
    setStockText("");
    setOutFile(null);
    setOutText("");
    setDailyFile(null);
    setDailyText("");
  };

  return (
    <section className="rounded-lg border border-surface-border bg-surface-card p-2 md:rounded-xl md:p-6" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 md:text-sm">데이터 관리</h2>
          <p className="mt-0.5 text-[10px] text-zinc-500 md:mt-1 md:text-sm md:text-zinc-300">
            Rawdata·입고·기초·출고·당일. CSV/Excel 지원.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[10px] font-medium text-red-200 hover:bg-red-500/15 md:rounded-lg md:px-4 md:py-2.5 md:text-sm"
        >
          초기화
        </button>
      </div>

      {msg && (
        <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
          {msg}
        </div>
      )}

      <div className="mt-3 grid gap-2 md:mt-5 md:gap-4 lg:grid-cols-2">
        {/* 1. Rawdata = 제품 품목 리스트 */}
        <div className="rounded-lg border border-surface-border bg-surface-elevated/30 p-2 md:rounded-xl md:p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 md:text-xs">1. Rawdata</div>
          <p className="mt-0.5 hidden text-xs text-zinc-500 md:mt-1 md:block">품목코드, 제품명, 품목구분, 원가</p>
          <label className="relative mt-2 flex min-h-[48px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-cyan-500/50 bg-cyan-500/5 px-2 py-2 transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/10 md:mt-3 md:min-h-[80px] md:rounded-lg md:px-4 md:py-4">
            <span className="text-[10px] text-cyan-400 md:text-sm">{rawFile ? rawFile.name : "파일 선택 (CSV/Excel)"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null, setRawFile, setRawText)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400 md:mt-3 md:gap-2 md:text-sm md:text-zinc-300">
            <span>품목 {products.length.toLocaleString()}개</span>
            <button
              type="button"
              disabled={!rawParsed || rawParsed.products.length === 0}
              onClick={onApplyRaw}
              className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 md:rounded-lg md:px-3 md:py-2 md:text-sm"
            >
              저장
            </button>
          </div>
          {rawParsed && (
            <div className="mt-1 text-[10px] text-zinc-500 md:mt-2 md:text-xs">
              감지: {rawParsed.products.length.toLocaleString()}개
            </div>
          )}
        </div>

        {/* 2. 입고 = 순수 입고 (일자별) */}
        <div className="rounded-lg border border-surface-border bg-surface-elevated/30 p-2 md:rounded-xl md:p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 md:text-xs">2. 입고</div>
          <p className="mt-0.5 hidden text-xs text-zinc-500 md:mt-1 md:block">입고일자, 품목구분, 수량</p>
          <label className="relative mt-2 flex min-h-[48px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-cyan-500/50 bg-cyan-500/5 px-2 py-2 transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/10 md:mt-3 md:min-h-[80px] md:rounded-lg md:px-4 md:py-4">
            <span className="text-[10px] text-cyan-400 md:text-sm">{inFile ? inFile.name : "파일 선택"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null, setInFile, setInText)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400 md:mt-3 md:gap-2 md:text-sm md:text-zinc-300">
            <span>거래 {transactions.length.toLocaleString()}건</span>
            <button
              type="button"
              disabled={!inParsed || inParsed.txs.length === 0}
              onClick={onApplyIn}
              className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 md:rounded-lg md:px-3 md:py-2 md:text-sm"
            >
              반영
            </button>
          </div>
          {inParsed?.summary && (
            <div className="mt-1 text-[10px] text-zinc-500 md:mt-2 md:text-xs">
              {inParsed.summary.dateMin ?? "-"}~{inParsed.summary.dateMax ?? "-"} {inParsed.summary.usedRows.toLocaleString()}건
            </div>
          )}
        </div>

        {/* 3. 기초 재고 (파일 입력만) */}
        <div className="rounded-lg border border-surface-border bg-surface-elevated/30 p-2 md:rounded-xl md:p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 md:text-xs">3. 기초 재고</div>
          <p className="mt-0.5 hidden text-xs text-zinc-500 md:mt-1 md:block">품목구분, 수량</p>
          <label className="relative mt-2 flex min-h-[48px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-cyan-500/50 bg-cyan-500/5 px-2 py-2 transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/10 md:mt-3 md:min-h-[80px] md:rounded-lg md:px-4 md:py-4">
            <span className="text-[10px] text-cyan-400 md:text-sm">{stockFile ? stockFile.name : "파일 선택"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null, setStockFile, setStockText)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1 md:gap-2">
            <button
              type="button"
              disabled={
                !stockParsed ||
                (!Object.values(stockParsed.baseStock).some((v) => v > 0) &&
                  Object.keys(stockParsed.baseStockByProduct).length === 0)
              }
              onClick={onApplyStock}
              className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 md:rounded-lg md:px-3 md:py-2 md:text-sm"
            >
              반영
            </button>
          </div>
          {stockParsed?.summary && (
            <div className="mt-1 text-[10px] text-zinc-500 md:text-xs">
              감지 {stockParsed.summary.usedRows.toLocaleString()}건
            </div>
          )}
        </div>

        {/* 4. 출고 = 순수 출고 (일자별) */}
        <div className="rounded-lg border border-surface-border bg-surface-elevated/30 p-2 md:rounded-xl md:p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 md:text-xs">4. 출고</div>
          <p className="mt-0.5 hidden text-xs text-zinc-500 md:mt-1 md:block">출고일자, 품목구분, 수량</p>
          <label className="relative mt-2 flex min-h-[48px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-cyan-500/50 bg-cyan-500/5 px-2 py-2 transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/10 md:mt-3 md:min-h-[80px] md:rounded-lg md:px-4 md:py-4">
            <span className="text-[10px] text-cyan-400 md:text-sm">{outFile ? outFile.name : "파일 선택"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null, setOutFile, setOutText)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400 md:mt-3 md:gap-2 md:text-sm md:text-zinc-300">
            <span className="hidden md:inline">수량만 반영</span>
            <button
              type="button"
              disabled={!outParsed || outParsed.txs.length === 0}
              onClick={onApplyOut}
              className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 md:rounded-lg md:px-3 md:py-2 md:text-sm"
            >
              반영
            </button>
          </div>
          {outParsed?.summary && (
            <div className="mt-1 text-[10px] text-zinc-500 md:mt-2 md:text-xs">
              {outParsed.summary.dateMin ?? "-"}~{outParsed.summary.dateMax ?? "-"} {outParsed.summary.usedRows.toLocaleString()}건
            </div>
          )}
        </div>
      </div>

      {/* 5. 당일 재고 (실사/실제 재고) */}
      <div className="mt-3 rounded-lg border border-surface-border bg-surface-elevated/30 p-2 md:mt-6 md:rounded-xl md:p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 md:text-xs">5. 당일 재고</div>
        <p className="mt-0.5 hidden text-xs text-zinc-500 md:mt-1 md:block">실사/실제 재고 수량</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:mt-3 md:gap-3 lg:grid-cols-5">
          {ITEMS.map((item) => (
            <label key={item.id} className="block">
              <span className="mb-0.5 block text-[10px] text-zinc-500 md:mb-1 md:text-xs">{item.name}</span>
              <input
                type="text"
                inputMode="numeric"
                value={dailyStock[item.id] ? dailyStock[item.id].toLocaleString() : ""}
                onChange={(e) => {
                  const num = parseStockInput(e.target.value);
                  const next: StockMap = { ...dailyStock, [item.id]: num };
                  setDailyStock(next);
                }}
                placeholder="0"
                className="w-full rounded border border-surface-border bg-surface-card px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50 min-h-[36px] touch-manipulation md:rounded-lg md:px-3 md:py-2.5 md:text-sm md:min-h-[44px]"
              />
            </label>
          ))}
        </div>
        <div className="mt-2 border-t border-surface-border/50 pt-2 md:mt-3 md:pt-3">
          <span className="mb-1 block text-[10px] text-zinc-500 md:mb-2 md:text-xs">또는 CSV 업로드</span>
          <label className="relative flex min-h-[48px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-cyan-500/50 bg-cyan-500/5 px-2 py-2 transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/10 md:min-h-[80px] md:rounded-lg md:px-4 md:py-4">
            <span className="text-[10px] text-cyan-400 md:text-sm">{dailyFile ? dailyFile.name : "파일 선택"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null, setDailyFile, setDailyText)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1 md:gap-2">
            <button
              type="button"
              disabled={!dailyParsed || !Object.values(dailyParsed.baseStock).some((v) => v > 0)}
              onClick={onApplyDailyStock}
              className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 min-h-[36px] touch-manipulation md:rounded-lg md:px-3 md:py-2 md:text-sm md:min-h-[44px]"
            >
              반영
            </button>
          </div>
          {dailyParsed?.summary && (
            <div className="mt-1 text-[10px] text-zinc-500 md:text-xs">감지 {dailyParsed.summary.usedRows.toLocaleString()}건</div>
          )}
        </div>
      </div>

      {/* 6. 제품별 안전재고 미달 품목 관리 (Excel 내보내기) */}
      <div className="mt-3 md:mt-6">
        <SafetyStockManagement />
      </div>
    </section>
  );
}
