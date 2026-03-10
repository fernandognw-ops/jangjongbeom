import * as XLSX from "xlsx";

export interface ShortageProductRow {
  productName: string;
  productCode: string;
  categoryName: string;
  currentStock: number;
  safetyStock: number;
  shortageQty: number;
  currentStockSKU?: number;
  safetyStockSKU?: number;
  shortageQtySKU?: number;
  packSize?: number;
}

export function exportShortageToExcel(rows: ShortageProductRow[], filename = "안전재고미달품목") {
  const hasSKU = rows.some((r) => r.packSize != null && r.packSize > 0);
  const wsData = hasSKU
    ? [
        ["상품명", "품목코드", "품목구분", "입수량", "현재재고(SKU)", "2주기준(SKU)", "부족수량(SKU)"],
        ...rows.map((r) => [
          r.productName,
          r.productCode,
          r.categoryName,
          r.packSize ?? 1,
          Math.round(r.currentStockSKU ?? r.currentStock),
          Math.round(r.safetyStockSKU ?? r.safetyStock),
          Math.round(r.shortageQtySKU ?? r.shortageQty),
        ]),
      ]
    : [
        ["상품명", "품목코드", "품목구분", "현재재고(개)", "2주기준(개)", "부족수량(개)"],
        ...rows.map((r) => [
          r.productName,
          r.productCode,
          r.categoryName,
          r.currentStock,
          r.safetyStock,
          r.shortageQty,
        ]),
      ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const colWidths = hasSKU
    ? [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
    : [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "안전재고미달");

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, `${filename}_${dateStr}.xlsx`);
}
