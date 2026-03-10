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
    <section className="rounded-xl border border-surface-border bg-surface-card p-4 md:p-6" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
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
              className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5 text-white focus:ring-2 focus:ring-cyan-500/50"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">품목</span>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value as ItemId)}
              className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5 text-white focus:ring-2 focus:ring-cyan-500/50"
            >
              {ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">입고/출고</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TransactionType)}
              className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5 text-white focus:ring-2 focus:ring-cyan-500/50"
            >
              <option value="in">입고</option>
              <option value="out">출고</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">수량 (개)</span>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5 text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50"
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
              className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5 text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50"
            />
          </label>
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-xs text-zinc-400">비고</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="비고 (선택)"
              className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5 text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50"
            />
          </label>
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="rounded-lg bg-cyan-500 px-5 py-2.5 font-medium text-black transition-colors hover:bg-cyan-400 focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-surface"
          >
            등록
          </button>
        </div>
      </form>
    </section>
  );
}
