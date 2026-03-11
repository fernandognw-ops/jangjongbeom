#!/usr/bin/env python3
"""
재고 관리 계산 함수 (Python)
- 실시간 가용 재고 (물류센터 마감 시차 보정)
- 재고 소진일(Run-out date) 예측
- 쿠팡/일반 매출 분리 분석

1년+ 시계열 데이터 기반 예측·통제용
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal, Optional

SalesChannel = Literal["coupang", "general"]


@dataclass
class LogisticsCutoff:
    """물류센터 마감 시각 (KST)"""
    channel: SalesChannel
    hour: int  # 0-23
    minute: int = 0


DEFAULT_CUTOFF = [
    LogisticsCutoff("coupang", 18, 0),   # 쿠팡: 18:00 마감
    LogisticsCutoff("general", 23, 59),  # 일반: 23:59 마감
]


def is_before_cutoff(
    channel: SalesChannel,
    now: Optional[datetime] = None,
    cutoffs: Optional[list[LogisticsCutoff]] = None,
) -> bool:
    """현재 시각이 해당 채널의 당일 마감 전인지"""
    now = now or datetime.now()
    cutoffs = cutoffs or DEFAULT_CUTOFF
    cfg = next((c for c in cutoffs if c.channel == channel), None)
    if not cfg:
        return True
    cutoff_minutes = cfg.hour * 60 + cfg.minute
    now_minutes = now.hour * 60 + now.minute
    return now_minutes < cutoff_minutes


def compute_real_time_available_stock(
    current_stock: int | float,
    today_out_coupang: int | float,
    today_out_general: int | float,
    now: Optional[datetime] = None,
) -> float:
    """
    실시간 가용 재고 (물류센터 마감 시차 보정)
    
    마감 전: 해당 채널의 당일 출고분이 아직 반영 안 됨 → 가용 = 현재고 - 미반영 출고
    """
    now = now or datetime.now()
    pending = 0.0
    if is_before_cutoff("coupang", now):
        pending += today_out_coupang
    if is_before_cutoff("general", now):
        pending += today_out_general
    return max(0, current_stock - pending)


def get_average_daily_outbound(
    outbound_records: list[dict],  # [{"date": "2026-01-01", "quantity": 100, "item_id": "mask", "sales_channel": "coupang"}]
    item_id: str,
    days: int = 30,
    by_product: bool = False,
    product_code_key: str = "product_code",
) -> float:
    """최근 N일 평균 일일 출고량 (실제 거래일 기준)"""
    cutoff = date.today() - timedelta(days=days)
    daily_total: dict[str, float] = {}
    total_qty = 0.0

    for r in outbound_records:
        try:
            rdate = r["date"] if isinstance(r["date"], date) else datetime.strptime(r["date"], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        if rdate < cutoff:
            continue
        key = r.get(product_code_key, item_id) if by_product else item_id
        match = (r.get(product_code_key) == item_id) if by_product else (r.get("item_id") == item_id)
        if not match:
            continue
        dstr = rdate.isoformat()
        daily_total[dstr] = daily_total.get(dstr, 0) + r.get("quantity", 0)
        total_qty += r.get("quantity", 0)

    day_count = len(daily_total)
    return total_qty / day_count if day_count > 0 else 0.0


def predict_run_out_date(
    current_stock: int | float,
    avg_daily_out: float,
    from_date: Optional[date] = None,
) -> tuple[Optional[str], int, bool]:
    """
    재고 소진일 예측
    Returns: (예상 소진일 YYYY-MM-DD, 잔여일수, 무한대 여부)
    """
    from_date = from_date or date.today()
    if current_stock <= 0:
        return from_date.isoformat(), 0, False
    if avg_daily_out <= 0:
        return None, 999, True
    days_left = int(current_stock / avg_daily_out)
    run_out = from_date + timedelta(days=days_left)
    return run_out.isoformat(), days_left, False


def predict_all_run_out_dates(
    stock: dict[str, int | float],
    outbound_records: list[dict],
    item_names: dict[str, str],
    lookback_days: int = 30,
) -> list[dict]:
    """품목별 소진일 예측 결과"""
    results = []
    for item_id, current in stock.items():
        avg = get_average_daily_outbound(outbound_records, item_id, lookback_days)
        date_str, days_left, is_infinite = predict_run_out_date(current, avg)
        results.append({
            "item_id": item_id,
            "item_name": item_names.get(item_id, item_id),
            "current_stock": current,
            "avg_daily_out": round(avg, 1),
            "run_out_date": date_str,
            "days_left": 999 if is_infinite else days_left,
            "is_infinite": is_infinite,
            "is_urgent": not is_infinite and 0 <= days_left <= 7,
        })
    return sorted(results, key=lambda x: (x["is_infinite"], x["days_left"]))


# --- Excel 연동 예시 (pandas) ---
def load_outbound_from_excel(path: str, sheet: str = "출고") -> list[dict]:
    """생산수불현황 Excel 출고 시트 로드"""
    import pandas as pd
    df = pd.read_excel(path, sheet_name=sheet, header=None)
    # 헤더 탐색 (품목코드, 제품명, 품목구분, 수량, 매출구분, 출고일자)
    # 실제 컬럼 인덱스는 Excel 구조에 맞게 조정
    records = []
    for _, row in df.iterrows():
        # row 처리 로직 (실제 구조에 맞게 수정)
        records.append({
            "date": str(row.get("출고일자", "")),
            "quantity": int(row.get("수량", 0) or 0),
            "item_id": str(row.get("품목구분", "")),
            "product_code": str(row.get("품목코드", "")),
            "sales_channel": "coupang" if "쿠팡" in str(row.get("매출구분", "")) else "general",
        })
    return records


if __name__ == "__main__":
    # 사용 예시
    stock = {"mask": 5000, "capsule": 10000, "fabric": 8000}
    outbound = [
        {"date": "2026-03-01", "quantity": 200, "item_id": "mask"},
        {"date": "2026-03-02", "quantity": 180, "item_id": "mask"},
        # ... 30일치
    ]
    names = {"mask": "마스크", "capsule": "캡슐세제", "fabric": "섬유유연제"}
    preds = predict_all_run_out_dates(stock, outbound, names)
    for p in preds:
        print(f"{p['item_name']}: {p['run_out_date']} ({p['days_left']}일)")
