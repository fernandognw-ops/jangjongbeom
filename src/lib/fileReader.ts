import * as XLSX from "xlsx";

const EXCEL_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.ms-excel.sheet.macroEnabled.12",
];

/** CSV 또는 Excel 파일을 텍스트(CSV 형식)로 변환 */
export async function fileToCsvText(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const isCsv = ext === "csv" || file.type === "text/csv" || file.type === "application/csv";
  const isExcel = ext === "xlsx" || ext === "xls" || EXCEL_TYPES.includes(file.type);

  if (isCsv) {
    return file.text();
  }
  if (isExcel) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const firstSheet = wb.SheetNames?.[0];
    if (!firstSheet) return "";
    const sheet = wb.Sheets[firstSheet];
    return XLSX.utils.sheet_to_csv(sheet);
  }
  throw new Error(`지원 형식: CSV, Excel(.xlsx, .xls). 현재: ${file.name} (${file.type || "알 수 없음"})`);
}
