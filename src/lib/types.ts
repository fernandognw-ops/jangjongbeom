// 카테고리: 마스크, 캡슐세제, 섬유유연제, 액상세제, 생활용품 (품목구분 기준)
export type ItemId =
  | "mask"      // 마스크
  | "capsule"   // 캡슐세제
  | "fabric"    // 섬유유연제
  | "liquid"    // 액상세제
  | "living";   // 생활용품

export interface ItemMaster {
  id: ItemId;
  name: string;
  unitCost: number; // 원가 (원)
  safetyStock: number; // 안전재고 (최근 2주 출고 기준으로 동적 계산)
}

export const ITEMS: ItemMaster[] = [
  { id: "mask", name: "마스크", unitCost: 40, safetyStock: 0 },
  { id: "capsule", name: "캡슐세제", unitCost: 20, safetyStock: 0 },
  { id: "fabric", name: "섬유유연제", unitCost: 15, safetyStock: 0 },
  { id: "liquid", name: "액상세제", unitCost: 20, safetyStock: 0 },
  { id: "living", name: "생활용품", unitCost: 10, safetyStock: 0 },
];

export type TransactionType = "in" | "out";

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  itemId: ItemId;
  type: TransactionType;
  quantity: number; // 개
  person: string;
  note: string;
  createdAt: number;
  productCode?: string; // 제품별 집계용 (품목코드)
}

export type StockMap = Record<ItemId, number>;

export interface ProductMasterRow {
  code: string;
  name: string;
  group: string; // 품목구분
  subGroup: string; // 하위품목
  spec: string; // 규격
  unitCost?: number; // 원가 (원)
  packSize?: number; // 입수량 (SKU 수량 = 총수량/입수량, 0이면 1로 간주)
}
