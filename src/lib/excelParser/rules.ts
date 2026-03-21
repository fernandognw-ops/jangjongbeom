/**
 * 공용 엑셀 파싱 규칙 (common/rules.py와 동일)
 * 로컬과 웹이 완전히 동일한 규칙 사용
 */

/** 헤더 행: 2행 (0-indexed = 1) */
export const HEADER_ROW = 1;
/** 데이터 시작: 3행 (0-indexed = 2) */
export const DATA_START_ROW = 2;

export const REQUIRED_SHEETS = ["입고", "출고", "재고"] as const;

/** 헤더 동의어 매핑 */
export const SYNONYMS: Record<string, string[]> = {
  product_code: ["품번", "품목코드", "product_code", "제품코드", "SKU"],
  product_name: ["상품명", "품목명", "제품명", "품명"],
  quantity: [
    "입고 수량",
    "출고 수량",
    "재고 수량",
    "수량",
    "qty",
    "quantity",
    "입고수량",
    "출고수량",
    "재고수량",
  ],
  inbound_center: ["입고 센터", "입고처", "창고", "창고명", "보관장소", "보관처"],
  outbound_center: ["출고 센터", "출고처", "창고", "창고명"],
  storage_center: [
    "보관 센터",
    "재고 센터",
    "창고명",
    "창고",
    "보관장소",
    "보관처",
    "입고처",
  ],
  inbound_date: ["입고일자", "입고일", "기준일자", "일자", "date"],
  outbound_date: ["출고일자", "출고일", "기준일자", "일자", "date"],
  stock_date: ["기준일자", "재고일자", "재고일", "일자", "date"],
  unit_cost: ["재고원가", "원가", "제품원가표", "제품원가표(개당)", "제품 원가표(개당)", "단가"],
  total_price: ["재고 금액", "재고금액", "합계금액", "합계원가", "합계"],
  /** 출고 시트 등 */
  sales_channel: ["매출구분", "판매처"],
  /** 재고 시트 전용: 엑셀 J열 등 — 보관센터와 별도 (헤더 표기 차이 대응) */
  stock_sales_channel: [
    "판매 채널",
    "판매채널",
    "판매 채널명",
    "매출채널",
    "판매구분",
  ],
  category: ["품목구분", "카테고리"],
  pack_size: ["입수량", "입수"],
  unit_price: ["원가", "단가"],
  total_price_inbound: ["합계원가", "합계"],
  total_price_outbound: ["합계", "합계원가"],
} as const;

/** 수량 컬럼 검색 시 제외 */
export const QTY_EXCLUDE = ["입수량", "금액", "원가", "일자", "날짜", "재고원가"];
