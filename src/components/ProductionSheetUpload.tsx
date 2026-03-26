"use client";

import { useInventory } from "@/context/InventoryContext";
import { ProductionSheetUploader } from "@/components/ProductionSheetUploader";

export function ProductionSheetUpload() {
  const { useSupabaseInventory = false } = useInventory() ?? {};

  return (
    <section
      className="mt-8 min-h-[4rem] scroll-mt-24 md:mt-10"
      id="section-production-upload"
      aria-labelledby="heading-production-upload"
    >
      <h2
        id="heading-production-upload"
        className="mb-3 text-base font-bold text-slate-800 md:text-lg"
      >
        생산수불 업로드
      </h2>
      <div className="min-h-[80px] rounded-2xl border border-dashed border-slate-200/80 bg-white/40 p-3 md:p-4">
        {useSupabaseInventory ? (
          <ProductionSheetUploader />
        ) : (
          <p className="text-sm text-slate-600">
            Supabase 연동 시 이 영역에서 생산수불 현황 Excel을 업로드할 수 있습니다.
          </p>
        )}
      </div>
    </section>
  );
}
