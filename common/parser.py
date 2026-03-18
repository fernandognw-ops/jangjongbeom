"""
공용 엑셀 파서
입고/출고/재고 시트 파싱 - 로컬과 웹 동일 규칙
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .rules import (
    HEADER_ROW,
    DATA_START_ROW,
    REQUIRED_SHEETS,
    SYNONYMS,
    QTY_EXCLUDE,
)
from .classifier import normalize_value, classify_warehouse_group, to_sales_channel

# pandas는 호출 측에서 import (로컬만 사용, 웹은 TypeScript)
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    pd = None


def _norm(s: str) -> str:
    """헤더 매칭용 정규화"""
    return normalize_value(s)


def _find_col(row: list, synonyms_key: str, exclude: list[str] | None = None) -> int:
    """헤더 행에서 synonyms_key에 해당하는 컬럼 인덱스 찾기. exclude에 포함된 키워드가 있으면 제외."""
    names = SYNONYMS.get(synonyms_key, [])
    excl = set(_norm(x) for x in (exclude or []))
    if synonyms_key == "total_price":
        excl.add(_norm("재고원가"))  # 재고원가=개당단가, total_price에 사용 금지
    if synonyms_key == "unit_cost":
        excl.update([_norm("합계"), _norm("합계원가"), _norm("합계금액")])  # 합계=총액, unit_cost에 사용 금지
    for i, cell in enumerate(row):
        v = _norm(str(cell) if cell is not None else "")
        if excl and any(ex in v for ex in excl):
            continue
        for n in names:
            nv = _norm(n)
            if nv in v or v in nv:
                return i
    return -1


def _find_qty_col(row: list, sheet_type: str) -> int:
    """수량 컬럼 (입수량 등 제외)"""
    names = SYNONYMS["quantity"]
    excl = set(_norm(x) for x in QTY_EXCLUDE)
    for i, cell in enumerate(row):
        v = _norm(str(cell) if cell is not None else "")
        if any(ex in v for ex in excl):
            continue
        for n in names:
            nv = _norm(n)
            if nv in v or v in nv:
                return i
    return -1


def _parse_date(val: Any, year: int, fallback: str | None = None) -> str | None:
    """날짜 파싱: 1) 시트 값 2) fallback (파일명 연도 등) 3) 업로드일"""
    if val is None or (hasattr(val, "__float__") and str(val) == "nan"):
        return fallback
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return fallback
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    try:
        import pandas as pd
        dt = pd.to_datetime(val)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    # 26년 0317, 25-10 등
    m = re.match(r"(\d{2,4})년?\s*(\d{2})\.?(\d{2})?", s)
    if m:
        y = int(m.group(1))
        if y < 100:
            y += 2000 if y < 50 else 1900
        mo = int(m.group(2))
        d = int(m.group(3)) if m.group(3) else 1
        return f"{y}-{mo:02d}-{d:02d}"
    return fallback


def _year_from_filename(filename: str | None) -> int:
    """파일명에서 연도 추출"""
    if not filename:
        return datetime.now().year
    name = Path(filename).name
    if re.search(r"26년|2026|_26\b|\(26\)", name):
        return 2026
    if re.search(r"25년|2025|_25\b|\(25\)", name):
        return 2025
    m = re.search(r"(\d{4})", name)
    if m:
        y = int(m.group(1))
        if 2020 <= y <= 2030:
            return y
    return datetime.now().year


def _safe_int(val: Any) -> int:
    try:
        if val is None or (hasattr(val, "__float__") and str(val) == "nan"):
            return 0
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def _safe_float(val: Any) -> float:
    try:
        if val is None or (hasattr(val, "__float__") and str(val) == "nan"):
            return 0.0
        f = float(val)
        return f if f >= 0 else 0.0
    except (ValueError, TypeError):
        return 0.0


def _valid_product_code(code: str) -> bool:
    """품목코드 유효성"""
    if not code or code.lower() == "nan":
        return False
    if len(code) < 5:
        return False
    digits = sum(1 for c in code if c.isdigit())
    if digits < len(code) * 0.5:
        return False
    if "합계" in code or "소계" in code:
        return False
    return True


def _debug_log(debug: bool, *args: Any) -> None:
    if debug:
        print(*args)


def parse_inbound_excel(
    path: str,
    sheet_name: str = "입고",
    filename: str | None = None,
    debug: bool = False,
) -> list[dict]:
    """
    입고 시트 파싱
    - 헤더: 2행, 데이터: 3행~
    - 품번→product_code, 상품명→product_name, 입고 수량→quantity,
      입고 센터→inbound_center, 입고일자→inbound_date
    - dest_warehouse = inbound_center (DB 호환)
    """
    if not HAS_PANDAS:
        raise RuntimeError("pandas required for parse_inbound_excel")
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    if len(df) <= HEADER_ROW:
        return []
    header_row = list(df.iloc[HEADER_ROW])
    raw_headers = [str(h or "").strip() for h in header_row[:25]]
    normalized_headers = [_norm(h) for h in raw_headers]

    _debug_log(debug, "sheet names: (single sheet)", sheet_name)
    _debug_log(debug, "selected sheet:", sheet_name)
    _debug_log(debug, "header row index:", HEADER_ROW)
    _debug_log(debug, "raw headers:", raw_headers)
    _debug_log(debug, "normalized headers:", normalized_headers)

    idx_code = _find_col(header_row, "product_code")
    idx_name = _find_col(header_row, "product_name")
    idx_qty = _find_qty_col(header_row, "inbound")
    idx_center = _find_col(header_row, "inbound_center")
    idx_date = _find_col(header_row, "inbound_date")
    idx_cat = _find_col(header_row, "category")
    idx_pack = _find_col(header_row, "pack_size")
    idx_unit = _find_col(header_row, "unit_price")
    idx_total = _find_col(header_row, "total_price_inbound")

    col_map = {
        "product_code": idx_code,
        "product_name": idx_name,
        "quantity": idx_qty,
        "inbound_center": idx_center,
        "inbound_date": idx_date,
        "category": idx_cat,
        "pack_size": idx_pack,
        "unit_price": idx_unit,
        "total_price": idx_total,
    }
    _debug_log(debug, "column mapping:", col_map)

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    year = _year_from_filename(filename)
    today = datetime.now().strftime("%Y-%m-%d")
    rows = []
    for i in range(DATA_START_ROW, len(df)):
        row = df.iloc[i]
        code = str(row.iloc[idx_code] or "").strip()
        qty = _safe_int(row.iloc[idx_qty] if idx_qty < len(row) else 0)
        date_val = row.iloc[idx_date] if idx_date < len(row) else None
        date_str = _parse_date(date_val, year, today)
        if not _valid_product_code(code) or qty <= 0 or not date_str:
            continue
        name = str(row.iloc[idx_name] or "").strip() if idx_name >= 0 else ""
        name = name or code
        center_raw = str(row.iloc[idx_center] or "").strip() if idx_center >= 0 else ""
        wh_group = classify_warehouse_group(center_raw)
        cat = str(row.iloc[idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = _safe_int(row.iloc[idx_pack]) if idx_pack >= 0 else 1
        unit = _safe_float(row.iloc[idx_unit]) if idx_unit >= 0 else 0.0
        total = _safe_float(row.iloc[idx_total]) if idx_total >= 0 else 0.0

        _debug_log(debug, f"  row {i}: parsed quantity={qty}, center={center_raw}, warehouse_group={wh_group}, date={date_str}")

        rows.append({
            "product_code": code,
            "product_name": name,
            "quantity": qty,
            "inbound_center": center_raw,
            "inbound_date": date_str,
            "warehouse_group": wh_group,
            "event_type": "inbound",
            "dest_warehouse": center_raw or None,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "unit_price": unit,
            "total_price": total,
        })
    return rows


def parse_outbound_excel(
    path: str,
    sheet_name: str = "출고",
    filename: str | None = None,
    debug: bool = False,
) -> list[dict]:
    """
    출고 시트 파싱
    - 헤더: 2행, 데이터: 3행~
    - 품번→product_code, 상품명→product_name, 출고 수량→quantity,
      출고 센터→outbound_center, 출고일자→outbound_date
    """
    if not HAS_PANDAS:
        raise RuntimeError("pandas required for parse_outbound_excel")
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    if len(df) <= HEADER_ROW:
        return []
    header_row = list(df.iloc[HEADER_ROW])
    raw_headers = [str(h or "").strip() for h in header_row[:25]]
    normalized_headers = [_norm(h) for h in raw_headers]

    _debug_log(debug, "selected sheet:", sheet_name)
    _debug_log(debug, "header row index:", HEADER_ROW)
    _debug_log(debug, "raw headers:", raw_headers)
    _debug_log(debug, "normalized headers:", normalized_headers)

    idx_code = _find_col(header_row, "product_code")
    idx_name = _find_col(header_row, "product_name")
    idx_qty = _find_qty_col(header_row, "outbound")
    idx_center = _find_col(header_row, "outbound_center")
    idx_date = _find_col(header_row, "outbound_date")
    idx_sc = _find_col(header_row, "sales_channel")
    idx_cat = _find_col(header_row, "category")
    idx_pack = _find_col(header_row, "pack_size")
    idx_unit = _find_col(header_row, "unit_price")
    idx_total = _find_col(header_row, "total_price_outbound")

    col_map = {
        "product_code": idx_code,
        "product_name": idx_name,
        "quantity": idx_qty,
        "outbound_center": idx_center,
        "outbound_date": idx_date,
        "sales_channel": idx_sc,
        "category": idx_cat,
        "pack_size": idx_pack,
        "unit_price": idx_unit,
        "total_price": idx_total,
    }
    _debug_log(debug, "column mapping:", col_map)

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    year = _year_from_filename(filename)
    today = datetime.now().strftime("%Y-%m-%d")
    rows = []
    for i in range(DATA_START_ROW, len(df)):
        row = df.iloc[i]
        code = str(row.iloc[idx_code] or "").strip()
        qty = _safe_int(row.iloc[idx_qty] if idx_qty < len(row) else 0)
        date_val = row.iloc[idx_date] if idx_date < len(row) else None
        date_str = _parse_date(date_val, year, today)
        if not _valid_product_code(code) or qty <= 0 or not date_str:
            continue
        name = str(row.iloc[idx_name] or "").strip() if idx_name >= 0 else ""
        name = name or code
        center_raw = str(row.iloc[idx_center] or "").strip() if idx_center >= 0 else ""
        wh_group = classify_warehouse_group(center_raw)
        sc_raw = str(row.iloc[idx_sc] or "").strip() if idx_sc >= 0 else ""
        sales_channel = to_sales_channel(sc_raw or center_raw)
        cat = str(row.iloc[idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = _safe_int(row.iloc[idx_pack]) if idx_pack >= 0 else 1
        unit = _safe_float(row.iloc[idx_unit]) if idx_unit >= 0 else 0.0
        total = _safe_float(row.iloc[idx_total]) if idx_total >= 0 else 0.0

        _debug_log(debug, f"  row {i}: parsed quantity={qty}, center={center_raw}, warehouse_group={wh_group}, date={date_str}, event_type=outbound")

        rows.append({
            "product_code": code,
            "product_name": name,
            "quantity": qty,
            "outbound_center": center_raw,
            "outbound_date": date_str,
            "warehouse_group": wh_group,
            "sales_channel": sales_channel,
            "event_type": "outbound",
            "dest_warehouse": center_raw or None,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "unit_price": unit,
            "total_price": total,
        })
    return rows


def parse_stock_excel(
    path: str,
    sheet_name: str = "재고",
    filename: str | None = None,
    debug: bool = False,
) -> list[dict]:
    """
    재고 시트 파싱
    - 헤더: 2행, 데이터: 3행~
    - 품번→product_code, 상품명→product_name, 재고 수량→quantity,
      보관 센터→storage_center, 기준일자→stock_date
    - unit_cost, total_price (DB 호환)
    """
    if not HAS_PANDAS:
        raise RuntimeError("pandas required for parse_stock_excel")
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    if len(df) <= HEADER_ROW:
        return []
    header_row = list(df.iloc[HEADER_ROW])
    raw_headers = [str(h or "").strip() for h in header_row[:25]]
    normalized_headers = [_norm(h) for h in raw_headers]

    _debug_log(debug, "selected sheet:", sheet_name)
    _debug_log(debug, "header row index:", HEADER_ROW)
    _debug_log(debug, "raw headers:", raw_headers)
    _debug_log(debug, "normalized headers:", normalized_headers)

    idx_code = _find_col(header_row, "product_code")
    idx_name = _find_col(header_row, "product_name")
    idx_qty = _find_qty_col(header_row, "stock")
    idx_center = _find_col(header_row, "storage_center")
    idx_date = _find_col(header_row, "stock_date")
    idx_cost = _find_col(header_row, "unit_cost")
    idx_total = _find_col(header_row, "total_price")
    idx_cat = _find_col(header_row, "category")
    idx_pack = _find_col(header_row, "pack_size")

    col_map = {
        "product_code": idx_code,
        "product_name": idx_name,
        "quantity": idx_qty,
        "storage_center": idx_center,
        "stock_date": idx_date,
        "unit_cost": idx_cost,
        "total_price": idx_total,
        "category": idx_cat,
        "pack_size": idx_pack,
    }
    _debug_log(debug, "column mapping:", col_map)

    if idx_code < 0 or idx_qty < 0:
        return []

    year = _year_from_filename(filename)
    today = datetime.now().strftime("%Y-%m-%d")
    rows = []
    for i in range(DATA_START_ROW, len(df)):
        row = df.iloc[i]
        code = str(row.iloc[idx_code] or "").strip()
        if not _valid_product_code(code):
            continue
        qty = _safe_int(row.iloc[idx_qty] if idx_qty < len(row) else 0)
        name = str(row.iloc[idx_name] or "").strip() if idx_name >= 0 else ""
        name = name or code
        center_raw = str(row.iloc[idx_center] or "").strip() if idx_center >= 0 else ""
        center = center_raw if center_raw else "제이에스"
        date_val = row.iloc[idx_date] if idx_date < len(row) else None
        date_str = _parse_date(date_val, year, today)
        cost = _safe_float(row.iloc[idx_cost]) if idx_cost >= 0 else 0.0
        total = _safe_float(row.iloc[idx_total]) if idx_total >= 0 else 0.0
        wh_group = classify_warehouse_group(center)
        cat = str(row.iloc[idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = _safe_int(row.iloc[idx_pack]) if idx_pack >= 0 else 1

        _debug_log(debug, f"  row {i}: parsed quantity={qty}, center={center}, warehouse_group={wh_group}, date={date_str}")

        rows.append({
            "product_code": code,
            "product_name": name,
            "quantity": qty,
            "storage_center": center,
            "stock_date": date_str or today,
            "warehouse_group": wh_group,
            "event_type": "stock",
            "dest_warehouse": center,
            "unit_cost": cost,
            "total_price": total if total > 0 else 0,
            "snapshot_date": date_str or today,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
        })
    return rows


def parse_excel_all(
    path: str,
    filename: str | None = None,
    debug: bool = False,
) -> dict[str, list[dict]]:
    """
    입고/출고/재고 전체 파싱
    시트 존재 여부 확인 후 각각 파싱
    """
    if not HAS_PANDAS:
        raise RuntimeError("pandas required for parse_excel_all")
    xl = pd.ExcelFile(path)
    sheet_names = xl.sheet_names
    _debug_log(debug, "sheet names:", sheet_names)

    def find_sheet(want: str) -> str | None:
        wn = _norm(want)
        for s in sheet_names:
            if _norm(s) == wn or want in _norm(s):
                return s
        return None

    result: dict[str, list[dict]] = {"inbound": [], "outbound": [], "stock": []}
    in_sheet = find_sheet("입고")
    out_sheet = find_sheet("출고")
    stock_sheet = find_sheet("재고")

    if in_sheet:
        result["inbound"] = parse_inbound_excel(path, in_sheet, filename, debug)
    if out_sheet:
        result["outbound"] = parse_outbound_excel(path, out_sheet, filename, debug)
    if stock_sheet:
        result["stock"] = parse_stock_excel(path, stock_sheet, filename, debug)

    return result
