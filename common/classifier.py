"""
센터명/창고명/매출구분 → 판매채널 분류
로컬과 웹 동일 규칙. dest_warehouse에는 "일반" 또는 "쿠팡"만 저장
"""


def normalize_value(val: str | float | None) -> str:
    """
    모든 값 정규화 (공용 필수)
    - NaN → ""
    - 줄바꿈 제거 (\\n, \\r)
    - 탭 제거
    - 공백 제거
    - strip
    - lower
    """
    if val is None:
        return ""
    s = str(val)
    if s.lower() == "nan" or (hasattr(val, "__float__") and str(val) == "nan"):
        return ""
    s = s.replace("\n", "").replace("\r", "").replace("\t", " ")
    s = " ".join(s.split()).strip().lower()
    return s


def to_dest_warehouse(original: str | float | None) -> str:
    """
    원본 창고명/센터명/매출구분 → 판매채널 ("일반" | "쿠팡")
    - "테이칼튼", "테이칼튼 1공장", "쿠팡", "coupang" → "쿠팡"
    - "제이에스", "컬리", 기타, 빈값 → "일반"
    """
    c = normalize_value(original)
    if not c:
        return "일반"
    if "테이칼튼" in c or "쿠팡" in c or "coupang" in c:
        return "쿠팡"
    return "일반"


def classify_warehouse_group(center: str) -> str:
    """@deprecated to_dest_warehouse 사용"""
    return to_dest_warehouse(center)


def to_sales_channel(center: str) -> str:
    """판매채널 → sales_channel DB값 (coupang | general)"""
    g = to_dest_warehouse(center)
    return "coupang" if g == "쿠팡" else "general"


def normalize_sales_channel_kr(original: str | float | None) -> str:
    """엑셀 「판매 채널」값 → "쿠팡" | "일반" (보관센터 추론 없음)"""
    c = normalize_value(original)
    if not c:
        return "일반"
    if "쿠팡" in c or "coupang" in c:
        return "쿠팡"
    return "일반"
