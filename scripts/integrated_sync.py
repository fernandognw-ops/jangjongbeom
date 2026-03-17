#!/usr/bin/env python3
"""
4개 시트 엑셀 → Supabase 통합 동기화

[필수 시트] rawdata, 입고, 재고, 출고 (시트 이름 다르면 에러)

[매핑 - 품목코드 기준]
  rawdata   → inventory_products      (Upsert)
  입고      → inventory_inbound       (Upsert, product_code+inbound_date)
  재고      → inventory_stock_snapshot (기존 삭제 후 최신 재고로 교체)
  출고      → inventory_outbound       (Upsert, product_code+outbound_date+sales_channel)

[컬럼 매핑 - 정확 일치 우선]
  rawdata:   품목코드→product_code, 품목명 없으면 제품명→product_name,
             제품원가표(개당)→unit_cost, 품목→category, 입수량→pack_size
  입고:      품목코드, 품목명→제품명, 품목→품목구분→category, 입수량, 수량,
             입고처→dest_warehouse, 입고일자→inbound_date, 원가→unit_price, 합계원가→total_price
  재고:      품목코드, 품목명→제품명, 품목구분→category, 입수량, 수량,
             창고명→dest_warehouse, 재고일자→snapshot_date, 원가→unit_cost, 재고원가→total_price
  출고:      품목코드, 품목명→제품명, 품목 또는 품목구분→category, 입수량, 수량,
             출고처→dest_warehouse, 출고일자→outbound_date, 원가→unit_price, 합계→total_price, 매출구분→sales_channel

[사용법]
  npm run sync-excel "경로/엑셀.xlsx"        # 파일만 올리면 테이블 업데이트
  npm run sync-excel "경로/엑셀.xlsx" -- --reset  # 기존 데이터 삭제 후 재업로드
  python scripts/integrated_sync.py "경로/엑셀.xlsx" --dry-run  # 시뮬레이션

환경변수: .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Optional


def get_current_month_range() -> tuple[str, str]:
    """당월(현재 월) 첫날~마지막날. 당월 이전 데이터는 수정하지 않음."""
    now = datetime.now()
    y, m = now.year, now.month
    first = f"{y}-{m:02d}-01"
    if m == 12:
        last = f"{y}-12-31"
    else:
        last_day = (datetime(y, m + 1, 1) - timedelta(days=1)).day
        last = f"{y}-{m:02d}-{last_day:02d}"
    return first, last

# .env.local 로드
_env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
if os.path.exists(_env_path):
    with open(_env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and v:
                    os.environ.setdefault(k, v)

try:
    import pandas as pd
except ImportError:
    print("pandas 필요: pip install pandas openpyxl")
    sys.exit(1)
try:
    from supabase import create_client
except ImportError:
    print("supabase 필요: pip install supabase")
    sys.exit(1)

# 시트 이름 (대소문자 무시, 공백 제거 후 비교)
REQUIRED_SHEETS = {"rawdata", "입고", "재고", "출고"}
# 테이블명: env로 오버라이드 가능 (INTEGRATED_SYNC_RAWDATA_TABLE 등)
TABLE_RAWDATA = os.environ.get("INTEGRATED_SYNC_RAWDATA_TABLE", "inventory_products")
TABLE_INBOUND = os.environ.get("INTEGRATED_SYNC_INBOUND_TABLE", "inventory_inbound")
TABLE_STOCK = os.environ.get("INTEGRATED_SYNC_STOCK_TABLE", "inventory_stock_snapshot")
TABLE_OUTBOUND = os.environ.get("INTEGRATED_SYNC_OUTBOUND_TABLE", "inventory_outbound")
TABLE_CURRENT = os.environ.get("INTEGRATED_SYNC_CURRENT_TABLE", "inventory_current_products")
BATCH_SIZE = 200

# 수불현황 파일 검색 키워드 (생산수불현황, 수불현황 등)
SUPUL_FILENAME_PATTERNS = ("수불현황", "생산수불현황")

# 기본 검색 경로 (서브폴더 포함)
DEFAULT_SUPUL_SEARCH_DIRS = [
    "Desktop",
    "Desktop/장종범/인수 인계서/물류 재고 관리 시스템 구축/수불 마감 자료",
    "Downloads",
    "Documents",
]


def find_latest_supul_file() -> Optional[str]:
    """수불현황/생산수불현황이 포함된 가장 최신 .xlsx 파일 경로 반환. 서브폴더 포함 검색."""
    search_dirs: list[str] = []
    try:
        user_home = os.path.expanduser("~")
        if user_home:
            for rel in DEFAULT_SUPUL_SEARCH_DIRS:
                d = os.path.join(user_home, rel)
                if os.path.isdir(d):
                    search_dirs.append(d)
            if not any("Desktop" in d for d in search_dirs):
                search_dirs.insert(0, os.path.join(user_home, "Desktop"))
    except Exception:
        pass
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in search_dirs:
        search_dirs.append(project_root)

    candidates: list[tuple[float, str]] = []
    patterns_lower = [p.lower() for p in SUPUL_FILENAME_PATTERNS]
    for base_dir in search_dirs:
        if not os.path.isdir(base_dir):
            continue
        try:
            for name in os.listdir(base_dir):
                if not name.lower().endswith(".xlsx"):
                    continue
                if name.startswith("~$"):
                    continue
                name_lower = name.lower()
                if any(pat in name_lower for pat in patterns_lower):
                    full_path = os.path.join(base_dir, name)
                    if os.path.isfile(full_path):
                        try:
                            mtime = os.path.getmtime(full_path)
                            candidates.append((mtime, full_path))
                        except OSError:
                            pass
        except (PermissionError, OSError):
            continue

    if not candidates:
        return None
    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return candidates[0][1]


class TableNotFoundError(Exception):
    def __init__(self, table: str, msg: str = ""):
        super().__init__(f"Table not found: {table}")
        self.table = table
        self.msg = msg


def norm_sheet(s: str) -> str:
    return s.replace(" ", "").replace("\n", "").lower()


def find_col(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """헤더에서 names 중 하나와 일치(또는 포함)하는 컬럼 인덱스. 유사어 매칭."""
    row = df.iloc[header_row]
    for n in names:
        n_clean = norm_sheet(n)
        for i in range(len(row)):
            v = norm_sheet(str(row.iloc[i] or ""))
            if n_clean in v or v in n_clean:
                return i
    return -1


def find_col_exact(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """헤더에서 names 중 하나와 정확 일치하는 컬럼만. 유사어 혼동 방지."""
    row = df.iloc[header_row]
    for n in names:
        n_clean = norm_sheet(n)
        for i in range(len(row)):
            v = norm_sheet(str(row.iloc[i] or ""))
            if v == n_clean:
                return i
    return -1


def _find_col_exclude(df: pd.DataFrame, header_row: int, names: list[str], exclude: list[str]) -> int:
    """헤더에서 names 매칭, exclude에 포함된 컬럼 제외 (예: 수량 검색 시 입수량 제외)"""
    row = df.iloc[header_row]
    excl = {norm_sheet(x) for x in exclude}
    # "재고일자", "재고 일자" 등 날짜 컬럼 제외 (수량과 혼동 방지)
    date_excl = {"일자", "날짜", "date"}
    for n in names:
        n_clean = norm_sheet(n)
        for i in range(len(row)):
            v = norm_sheet(str(row.iloc[i] or ""))
            if any(ex in v for ex in excl):
                continue
            if any(d in v for d in date_excl) and n_clean != "재고일자":
                continue
            if n_clean in v or v in n_clean:
                return i
    return -1


def find_header_row(df: pd.DataFrame, required: list[list[str]]) -> int:
    """required: [[품목코드,품번], [수량], ...] - 각 그룹에서 하나라도 있으면 OK"""
    for r in range(min(15, len(df))):
        ok = True
        for group in required:
            if find_col(df, r, group) < 0:
                ok = False
                break
        if ok:
            # 숫자만 있는 행(잘못된 헤더) 제외: 첫 5열 중 한 셀이라도 한글이 있으면 OK
            row_preview = [str(df.iloc[r, c] or "") for c in range(min(5, df.shape[1]))]
            has_korean = any(any("\uac00" <= ch <= "\ud7a3" for ch in s) for s in row_preview)
            if has_korean:
                return r
    return -1


def safe_int(val: Any) -> int:
    try:
        if pd.isna(val):
            return 0
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def safe_float(val: Any) -> Optional[float]:
    try:
        if pd.isna(val):
            return None
        f = float(val)
        return f if f >= 0 else None
    except (ValueError, TypeError):
        return None


def parse_date(val: Any) -> Optional[str]:
    if pd.isna(val):
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    try:
        dt = pd.to_datetime(val)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return None


def to_sales_channel(val: Any) -> str:
    s = str(val or "").strip().lower()
    if "쿠팡" in s or "coupang" in s:
        return "coupang"
    return "general"


def validate_sheets(sheet_names: list[str]) -> dict[str, str]:
    """시트 이름 검증. 반환: {rawdata?, 입고, 재고, 출고} -> 실제 시트명. rawdata 없으면 생략(입고/재고/출고에서 품목 추출)"""
    norm_to_orig = {norm_sheet(s): s for s in sheet_names}
    result = {}

    def find_sheet(want: str, fallbacks: list[str] | None = None) -> str | None:
        w = norm_sheet(want)
        if w in norm_to_orig:
            return norm_to_orig[w]
        for orig in sheet_names:
            n = norm_sheet(orig)
            if want in n:
                return orig
            if want == "rawdata" and ("raw" in n and "data" in n):
                return orig
        if fallbacks:
            for fb in fallbacks:
                fb_norm = norm_sheet(fb)
                for orig in sheet_names:
                    if fb_norm in norm_sheet(orig) or norm_sheet(orig) in fb_norm:
                        return orig
        return None

    for want in ["입고", "재고", "출고"]:
        found = find_sheet(want)
        if found:
            result[want] = found
        else:
            raise SystemExit(
                f"오류: 필수 시트가 없습니다. 필요: 입고, 재고, 출고 / 발견: {sheet_names} / 누락: {want}"
            )
    # rawdata: 있으면 사용, 없으면 생략 (품목은 입고/재고/출고에서 FK 보장으로 추가)
    result["rawdata"] = find_sheet("rawdata", ["제품현황_일반", "제품현황_상세", "제품현황", "품절관리_일반", "품절관리"])
    return result


def load_rawdata(path: str, sheet_name: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["품목명", "제품명", "품명"]])
    if hr < 0:
        return []

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명", "품명"])
        idx_pool_name2 = -1
    idx_cost = find_col_exact(df, hr, ["제품 원가표(개당)", "제품원가표(개당)"])
    if idx_cost < 0:
        idx_cost = find_col(df, hr, ["제품원가표", "원가", "단가"])
    idx_cat = find_col_exact(df, hr, ["품목"])
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량", "입수"])

    if idx_code < 0:
        return []

    rows = []
    for i in range(hr + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for c in code if c.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cost = safe_float(df.iloc[i, idx_cost]) if idx_cost >= 0 else 0
        cat = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        if pack <= 0:
            pack = 1

        row: dict[str, Any] = {
            "product_code": code,
            "product_name": name,
            "unit_cost": cost or 0,
            "category": cat or "기타",
            "pack_size": pack,
        }
        rows.append(row)
    return rows


def load_inbound(path: str, sheet_name: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["수량"], ["입고일자", "입고일"]])
    if hr < 0:
        return []

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명"])
        idx_pool_name2 = -1
    idx_cat = find_col_exact(df, hr, ["품목구분"])
    if idx_cat < 0:
        idx_cat = find_col_exact(df, hr, ["품목"])
    if idx_cat < 0:
        idx_cat = find_col(df, hr, ["품목", "품목구분"])
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량"])
    idx_qty = find_col_exact(df, hr, ["수량"])
    if idx_qty < 0:
        idx_qty = find_col(df, hr, ["입고수량"])
    idx_wh = find_col_exact(df, hr, ["입고처"])
    idx_date = find_col_exact(df, hr, ["입고일자"])
    if idx_date < 0:
        idx_date = find_col(df, hr, ["입고일자", "입고일", "입고일자 주차"])
    idx_unit = find_col_exact(df, hr, ["원가"])
    idx_total = find_col_exact(df, hr, ["합계원가"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    rows = []
    for i in range(hr + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        qty = safe_int(df.iloc[i, idx_qty])
        date_str = parse_date(df.iloc[i, idx_date])
        if not code or code.lower() == "nan" or qty <= 0 or not date_str:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cat = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        wh = str(df.iloc[i, idx_wh] or "").strip() if idx_wh >= 0 else ""
        unit = safe_float(df.iloc[i, idx_unit]) if idx_unit >= 0 else None
        total = safe_float(df.iloc[i, idx_total]) if idx_total >= 0 else None

        rows.append({
            "product_code": code,
            "product_name": name,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "quantity": qty,
            "dest_warehouse": wh or None,
            "inbound_date": date_str,
            "unit_price": unit or 0,
            "total_price": total or 0,
        })
    return rows


def load_stock(path: str, sheet_name: str, debug: bool = False, check_product: str | None = None) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["수량", "재고"]])
    if hr < 0:
        return []

    if debug:
        headers = [str(df.iloc[hr, c] or "").strip() for c in range(min(20, df.shape[1]))]
        print(f"    [DEBUG] 재고 시트 헤더(최대20열): {headers}")

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명"])
        idx_pool_name2 = -1
    idx_cat = find_col_exact(df, hr, ["품목구분"])
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량"])
    # 수량: "수량"/"재고수량" 우선. "재고"/"재고 금액"/"재고일자" 제외 (금액·날짜와 혼동 방지)
    idx_qty = _find_col_exclude(df, hr, ["수량", "재고수량"], exclude=["입수량", "금액", "원가", "일자", "날짜"])
    if idx_qty < 0:
        idx_qty = find_col_exact(df, hr, ["수량"])
    if debug:
        print(f"    [DEBUG] 수량 컬럼 idx_qty={idx_qty}, 헤더={df.iloc[hr, idx_qty] if idx_qty >= 0 else None!r}")
    idx_wh = find_col_exact(df, hr, ["창고명"])
    if idx_wh < 0:
        idx_wh = find_col(df, hr, ["창고명", "창고", "보관장소", "보관처", "입고처", "warehouse", "dest_warehouse"])
    if debug:
        wh_col = df.iloc[hr, idx_wh] if idx_wh >= 0 else None
        print(f"    [DEBUG] 창고 컬럼: idx={idx_wh}, 헤더={wh_col!r}")
    idx_date = find_col_exact(df, hr, ["재고일자"])
    if idx_date < 0:
        idx_date = find_col(df, hr, ["재고일자", "재고일"])
    idx_cost = find_col_exact(df, hr, ["원가"])
    if idx_cost < 0:
        idx_cost = find_col(df, hr, ["원가"])
    # 재고 금액(합계) 우선 - 재고원가는 단가일 수 있음
    idx_total = find_col_exact(df, hr, ["재고 금액"])
    if idx_total < 0:
        idx_total = find_col_exact(df, hr, ["재고금액"])
    if idx_total < 0:
        idx_total = find_col(df, hr, ["재고 금액", "재고금액", "재고원가"])

    if idx_code < 0 or idx_qty < 0:
        return []

    rows = []
    # sync_0311과 동일: header_row + 2 (부제목 행 스킵)
    data_start = min(hr + 2, len(df))
    for i in range(data_start, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        qty = safe_int(df.iloc[i, idx_qty])
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for c in code if c.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cat = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        wh_raw = str(df.iloc[i, idx_wh] or "").strip() if idx_wh >= 0 else ""
        wh = wh_raw if wh_raw else "제이에스"
        cost = safe_float(df.iloc[i, idx_cost]) if idx_cost >= 0 else None
        total = safe_float(df.iloc[i, idx_total]) if idx_total >= 0 else None

        if check_product and code == check_product:
            row_preview = [str(df.iloc[i, c] or "")[:12] for c in range(min(18, df.shape[1]))]
            print(f"    [진단] 품목 {check_product} 원시행: idx_qty={idx_qty}, qty_raw={df.iloc[i, idx_qty] if idx_qty >= 0 else None!r}, 파싱qty={qty}, 행일부={row_preview}")
        rows.append({
            "product_code": code,
            "product_name": name,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "quantity": qty,
            "dest_warehouse": wh,
            "snapshot_date": datetime.now().strftime("%Y-%m-%d"),
            "unit_cost": cost or 0,
            "total_price": total or 0,
        })
    return rows


def load_outbound(path: str, sheet_name: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["수량"], ["출고일자", "출고일"]])
    if hr < 0:
        return []

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명"])
        idx_pool_name2 = -1
    idx_cat = find_col_exact(df, hr, ["품목"])
    idx_cat2 = find_col_exact(df, hr, ["품목구분"])
    if idx_cat < 0 and idx_cat2 < 0:
        idx_cat = find_col(df, hr, ["품목", "품목구분"])
        idx_cat2 = -1
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량"])
    idx_qty = find_col_exact(df, hr, ["수량"])
    if idx_qty < 0:
        idx_qty = find_col(df, hr, ["출고수량"])
    idx_wh = find_col_exact(df, hr, ["출고처"])
    idx_date = find_col_exact(df, hr, ["출고일자"])
    if idx_date < 0:
        idx_date = find_col(df, hr, ["출고일자", "출고일"])
    idx_unit = find_col_exact(df, hr, ["원가"])
    idx_total = find_col_exact(df, hr, ["합계"])
    if idx_total < 0:
        idx_total = find_col(df, hr, ["합계", "합계원가"])
    idx_sc = find_col_exact(df, hr, ["매출구분"])
    if idx_sc < 0:
        idx_sc = find_col(df, hr, ["매출구분", "판매처"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    rows = []
    for i in range(hr + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        qty = safe_int(df.iloc[i, idx_qty])
        date_str = parse_date(df.iloc[i, idx_date])
        if not code or code.lower() == "nan" or qty <= 0 or not date_str:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cat = ""
        if idx_cat >= 0:
            cat = str(df.iloc[i, idx_cat] or "").strip()
        if not cat and idx_cat2 >= 0:
            cat = str(df.iloc[i, idx_cat2] or "").strip()
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        wh = str(df.iloc[i, idx_wh] or "").strip() if idx_wh >= 0 else ""
        unit = safe_float(df.iloc[i, idx_unit]) if idx_unit >= 0 else None
        total = safe_float(df.iloc[i, idx_total]) if idx_total >= 0 else None
        sc = to_sales_channel(df.iloc[i, idx_sc]) if idx_sc >= 0 else "general"

        rows.append({
            "product_code": code,
            "product_name": name,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "quantity": qty,
            "dest_warehouse": wh or None,
            "outbound_date": date_str,
            "unit_price": unit or 0,
            "total_price": total or 0,
            "sales_channel": sc,
        })
    return rows


def _exit_missing_tables(table: str) -> None:
    sql_path = os.path.join(os.path.dirname(__file__), "create_inventory_tables_for_sync.sql")
    raise SystemExit(
        f"\n오류: 테이블 '{table}'이(가) 없습니다.\n\n"
        f"Supabase 대시보드 → SQL Editor에서 아래 파일을 실행하세요:\n"
        f"  {sql_path}\n\n"
        "테이블 생성 후 다시 sync-excel을 실행하세요."
    )


def truncate_table(supabase, table: str, key_column: str = "product_code") -> int:
    """테이블 전체 삭제 (TRUNCATE 대체). key_column이 있으면 neq로 전체 삭제 시도."""
    try:
        # product_code/id가 '__NONE__'이 아닌 모든 행 삭제 (= 전체 삭제)
        supabase.table(table).delete().neq(key_column, "__NONE__").execute()
        return -1  # 개수 모름
    except Exception:
        pass
    # 배치 삭제
    total = 0
    for pk in [key_column, "id"]:
        try:
            while True:
                res = supabase.table(table).select(pk).limit(500).execute()
                rows = res.data or []
                if not rows:
                    break
                vals = [r[pk] for r in rows if r.get(pk) is not None]
                if not vals:
                    break
                supabase.table(table).delete().in_(pk, vals).execute()
                total += len(rows)
            break
        except Exception:
            continue
    return total


def insert_batch(supabase, table: str, rows: list[dict], dry_run: bool) -> int:
    """테이블에 INSERT (재고 스냅샷용)"""
    if not rows:
        return 0
    if dry_run:
        print(f"  [DRY-RUN] {table}: {len(rows)}건 insert")
        return len(rows)
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            supabase.table(table).insert(batch).execute()
            total += len(batch)
        except Exception as e:
            if "could not find the table" in str(e).lower() or "PGRST205" in str(e):
                raise TableNotFoundError(table, str(e)) from e
            raise
    return total


def delete_by_date_range(supabase, table: str, date_col: str, date_from: str, date_to: str, dry_run: bool) -> bool:
    """해당 기간 데이터 삭제 (수불 교체 시 기존 데이터 제거)"""
    if dry_run:
        return True
    try:
        supabase.table(table).delete().gte(date_col, date_from).lte(date_col, date_to).execute()
        return True
    except Exception as e:
        print(f"    [경고] {table} 기간 삭제 실패: {e}")
        return False


def upsert_batch(supabase, table: str, rows: list[dict], on_conflict: list[str], dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        print(f"  [DRY-RUN] {table}: {len(rows)}건 upsert")
        return len(rows)
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            supabase.table(table).upsert(batch, on_conflict=",".join(on_conflict)).execute()
            total += len(batch)
        except Exception as e:
            if "could not find the table" in str(e).lower() or "PGRST205" in str(e):
                raise TableNotFoundError(table, str(e)) from e
            raise
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description="4개 시트 엑셀 → Supabase 통합 동기화")
    ap.add_argument(
        "file",
        nargs="?",
        default=None,
        help="엑셀 파일 경로 (생략 시 수불현황 포함된 가장 최신 .xlsx 자동 검색)",
    )
    ap.add_argument("--dry-run", action="store_true", help="실제 DB 반영 없이 시뮬레이션")
    ap.add_argument("--debug", action="store_true", help="재고 시트 헤더·창고 컬럼 진단 출력")
    ap.add_argument("--check-product", metavar="CODE", help="특정 품목코드 수량 추출 결과 진단 (예: 8809912473788)")
    ap.add_argument("--reset", action="store_true", help="기존 데이터 삭제 후 재업로드")
    args = ap.parse_args()

    if args.file:
        path = os.path.abspath(args.file)
    else:
        path = find_latest_supul_file()
        if not path:
            raise SystemExit(
                f"오류: 수불현황 파일을 찾을 수 없습니다. "
                f"Downloads/Desktop/Documents 또는 프로젝트 폴더에 '수불현황'이 포함된 .xlsx 파일을 넣거나, "
                f"경로를 직접 지정하세요.\n  예: npm run sync-excel -- \"경로/수불현황.xlsx\""
            )
        print(f"[자동 검색] 사용 파일: {path}")

    if not os.path.exists(path):
        raise SystemExit(f"오류: 파일 없음 - {path}")

    try:
        mtime = os.path.getmtime(path)
        mtime_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        print(f"[데이터 출처] {path}")
        print(f"[파일 수정일] {mtime_str} (이 날짜의 수불 데이터가 Supabase에 반영됩니다)")
    except Exception:
        pass

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요 (.env.local)")

    xl = pd.ExcelFile(path)
    sheet_map = validate_sheets(xl.sheet_names)
    print(f"[1] 시트 검증 완료: {sheet_map}")

    raw_rows: list[dict] = []
    if sheet_map.get("rawdata"):
        raw_rows = load_rawdata(path, sheet_map["rawdata"])
    print(f"[2] rawdata 파싱: {len(raw_rows)}건" + (" (시트 없음, 입고/재고/출고에서 품목 추출)" if not raw_rows and not sheet_map.get("rawdata") else ""))

    inbound_rows = load_inbound(path, sheet_map["입고"])
    print(f"    입고 파싱: {len(inbound_rows)}건")

    stock_rows = load_stock(path, sheet_map["재고"], debug=args.debug, check_product=args.check_product)
    stock_sum = sum(
        float(r.get("total_price") or 0) if (r.get("total_price") or 0) > 0
        else float(r.get("quantity") or 0) * float(r.get("unit_cost") or 0)
        for r in stock_rows
    )
    # 창고별 분포 진단
    wh_dist: dict[str, int] = {}
    for r in stock_rows:
        wh = str(r.get("dest_warehouse") or "").strip() or "제이에스"
        wh_dist[wh] = wh_dist.get(wh, 0) + 1
    wh_info = ", ".join(f"{k}:{v}건" for k, v in sorted(wh_dist.items(), key=lambda x: -x[1]))
    print(f"    재고 파싱: {len(stock_rows)}건 (엑셀 총합 {stock_sum:,.0f}원)")
    if len(wh_dist) <= 1 and wh_dist.get("제이에스", 0) == len(stock_rows):
        print(f"    ⚠ 창고 구분: 모두 제이에스. 재고 시트에 '창고명'/'입고처' 컬럼이 있는지 확인하세요.")
    else:
        print(f"    창고별: {wh_info}")

    if args.check_product:
        code = str(args.check_product).strip()
        matches = [r for r in stock_rows if str(r.get("product_code", "")).strip() == code]
        matches_partial = [r for r in stock_rows if code in str(r.get("product_code", "")).strip() or str(r.get("product_code", "")).strip() in code]
        agg_check: dict[str, int] = {}
        for r in matches:
            wh = str(r.get("dest_warehouse", "")).strip() or "제이에스"
            agg_check[wh] = agg_check.get(wh, 0) + r["quantity"]
        total_check = sum(agg_check.values())
        print(f"    [진단] 품목 {code}: 엑셀 원본 {len(matches)}행 (유사 {len(matches_partial)}행) → 창고별 {agg_check} → 합계 {total_check}")

    outbound_rows = load_outbound(path, sheet_map["출고"])
    print(f"    출고 파싱: {len(outbound_rows)}건")

    if args.dry_run:
        print("\n[DRY-RUN] DB 반영 생략")
        return

    supabase = create_client(url, key)

    if args.reset:
        print("\n[0] 기존 데이터 삭제 중...")
        for tbl, pk in [
            (TABLE_RAWDATA, "product_code"),
            (TABLE_INBOUND, "id"),
            (TABLE_STOCK, "product_code"),
            (TABLE_OUTBOUND, "id"),
        ]:
            try:
                n = truncate_table(supabase, tbl, pk)
                if n != 0:
                    msg = f"{n}행 삭제" if n > 0 else "삭제 완료"
                    print(f"    {tbl}: {msg}")
            except Exception as e:
                print(f"    {tbl}: 스킵 ({e})")
        print("    완료.\n")

    # rawdata → inventory_products (product_code 기준, Upsert)
    if raw_rows:
        try:
            n = upsert_batch(supabase, TABLE_RAWDATA, raw_rows, ["product_code"], args.dry_run)
            print(f"[3] {TABLE_RAWDATA}: {n}건 upsert")
        except TableNotFoundError:
            print(f"    {TABLE_RAWDATA}: 테이블 없음, 스킵 (나머지 진행)")

    # FK 보장: 입고/출고/재고에 등장하는 product_code가 inventory_products에 없으면 최소 행 추가
    if not args.dry_run:
        all_codes: set[str] = set()
        name_by_code: dict[str, str] = {}
        for rows, key in [
            (inbound_rows, "product_name"),
            (outbound_rows, "product_name"),
            (stock_rows, "product_name"),
        ]:
            for r in rows:
                c = str(r.get("product_code", "")).strip()
                if c:
                    all_codes.add(c)
                    if c not in name_by_code and r.get(key):
                        name_by_code[c] = str(r.get(key, c))
        if all_codes:
            try:
                existing: set[str] = set()
                codes_list = list(all_codes)
                for i in range(0, len(codes_list), BATCH_SIZE):
                    batch = codes_list[i : i + BATCH_SIZE]
                    res = supabase.table(TABLE_RAWDATA).select("product_code").in_("product_code", batch).execute()
                    for r in res.data or []:
                        existing.add(str(r.get("product_code", "")))
                missing = [c for c in all_codes if c not in existing]
                if missing:
                    to_insert = [
                        {
                            "product_code": c,
                            "product_name": name_by_code.get(c, c) or c,
                            "unit_cost": 0,
                            "category": "기타",
                            "pack_size": 1,
                        }
                        for c in missing
                    ]
                    for i in range(0, len(to_insert), BATCH_SIZE):
                        batch = to_insert[i : i + BATCH_SIZE]
                        supabase.table(TABLE_RAWDATA).upsert(batch, on_conflict="product_code").execute()
                    print(f"    {TABLE_RAWDATA}: FK용 {len(to_insert)}건 추가")
            except Exception as e:
                print(f"    {TABLE_RAWDATA} FK 보완 실패: {e}")

    # 입고: [품목코드+날짜] 기준 집계 후 upsert (product_code, inbound_date)
    if inbound_rows:
        agg: dict[tuple, dict] = {}
        for r in inbound_rows:
            k = (r["product_code"], r["inbound_date"])
            if k not in agg:
                agg[k] = dict(r)
                agg[k]["quantity"] = 0
            agg[k]["quantity"] += r["quantity"]
        inbound_merged = list(agg.values())
        month_start, month_end = get_current_month_range()
        # 수불 교체: 당월만 삭제 후 upsert (당월 이전 데이터는 유지)
        if not args.dry_run and inbound_merged:
            if delete_by_date_range(supabase, TABLE_INBOUND, "inbound_date", month_start, month_end, args.dry_run):
                print(f"    {TABLE_INBOUND}: 당월 {month_start}~{month_end} 기존 삭제 후")
        inbound_merged = [r for r in inbound_merged if month_start <= (r.get("inbound_date") or "")[:10] <= month_end]
        # unit_price/total_price가 0이면 inventory_products에서 보완
        if not args.dry_run and inbound_merged:
            codes = list({r["product_code"] for r in inbound_merged})
            cost_map: dict[str, float] = {}
            for i in range(0, len(codes), BATCH_SIZE):
                batch = codes[i : i + BATCH_SIZE]
                res = supabase.table(TABLE_RAWDATA).select("product_code,unit_cost").in_("product_code", batch).execute()
                for row in res.data or []:
                    uc = (row.get("unit_cost") or 0)
                    if uc > 0:
                        cost_map[str(row.get("product_code", ""))] = float(uc)
            for r in inbound_merged:
                if (r.get("unit_price") or 0) <= 0 and r["product_code"] in cost_map:
                    r["unit_price"] = cost_map[r["product_code"]]
                if (r.get("total_price") or 0) <= 0 and (r.get("unit_price") or 0) > 0:
                    r["total_price"] = round(r["quantity"] * r["unit_price"], 2)
        try:
            n = upsert_batch(
                supabase, TABLE_INBOUND, inbound_merged,
                ["product_code", "inbound_date"],
                args.dry_run,
            )
            print(f"    {TABLE_INBOUND}: {n}건 upsert")
        except TableNotFoundError as e:
            _exit_missing_tables(e.table)

    # 재고: 기존 데이터 삭제 후 최신 재고로 전체 교체 (product_code + dest_warehouse별 창고 구분)
    if stock_rows:
        try:
            # (product_code, dest_warehouse)별 집계 - 쿠팡/일반 창고별 개별 수량 유지
            agg: dict[tuple[str, str], dict] = {}
            for r in stock_rows:
                code = r["product_code"]
                wh = str(r.get("dest_warehouse") or "").strip() or "제이에스"
                key = (code, wh)
                if key not in agg:
                    agg[key] = dict(r)
                    agg[key]["dest_warehouse"] = wh
                    agg[key]["quantity"] = 0
                    agg[key]["total_price"] = 0.0
                agg[key]["quantity"] += r["quantity"]
                agg[key]["total_price"] = (agg[key].get("total_price") or 0) + float(r.get("total_price") or 0)
            for r in agg.values():
                r["total_price"] = round(r.get("total_price") or 0, 2)
            stock_merged = list(agg.values())

            if args.check_product:
                code = str(args.check_product).strip()
                merged_for_code = [r for r in stock_merged if str(r.get("product_code", "")).strip() == code]
                total_merged = sum(r["quantity"] for r in merged_for_code)
                print(f"    [진단] 품목 {code}: 집계 후 DB 저장 예정 {[(r['dest_warehouse'], r['quantity']) for r in merged_for_code]} → 합계 {total_merged}")

            # unit_cost/total_price가 0이면 inventory_products에서 보완 (엑셀에 원가 컬럼 없을 때)
            if not args.dry_run and stock_merged:
                codes = list({r["product_code"] for r in stock_merged})
                cost_map: dict[str, float] = {}
                for i in range(0, len(codes), BATCH_SIZE):
                    batch = codes[i : i + BATCH_SIZE]
                    res = supabase.table(TABLE_RAWDATA).select("product_code,unit_cost").in_("product_code", batch).execute()
                    for row in res.data or []:
                        uc = (row.get("unit_cost") or 0)
                        if uc > 0:
                            cost_map[str(row.get("product_code", ""))] = float(uc)
                for r in stock_merged:
                    if (r.get("unit_cost") or 0) <= 0 and r["product_code"] in cost_map:
                        r["unit_cost"] = cost_map[r["product_code"]]
                    if (r.get("total_price") or 0) <= 0 and (r.get("unit_cost") or 0) > 0:
                        r["total_price"] = round(r["quantity"] * r["unit_cost"], 2)

            merged_sum = sum(float(r.get("total_price") or 0) for r in stock_merged)
            # product_code 단일 PK: 품목당 1행. 수량이 가장 많은 창고를 dest_warehouse로 저장
            if not args.dry_run:
                n_del = truncate_table(supabase, TABLE_STOCK, "product_code")
                if n_del != 0:
                    msg = f"기존 {n_del}행 삭제" if n_del > 0 else "기존 데이터 삭제"
                    print(f"    {TABLE_STOCK}: {msg}")
            by_code: dict[str, dict] = {}
            for r in stock_merged:
                code = r["product_code"]
                if code not in by_code or r["quantity"] > by_code[code]["quantity"]:
                    by_code[code] = dict(r)
                else:
                    by_code[code]["quantity"] += r["quantity"]
                    by_code[code]["total_price"] = (by_code[code].get("total_price") or 0) + float(r.get("total_price") or 0)
            for x in by_code.values():
                x["total_price"] = round(x.get("total_price") or 0, 2)
            stock_for_db = list(by_code.values())
            n = insert_batch(supabase, TABLE_STOCK, stock_for_db, args.dry_run)
            print(f"    {TABLE_STOCK}: {n}건 삽입 (품목 {len(stock_for_db)}건, 창고: {len(set(r['dest_warehouse'] for r in stock_for_db))}개, 합계 {merged_sum:,.0f}원)")
        except TableNotFoundError as e:
            _exit_missing_tables(e.table)

    # 출고: (product_code, outbound_date, sales_channel) 기준 집계 후 upsert
    if outbound_rows:
        agg: dict[tuple, dict] = {}
        for r in outbound_rows:
            k = (r["product_code"], r["outbound_date"], r["sales_channel"])
            if k not in agg:
                agg[k] = dict(r)
                agg[k]["quantity"] = 0
            agg[k]["quantity"] += r["quantity"]
        outbound_merged = list(agg.values())
        month_start, month_end = get_current_month_range()
        # 수불 교체: 당월만 삭제 후 upsert (당월 이전 데이터는 유지)
        if not args.dry_run and outbound_merged:
            if delete_by_date_range(supabase, TABLE_OUTBOUND, "outbound_date", month_start, month_end, args.dry_run):
                print(f"    {TABLE_OUTBOUND}: 당월 {month_start}~{month_end} 기존 삭제 후")
        outbound_merged = [r for r in outbound_merged if month_start <= (r.get("outbound_date") or "")[:10] <= month_end]
        # unit_price/total_price가 0이면 inventory_products에서 보완
        if not args.dry_run and outbound_merged:
            codes = list({r["product_code"] for r in outbound_merged})
            cost_map: dict[str, float] = {}
            for i in range(0, len(codes), BATCH_SIZE):
                batch = codes[i : i + BATCH_SIZE]
                res = supabase.table(TABLE_RAWDATA).select("product_code,unit_cost").in_("product_code", batch).execute()
                for row in res.data or []:
                    uc = (row.get("unit_cost") or 0)
                    if uc > 0:
                        cost_map[str(row.get("product_code", ""))] = float(uc)
            for r in outbound_merged:
                if (r.get("unit_price") or 0) <= 0 and r["product_code"] in cost_map:
                    r["unit_price"] = cost_map[r["product_code"]]
                if (r.get("total_price") or 0) <= 0 and (r.get("unit_price") or 0) > 0:
                    r["total_price"] = round(r["quantity"] * r["unit_price"], 2)
        try:
            n = upsert_batch(
                supabase, TABLE_OUTBOUND, outbound_merged,
                ["product_code", "outbound_date", "sales_channel"],
                args.dry_run,
            )
            print(f"    {TABLE_OUTBOUND}: {n}건 upsert")
        except TableNotFoundError as e:
            _exit_missing_tables(e.table)

    # inventory_current_products 동기화 (대시보드 현재 품목 목록)
    if not args.dry_run:
        current_codes: set[str] = set()
        if stock_rows:
            for r in stock_rows:
                c = str(r.get("product_code", "")).strip()
                if c:
                    current_codes.add(c)
        for r in inbound_rows:
            c = str(r.get("product_code", "")).strip()
            if c:
                current_codes.add(c)
        for r in outbound_rows:
            c = str(r.get("product_code", "")).strip()
            if c:
                current_codes.add(c)
        if current_codes:
            try:
                to_upsert = [{"product_code": c} for c in current_codes]
                for i in range(0, len(to_upsert), BATCH_SIZE):
                    batch = to_upsert[i : i + BATCH_SIZE]
                    supabase.table(TABLE_CURRENT).upsert(batch, on_conflict="product_code").execute()
                print(f"    {TABLE_CURRENT}: {len(to_upsert)}건 동기화")
            except Exception as e:
                print(f"    {TABLE_CURRENT}: 스킵 ({e})")

    print("\n[4] 완료.")


if __name__ == "__main__":
    main()
