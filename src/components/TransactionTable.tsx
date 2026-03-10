"use client";

import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";

const MAX_ROWS = 10;

export function TransactionTable() {
  const { transactions } = useInventory();
  const displayRows = transactions.slice(0, MAX_ROWS);

  const getItemName = (id: string) => ITEMS.find((i) => i.id === id)?.name ?? id;

  if (transactions.length === 0) {
    return (
      <section className="rounded-xl border border-surface-border bg-surface-card p-6" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          입출고 내역 (최근 {MAX_ROWS}건)
        </h2>
        <p className="text-center text-zinc-500">입출고 내역이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-surface-border bg-surface-card overflow-hidden" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
      <h2 className="border-b border-surface-border bg-surface-elevated px-4 py-3 text-sm font-semibold uppercase tracking-wider text-zinc-400 md:px-6" style={{ backgroundColor: "#121214", borderColor: "#27272a" }}>
        입출고 내역 (최근 {MAX_ROWS}건)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-zinc-400">
              <th className="px-4 py-3 font-medium md:px-6">일자</th>
              <th className="px-4 py-3 font-medium md:px-6">품목</th>
              <th className="px-4 py-3 font-medium md:px-6">구분</th>
              <th className="px-4 py-3 font-medium md:px-6 text-right">수량 (개)</th>
              <th className="px-4 py-3 font-medium md:px-6">담당자</th>
              <th className="px-4 py-3 font-medium md:px-6">비고</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((tx) => (
              <tr
                key={tx.id}
                className="border-b border-surface-border/80 transition-colors hover:bg-surface-elevated/50"
              >
                <td className="px-4 py-3 text-white md:px-6">{tx.date}</td>
                <td className="px-4 py-3 text-white md:px-6">
                  {getItemName(tx.itemId)}
                </td>
                <td className="px-4 py-3 md:px-6">
                  <span
                    className={
                      tx.type === "in"
                        ? "text-accent-green"
                        : "text-accent-red"
                    }
                  >
                    {tx.type === "in" ? "입고" : "출고"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-white md:px-6">
                  {tx.quantity.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-zinc-300 md:px-6">{tx.person}</td>
                <td className="px-4 py-3 text-zinc-500 md:px-6">{tx.note || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length > MAX_ROWS && (
        <p className="border-t border-surface-border px-4 py-2 text-center text-xs text-zinc-500 md:px-6">
          외 {transactions.length - MAX_ROWS}건 (총 {transactions.length}건)
        </p>
      )}
    </section>
  );
}
