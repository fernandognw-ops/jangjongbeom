/**
 * 생산수불 엑셀 재고 시트 → 일반/쿠팡 수량 합계 (파서 동일 기준)
 * 사용: npx tsx scripts/sum_stock_snapshot_from_excel.ts <엑셀경로>
 *
 * DB 비교: sales_channel(판매채널) 기준
 *   SELECT CAST(sales_channel AS TEXT), SUM(quantity) FROM inventory_stock_snapshot GROUP BY 1;
 */
import { readFileSync } from "fs";
import { parseProductionSheetFromBuffer } from "../src/lib/productionSheetParser";
import { normalizeSalesChannelKr, WAREHOUSE_COUPANG } from "../src/lib/inventoryChannels";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("사용법: npx tsx scripts/sum_stock_snapshot_from_excel.ts <엑셀경로>");
    process.exit(1);
  }
  const buf = readFileSync(path);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = await parseProductionSheetFromBuffer(arrayBuffer, path);
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, error: result.message }));
    process.exit(2);
  }
  const stock = result.stockSnapshot;
  let coupang = 0;
  let general = 0;
  const dates = new Set<string>();
  for (const r of stock) {
    const ch = normalizeSalesChannelKr(r.sales_channel ?? "");
    const q = Number(r.quantity) || 0;
    if (ch === WAREHOUSE_COUPANG) coupang += q;
    else general += q;
    const d = (r.snapshot_date ?? "").toString().slice(0, 10);
    if (d) dates.add(d);
  }
  const total = coupang + general;
  console.log(JSON.stringify({
    file: path,
    rowCount: stock.length,
    snapshot_dates: [...dates].sort(),
    quantity_sum_by_sales_channel: { 쿠팡: coupang, 일반: general, 합계: total },
    note: "엑셀 「판매 채널」→ sales_channel → 쿠팡/일반 (DB·API와 동일)",
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
