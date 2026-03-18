"""
센터명 → warehouse_group 분류
로컬과 웹 동일 규칙
"""

from .rules import COUPANG_CENTERS


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


def classify_warehouse_group(center: str) -> str:
    """
    센터명 → warehouse_group
    - "테이칼튼", "테이칼튼 1공장" → "쿠팡"
    - "제이에스", "컬리", 기타 → "일반"
    """
    c = normalize_value(center)
    if not c:
        return "일반"
    # 테이칼튼 포함 → 쿠팡
    if "테이칼튼" in c:
        return "쿠팡"
    return "일반"


def to_sales_channel(center: str) -> str:
    """warehouse_group → sales_channel (coupang | general)"""
    g = classify_warehouse_group(center)
    return "coupang" if g == "쿠팡" else "general"
