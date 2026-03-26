"use client";

import { useInventory } from "@/context/InventoryContext";
import { ShortageList } from "@/components/ShortageList";
import { RunOutDateCard } from "@/components/RunOutDateCard";
import { ItemCards } from "@/components/ItemCards";
import { BaseStockAndDailyStock } from "@/components/BaseStockAndDailyStock";
import { TransactionTable } from "@/components/TransactionTable";
import { DataManagement } from "@/components/DataManagement";
import { SyncSettings } from "@/components/SyncSettings";

export function OtherEtcSection() {
  const { useSupabaseInventory = false } = useInventory() ?? {};

  return (
    <section
      className="mt-8 min-h-[8rem] scroll-mt-24 border-t border-slate-200 pt-8 md:mt-10"
      id="section-misc"
      aria-labelledby="heading-misc"
    >
      <h2
        id="heading-misc"
        className="mb-4 text-base font-bold text-slate-800 md:text-lg"
      >
        그외 기타
      </h2>
      <div className="min-h-[120px] space-y-8 rounded-2xl border border-dashed border-slate-200/80 bg-white/40 p-3 md:p-4">
        {useSupabaseInventory ? (
          <>
            <RunOutDateCard />
            <DataManagement />
            <TransactionTable />
          </>
        ) : (
          <>
            <SyncSettings />
            <ShortageList />
            <RunOutDateCard />
            <BaseStockAndDailyStock />
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600 md:mb-4 md:text-sm">
                품목별 재고 현황
              </h3>
              <ItemCards />
            </div>
            <DataManagement />
            <TransactionTable />
          </>
        )}
      </div>
    </section>
  );
}
