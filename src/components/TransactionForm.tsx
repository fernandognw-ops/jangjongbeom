"use client";

import { useState } from "react";
import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";
import type { ItemId, TransactionType } from "@/lib/types";

const today = new Date().toISOString().slice(0, 10);

export function TransactionForm() {
  const { addTransaction } = useInventory();
  const [date, setDate] = useState(today);
  const [itemId, setItemId] = useState<ItemId>("mask");
  const [type, setType] = useState<TransactionType>("in");
  const [quantity, setQuantity] = useState("");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) return;
    addTransaction({
      date,
      itemId,
      type,
      quantity: qty,
      person: person.trim() || "-",
      note: note.trim() || "",
    });
    setQuantity("");
    setNote("");
  };

  return (
    <section className="rounded-xl border border-surface-border bg-surface-card p-4 md:p-6" style={{ backgroundColor: "#18181b", borderColor: "#3f3f46" }}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        입출고 입력
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">일자</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2.5 text-white focus:ring-2 focus:ring-cyan-500/50 md:min-h-[44px]"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">품목</span>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value as ItemId)}
              className="w-full min-h-[44px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2.5 text-white focus:ring-2 focus:ring-cyan-500/50 md:min-h-[44px]"
            >
              {ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {/* PC: 셀렉트 / 모바일: 풀폭 입고·출고 버튼 */}
          <label className="block md:col-span-1">
            <span className="mb-1 block text-xs text-zinc-400">입고/출고</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TransactionType)}
              className="hidden w-full min-h-[44px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2.5 text-white focus:ring-2 focus:ring-cyan-500/50 md:block"
            >
              <option value="in">입고</option>
              <option value="out">출고</option>
            </select>
            <div className="grid grid-cols-2 gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setType("in")}
                className={`min-h-[52px] rounded-xl text-base font-bold transition-all active:scale-[0.98] ${
                  type === "in"
                    ? "bg-green-500 text-white shadow-lg shadow-green-500/30"
                    : "border border-zinc-600 bg-zinc-900/80 text-zinc-400"
                }`}
              >
                입고
              </button>
              <button
                type="button"
                onClick={() => setType("out")}
                className={`min-h-[52px] rounded-xl text-base font-bold transition-all active:scale-[0.98] ${
                  type === "out"
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                    : "border border-zinc-600 bg-zinc-900/80 text-zinc-400"
                }`}
              >
                출고
              </button>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">수량 (개)</span>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full min-h-[44px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2.5 text-lg text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50 md:min-h-[44px] md:text-base"
              required
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">담당자</span>
            <input
              type="text"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              placeholder="담당자명"
              className="w-full min-h-[44px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2.5 text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50 md:min-h-[44px]"
            />
          </label>
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-xs text-zinc-400">비고</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="비고 (선택)"
              className="w-full min-h-[44px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2.5 text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50 md:min-h-[44px]"
            />
          </label>
        </div>
        <div className="flex justify-end pt-2 md:justify-end">
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-xl bg-cyan-500 py-3 text-base font-bold text-black transition-colors hover:bg-cyan-400 focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-surface active:scale-[0.98] md:w-auto md:min-h-0 md:rounded-lg md:px-5 md:py-2.5 md:text-sm md:font-medium"
          >
            등록
          </button>
        </div>
      </form>
    </section>
  );
}
