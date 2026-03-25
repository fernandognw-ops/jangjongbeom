/**
 * 엑셀 파싱 결과를 JSON으로 출력 (검증용)
 * 사용: npx tsx scripts/parse_excel_for_validation.ts <파일경로>
 * 출력: JSON (inbound, outbound, stockSnapshot)
 */

import { readFileSync } from "fs";
import { parseProductionSheetFromBuffer } from "../src/lib/productionSheetParser";

async function main() {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("사용법: npx tsx scripts/parse_excel_for_validation.ts <엑셀파일경로>\n");
    process.exit(1);
  }
  const buf = readFileSync(path);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = await parseProductionSheetFromBuffer(arrayBuffer, path);
  if (!result.ok) {
    process.stderr.write(JSON.stringify({ ok: false, error: result.message }));
    process.exit(2);
  }
  const out = {
    ok: true,
    inbound: result.inbound.map((r) => ({
      product_code: r.product_code,
      inbound_center: r.inbound_center ?? "",
      sales_channel: r.sales_channel,
      channel: r.channel,
      inbound_date: r.inbound_date,
      quantity: r.quantity,
    })),
    outbound: result.outbound.map((r) => ({
      product_code: r.product_code,
      dest_warehouse: r.dest_warehouse ?? "일반",
      outbound_date: r.outbound_date,
      quantity: r.quantity,
      sales_channel: r.sales_channel,
      channel: r.channel,
    })),
    stockSnapshot: result.stockSnapshot.map((r) => ({
      product_code: r.product_code,
      sales_channel: r.sales_channel,
      channel: r.channel,
      storage_center: r.storage_center ?? "미지정",
      snapshot_date: r.snapshot_date ?? "",
      quantity: r.quantity,
      unit_cost: r.unit_cost ?? 0,
    })),
  };
  process.stdout.write(JSON.stringify(out, null, 0));
}

main().catch((e) => {
  process.stderr.write(String(e));
  process.exit(3);
});
