"""
공용 엑셀 파싱 규칙
로컬(integrated_sync)과 웹(productionSheetParser)이 동일한 규칙 사용
"""

# 헤더 행: 2행 (0-indexed = 1)
HEADER_ROW = 1
# 데이터 시작: 3행 (0-indexed = 2)
DATA_START_ROW = 2

# 시트별 필수 시트
REQUIRED_SHEETS = ["입고", "출고", "재고"]

# 헤더 동의어 매핑 (컬럼 찾기용)
SYNONYMS = {
    "product_code": ["품번", "품목코드", "product_code", "제품코드", "SKU"],
    "product_name": ["상품명", "품목명", "제품명", "품명"],
    "quantity": ["입고 수량", "출고 수량", "재고 수량", "수량", "qty", "quantity", "입고수량", "출고수량", "재고수량"],
    "inbound_center": ["입고 센터", "입고처", "창고", "창고명", "보관장소", "보관처"],
    "outbound_center": ["출고 센터", "출고처", "창고", "창고명"],
    "storage_center": ["보관 센터", "보관센터"],
    "inbound_date": ["입고일자", "입고일", "기준일자", "일자", "date"],
    "outbound_date": ["출고일자", "출고일", "기준일자", "일자", "date"],
    "stock_date": ["재고일자", "재고 일자", "기준일자", "기준 일자", "재고기준일", "기준일"],
    # 재고 시트: unit_cost=원가(개당), total_price=합계금액(총액). 혼동 방지.
    "unit_cost": ["재고원가", "원가", "제품원가표", "단가"],  # 개당 단가. "합계원가"/"합계금액" 제외
    "total_price": ["재고 금액", "재고금액", "합계금액", "합계원가", "합계"],  # 총액
    "sales_channel": ["매출구분", "판매처"],
    "stock_sales_channel": ["판매 채널", "판매채널", "판매 채널명"],
    "outbound_sales_channel": ["판매 채널", "판매채널", "판매 채널명"],
    "category": ["품목구분", "품목", "카테고리"],
    "pack_size": ["입수량", "입수"],
    "unit_price": ["원가", "단가"],
    "total_price_inbound": ["합계원가", "합계"],
    "total_price_outbound": ["합계", "합계원가"],
}

# 출고 시트 출고일 열 — 웹 findOutboundDateColumnIndex 와 동일
OUTBOUND_DATE_HEADER_TERMS = (
    "출고일자",
    "출고 일자",
    "출고일",
    "출고기준일",
    "기준일자",
    "기준 일자",
)

# 수량 컬럼 검색 시 제외할 키워드 (입수량 등 혼동 방지)
QTY_EXCLUDE = ["입수량", "금액", "원가", "일자", "날짜", "재고원가"]

# warehouse_group 분류: 쿠팡 센터
COUPANG_CENTERS = ["테이칼튼", "테이칼튼 1공장", "테이칼튼1공장", "테이칼튼 1 공장"]
# 일반 센터
GENERAL_CENTERS = ["제이에스", "컬리"]
