#!/usr/bin/env python3
"""
생산수불현황 Excel → Supabase 전체 리셋 업로드

시트 이름·헤더(필드명) 기준으로 데이터 매핑. 시트 순서가 바뀌어도 동작.

1. Rawdata → inventory_products
2. 입고 → inventory_inbound
3. 출고 → inventory_outbound
4. 재고 → inventory_stock_snapshot (Replace, 금액=원가×수량). 창고명/보관장소 → dest_warehouse

사용 전:
  - scripts/truncate_inventory_tables.sql (선택)

사용법:
  python upload_excel_full_reset.py [Excel파일경로]
  python upload_excel_full_reset.py "26년 0311_생산수불현황.xlsx" --dry-run
"""
import argparse
import os
import sys
import time
from datetime import date
from typing import Any, Optional

TIMEOUT_SEC = 300  # 5분
BATCH_SIZE = 1000  # Supabase 권장 일괄 삽입

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
    from supabase import create_client, Client
except ImportError:
    print("supabase 필요: pip install supabase")
    sys.exit(1)


# --- 시트 이름 매칭 (순서 무관) ---
SHEET_RAW = ["rawdata", "raw data", "제품", "생산계획"]
SHEET_IN = ["입고"]
SHEET_OUT = ["출고"]
SHEET_STOCK = ["재고"]


def _norm(s: str) -> str:
    return str(s or "").replace(" ", "").replace("\n", "").replace("\r", "").lower()


def find_sheet(xl: pd.ExcelFile, candidates: list[str]) -> Optional[str]:
    """Rawdata, 재고, 입고, 출고 4개 시트만. 정확 일치 우선"""
    exact_match = {"rawdata": "Rawdata", "재고": "재고", "입고": "입고", "출고": "출고"}
    for c in candidates:
        cn = _norm(c)
        for exact, sheet in exact_match.items():
            if cn == _norm(exact) and sheet in xl.sheet_names:
                return sheet
    names = {_norm(s): s for s in xl.sheet_names}
    for c in candidates:
        cn = _norm(c)
        for k, v in names.items():
            if cn in k or k in cn:
                return v
    return None


def find_col(df: pd.DataFrame, header_row: int, names: list[str], exclude: list[str] | None = None) -> int:
    """헤더 행에서 필드명으로 컬럼 인덱스 찾기. exclude: 제외할 부분문자열"""
    row = df.iloc[header_row]
    excl = {_norm(x) for x in (exclude or [])}
    for n in names:
        n_clean = _norm(n)
        for i in range(len(row)):
            v = _norm(str(row.iloc[i] or ""))
            if any(ex in v for ex in excl):
                continue
            if n_clean in v or v in n_clean:
                return i
    return -1


def find_col_exact(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """정확 일치만 (품목 vs 품목명/품목코드 구분용)"""
    row = df.iloc[header_row]
    for n in names:
        n_clean = _norm(n)
        for i in range(len(row)):
            v = _norm(str(row.iloc[i] or ""))
            if v == n_clean:
                return i
    return -1


def find_header_row(df: pd.DataFrame, col_names: list[str], max_rows: int = 10) -> int:
    """헤더 행 인덱스 찾기 (품목코드 등 기준)"""
    for hr in range(min(max_rows, len(df))):
        if find_col(df, hr, col_names) >= 0:
            return hr
    return -1


def find_header_row_all(df: pd.DataFrame, required: list[list[str] | tuple[list[str], list[str]]], max_rows: int = 10) -> int:
    """필수 컬럼이 모두 있는 헤더 행 찾기. (names, exclude) 튜플 지원"""
    def _check(hr: int, item: list[str] | tuple[list[str], list[str]]) -> bool:
        if isinstance(item, tuple):
            names, excl = item
            return find_col(df, hr, names, exclude=excl) >= 0
        return find_col(df, hr, item) >= 0

    for hr in range(min(max_rows, len(df))):
        if all(_check(hr, r) for r in required):
            return hr
    return -1


def _clean_num(val: Any) -> str:
    """콤마, '원' 등 제거 후 순수 숫자 문자열"""
    s = str(val or "").strip().replace(",", "").replace(" ", "").replace("원", "").replace(" ", "")
    return s


def safe_int(val: Any) -> int:
    try:
        if pd.isna(val):
            return 0
        s = _clean_num(val)
        return int(float(s)) if s else 0
    except (ValueError, TypeError):
        return 0


def safe_float(val: Any) -> Optional[float]:
    try:
        if pd.isna(val):
            return None
        s = _clean_num(val)
        f = float(s) if s else 0
        return f if f >= 0 else None
    except (ValueError, TypeError):
        return None


def parse_date(val: Any) -> Optional[str]:
    if pd.isna(val):
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    try:
        dt = pd.to_datetime(val)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return None


def to_sales_channel(val: Any) -> str:
    """출고처가 '쿠팡'이면 coupang, 그 외는 general"""
    s = str(val or "").strip()
    if "쿠팡" in s or "coupang" in s.lower():
        return "coupang"
    return "general"


def warehouse_to_channel(warehouse: str) -> str:
    """창고명 → 채널: 테이칼튼→coupang, 제이에스/테이칼튼 1공장→general"""
    w = str(warehouse or "").strip()
    if "테이칼튼 1공장" in w or "제이에스" in w:
        return "general"
    if "테이칼튼" in w:
        return "coupang"
    return "general"


def _ensure_barcode(s: Any) -> str:
    """8809... 문자열 보존. 8.8E+12 등 지수 표기법 방지"""
    raw = str(s or "").strip()
    if not raw or raw.lower() == "nan":
        return ""
    if "e" in raw.lower() or "e+" in raw.lower():
        try:
            return str(int(float(raw)))
        except (ValueError, TypeError):
            return raw
    return raw


def _valid_code(code: str) -> bool:
    """바코드 형식(8809...) - 12자리 이상 숫자. 합계/소계 제외"""
    s = _ensure_barcode(code)
    if not s or "합계" in s or "소계" in s:
        return False
    digits = sum(1 for c in s if c.isdigit())
    return len(s) >= 12 and digits >= 12


# ========== ① Rawdata → inventory_products ==========
def load_rawdata_products(path: str, sheet_name: str) -> list[dict]:
    """Rawdata 시트 → inventory_products
    ID=품목코드(바코드), Name=품목명, Group=품목(카테고리), UnitCost=원가, PackSize=입수량
    sales_channel 제외 (출고 시 채널 처리)
    """
    df = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=str)
    hr = find_header_row(df, ["품목코드", "품번", "제품코드", "SKU"])
    if hr < 0:
        return []

    idx_code = find_col(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
    idx_name = find_col(df, hr, ["품목명", "제품명", "상품명"])
    idx_cost = find_col(df, hr, ["원가", "제품 원가표", "제품원가표", "단가", "개당 원가"])
    idx_cat = find_col_exact(df, hr, ["품목", "품목구분", "카테고리"])
    if idx_cat < 0:
        idx_cat = find_col(df, hr, ["품목(카테고리)"], exclude=["품목코드", "품목명"])
    idx_pack = find_col(df, hr, ["입수량", "입수"])

    if idx_code < 0 or idx_name < 0:
        return []

    seen = set()
    rows = []
    for r in range(hr + 1, len(df)):
        code = _ensure_barcode(df.iloc[r, idx_code])
        if not _valid_code(code) or code in seen:
            continue
        seen.add(code)

        name = str(df.iloc[r, idx_name] or "").strip() or code
        unit_cost = safe_float(df.iloc[r, idx_cost]) if idx_cost >= 0 else 0
        group = str(df.iloc[r, idx_cat] or "").strip() if idx_cat >= 0 else "기타"
        pack_size = safe_int(df.iloc[r, idx_pack]) if idx_pack >= 0 else 1
        if pack_size <= 0:
            pack_size = 1

        rows.append({
            "product_code": code,
            "product_name": name,
            "group_name": group or "기타",
            "sub_group": "",
            "spec": "",
            "unit_cost": unit_cost or 0,
            "pack_size": pack_size,
        })
    return rows


# ========== ② 입고 → inventory_inbound ==========
def load_inbound(path: str, sheet_name: str) -> list[dict]:
    """입고 시트 → inventory_inbound
    필드: 품목코드, 수량, 입고처(=dest_warehouse), 입고일자
    입고처: 테이칼튼/테이칼튼 1공장→쿠팡, 제이에스→일반
    All-in-One: product_name, category, spec, pack_size, unit_price, total_price
    """
    df = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=str)
    hr = find_header_row_all(df, [
        ["품목코드", "품번", "제품코드", "SKU"],
        ["수량"],
        ["입고일자", "입고일"],
    ])
    if hr < 0:
        return []

    idx_code = find_col(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
    idx_qty = find_col(df, hr, ["수량"], exclude=["입수량"])
    idx_date = find_col(df, hr, ["입고일자", "입고일", "일자"])
    idx_dest = find_col(df, hr, ["입고처", "dest_warehouse"])
    idx_name = find_col(df, hr, ["품목명", "제품명", "상품명"])
    idx_cat = find_col_exact(df, hr, ["품목", "품목구분", "카테고리"])
    if idx_cat < 0:
        idx_cat = find_col(df, hr, ["품목(카테고리)"], exclude=["품목코드", "품목명"])
    idx_spec = find_col(df, hr, ["규격", "스펙", "spec"])
    idx_pack = find_col(df, hr, ["입수량", "입수"])
    idx_unit = find_col(df, hr, ["단가", "원가", "개당 원가"])
    idx_total = find_col(df, hr, ["총 금액", "총금액", "금액"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    rows = []
    for r in range(hr + 1, len(df)):
        code = str(df.iloc[r, idx_code] or "").strip()
        qty = safe_int(df.iloc[r, idx_qty])
        date_str = parse_date(df.iloc[r, idx_date])
        if not _valid_code(code) or qty <= 0 or not date_str:
            continue

        dest = str(df.iloc[r, idx_dest] or "").strip() if idx_dest >= 0 else ""
        code = _ensure_barcode(code)

        product_name = str(df.iloc[r, idx_name] or "").strip() if idx_name >= 0 else ""
        category = str(df.iloc[r, idx_cat] or "").strip() if idx_cat >= 0 else ""
        spec = str(df.iloc[r, idx_spec] or "").strip() if idx_spec >= 0 else ""
        pack_size = safe_int(df.iloc[r, idx_pack]) if idx_pack >= 0 else 1
        if pack_size <= 0:
            pack_size = 1
        unit_price = safe_float(df.iloc[r, idx_unit]) if idx_unit >= 0 else 0
        total_price = safe_float(df.iloc[r, idx_total]) if idx_total >= 0 else None
        if total_price is None or total_price == 0:
            total_price = (unit_price or 0) * qty

        rows.append({
            "product_code": code,
            "product_name": product_name or code,
            "category": category or "기타",
            "spec": spec,
            "pack_size": pack_size,
            "unit_price": unit_price or 0,
            "total_price": round(total_price, 2),
            "quantity": qty,
            "inbound_date": date_str,
            "source_warehouse": None,
            "dest_warehouse": dest or None,
            "note": None,
        })
    return rows


# ========== ③ 출고 → inventory_outbound ==========
def load_outbound(path: str, sheet_name: str) -> list[dict]:
    """출고 시트 → inventory_outbound
    필드: 품목코드, 수량, 출고일자, 매출구분(채널)
    All-in-One: product_name, category, spec, pack_size, unit_price, total_price
    """
    df = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=str)
    hr = find_header_row_all(df, [
        ["품목코드", "품번", "제품코드", "SKU"],
        ["수량"],
        ["출고일자", "출고일"],
    ])
    if hr < 0:
        return []

    idx_code = find_col(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
    idx_qty = find_col(df, hr, ["수량"], exclude=["입수량"])
    idx_date = find_col(df, hr, ["출고일자", "출고일", "일자"])
    idx_sc = find_col(df, hr, ["매출구분", "출고처", "판매처", "채널", "매출구분(채널)"])
    idx_name = find_col(df, hr, ["품목명", "제품명", "상품명"])
    idx_cat = find_col_exact(df, hr, ["품목", "품목구분", "카테고리"])
    if idx_cat < 0:
        idx_cat = find_col(df, hr, ["품목(카테고리)"], exclude=["품목코드", "품목명"])
    idx_spec = find_col(df, hr, ["규격", "스펙", "spec"])
    idx_pack = find_col(df, hr, ["입수량", "입수"])
    idx_unit = find_col(df, hr, ["단가", "원가", "개당 원가"])
    idx_total = find_col(df, hr, ["총 금액", "총금액", "금액"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    rows = []
    for r in range(hr + 1, len(df)):
        code = str(df.iloc[r, idx_code] or "").strip()
        qty = safe_int(df.iloc[r, idx_qty])
        date_str = parse_date(df.iloc[r, idx_date])
        if not _valid_code(code) or qty <= 0 or not date_str:
            continue

        sc = to_sales_channel(df.iloc[r, idx_sc]) if idx_sc >= 0 else "general"
        code = _ensure_barcode(code)

        product_name = str(df.iloc[r, idx_name] or "").strip() if idx_name >= 0 else ""
        category = str(df.iloc[r, idx_cat] or "").strip() if idx_cat >= 0 else ""
        spec = str(df.iloc[r, idx_spec] or "").strip() if idx_spec >= 0 else ""
        pack_size = safe_int(df.iloc[r, idx_pack]) if idx_pack >= 0 else 1
        if pack_size <= 0:
            pack_size = 1
        unit_price = safe_float(df.iloc[r, idx_unit]) if idx_unit >= 0 else 0
        total_price = safe_float(df.iloc[r, idx_total]) if idx_total >= 0 else None
        if total_price is None or total_price == 0:
            total_price = (unit_price or 0) * qty

        rows.append({
            "product_code": code,
            "product_name": product_name or code,
            "category": category or "기타",
            "spec": spec,
            "pack_size": pack_size,
            "unit_price": unit_price or 0,
            "total_price": round(total_price, 2),
            "quantity": qty,
            "sales_channel": sc,
            "outbound_date": date_str,
            "source_warehouse": None,
            "dest_warehouse": None,
            "note": None,
        })
    return rows


# ========== ④ 재고 → inventory_stock_snapshot (product_code별 1건, dest_warehouse=창고명으로 채널분리) ==========
def load_stock_snapshot(path: str, sheet_name: str) -> tuple[list[dict], dict[str, float]]:
    """재고 시트 = 현재고 마스터. product_code+창고명(dest_warehouse=창고명 동일)별 수량·금액 합산하여 채널별 저장"""
    df = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=str)
    hr = find_header_row_all(df, [
        ["품목코드", "품번", "제품코드", "SKU"],
        (["수량", "재고", "재고수량"], ["입수량"]),
    ])
    if hr < 0:
        return [], {}

    idx_code = find_col(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
    idx_qty = find_col(df, hr, ["수량", "재고", "재고수량"], exclude=["입수량"])
    idx_amount = find_col(df, hr, ["재고 금액", "재고금액"])
    idx_pack = find_col(df, hr, ["입수량", "입수"])
    idx_date = find_col(df, hr, ["재고일자", "재고 일자", "일자"])
    idx_name = find_col(df, hr, ["품목명", "제품명", "상품명"])
    idx_cat = find_col_exact(df, hr, ["품목", "품목구분", "카테고리"])
    if idx_cat < 0:
        idx_cat = find_col(df, hr, ["품목(카테고리)"], exclude=["품목코드", "품목명"])
    idx_spec = find_col(df, hr, ["규격", "스펙", "spec"])
    idx_unit = find_col(df, hr, ["단가", "원가", "개당 원가"])
    # 창고명(또는 보관장소) → dest_warehouse 매핑
    idx_warehouse = find_col(df, hr, ["창고명", "창고", "보관장소", "보관처", "warehouse", "dest_warehouse"])

    if idx_code < 0 or idx_qty < 0:
        return [], {}

    max_date_str: str | None = None
    if idx_date >= 0:
        dates: list[str] = []
        for r in range(hr + 1, len(df)):
            d = parse_date(df.iloc[r, idx_date])
            if d:
                dates.append(d)
        max_date_str = max(dates) if dates else None

    # 1단계: product_code별 마스터 정보 수집 (바코드 동일 = 모든 제품정보 동일, 판매/창고 위치만 상이)
    product_master: dict[str, dict] = {}
    agg: dict[tuple[str, str], dict] = {}
    for r in range(hr + 1, len(df)):
        if max_date_str and idx_date >= 0:
            row_date = parse_date(df.iloc[r, idx_date])
            if row_date != max_date_str:
                continue
        code = _ensure_barcode(df.iloc[r, idx_code])
        if not _valid_code(code):
            continue

        qty = safe_int(df.iloc[r, idx_qty])
        amount_val = safe_float(df.iloc[r, idx_amount]) if idx_amount >= 0 else 0
        pack_size = safe_int(df.iloc[r, idx_pack]) if idx_pack >= 0 else 1
        if pack_size <= 0:
            pack_size = 1

        warehouse_raw = str(df.iloc[r, idx_warehouse] or "").strip() if idx_warehouse >= 0 else ""
        dest = warehouse_raw if warehouse_raw else "제이에스"

        product_name = str(df.iloc[r, idx_name] or "").strip() if idx_name >= 0 else ""
        category = str(df.iloc[r, idx_cat] or "").strip() if idx_cat >= 0 else ""
        spec = str(df.iloc[r, idx_spec] or "").strip() if idx_spec >= 0 else ""
        unit_price = safe_float(df.iloc[r, idx_unit]) if idx_unit >= 0 else 0

        if code not in product_master:
            product_master[code] = {
                "product_name": product_name or code,
                "category": category or "기타",
                "spec": spec,
                "pack_size": pack_size,
                "unit_price": unit_price,
            }
        else:
            pm = product_master[code]
            if product_name and not (pm.get("product_name") or "").strip():
                pm["product_name"] = product_name
            if category and not (pm.get("category") or "").strip():
                pm["category"] = category
            if spec and not (pm.get("spec") or "").strip():
                pm["spec"] = spec
            if unit_price and not pm.get("unit_price"):
                pm["unit_price"] = unit_price

        key = (code, dest)
        if key not in agg:
            agg[key] = {"qty": 0, "amount": 0.0}
        agg[key]["qty"] += qty
        agg[key]["amount"] += amount_val or 0

    # product_code별 단일 unit_cost (바코드 동일 = 원가 동일)
    total_by_code: dict[str, dict] = {}
    for (code, dest), data in agg.items():
        if code not in total_by_code:
            total_by_code[code] = {"qty": 0, "amount": 0.0}
        total_by_code[code]["qty"] += data["qty"]
        total_by_code[code]["amount"] += data["amount"]
    derived_cost: dict[str, float] = {}
    for code, t in total_by_code.items():
        if t["qty"] > 0 and t["amount"] > 0:
            derived_cost[code] = round(t["amount"] / t["qty"], 2)

    today = max_date_str or date.today().isoformat()
    rows = []
    for (code, dest), data in agg.items():
        qty = data["qty"]
        amount = data["amount"]
        pm = product_master.get(code, {})
        pack_size = pm.get("pack_size", 1) or 1
        uc = derived_cost.get(code) or (round(amount / qty, 2) if amount > 0 and qty > 0 else 0)
        unit_price = pm.get("unit_price") or uc
        total_price = round(qty * uc, 2) if uc else round(amount, 2)
        rows.append({
            "product_code": code,
            "dest_warehouse": dest,
            "product_name": (pm.get("product_name") or "").strip() or code,
            "category": pm.get("category") or "기타",
            "spec": pm.get("spec") or "",
            "unit_price": unit_price,
            "quantity": qty,
            "unit_cost": uc,
            "snapshot_date": today,
            "pack_size": pack_size,
            "total_price": total_price,
        })
    return rows, derived_cost


def main() -> None:
    parser = argparse.ArgumentParser(description="Excel 전체 리셋 업로드 (시트·헤더 기준)")
    parser.add_argument(
        "file",
        nargs="?",
        default=r"C:\Users\pc\Desktop\장종범\인수 인계서\물류 재고 관리 시스템 구축\수불 마감 자료\26년 0311_생산수불현황.xlsx",
        help="Excel 파일 경로",
    )
    parser.add_argument("--dry-run", action="store_true", help="업로드 없이 파싱만")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: SUPABASE_URL, SUPABASE_KEY 환경변수 필요")
        sys.exit(1)

    if not os.path.exists(args.file):
        print(f"오류: 파일 없음 {args.file}")
        sys.exit(1)

    xl = pd.ExcelFile(args.file)

    sheet_raw = find_sheet(xl, SHEET_RAW)
    sheet_in = find_sheet(xl, SHEET_IN)
    sheet_out = find_sheet(xl, SHEET_OUT)
    sheet_stock = find_sheet(xl, SHEET_STOCK)

    if not sheet_raw:
        print("오류: Rawdata 시트를 찾을 수 없습니다.")
        sys.exit(1)

    products = load_rawdata_products(args.file, sheet_raw)
    cost_map = {p["product_code"]: float(p["unit_cost"]) for p in products if p.get("unit_cost")}

    inbound = load_inbound(args.file, sheet_in) if sheet_in else []
    outbound = load_outbound(args.file, sheet_out) if sheet_out else []

    if not sheet_stock:
        print("오류: 재고 시트를 찾을 수 없습니다.")
        sys.exit(1)

    snapshot, derived_cost = load_stock_snapshot(args.file, sheet_stock)
    for p in products:
        if p["product_code"] in derived_cost and derived_cost[p["product_code"]] > 0:
            p["unit_cost"] = round(derived_cost[p["product_code"]], 2)

    # 입고/출고/재고에만 있는 품목을 products에 추가 (FK 방지)
    codes = {p["product_code"] for p in products}
    for r in inbound + outbound + [{"product_code": s["product_code"]} for s in snapshot]:
        c = _ensure_barcode(r.get("product_code", ""))
        if c and _valid_code(c) and c not in codes:
            codes.add(c)
            uc = round(derived_cost[c], 2) if c in derived_cost and derived_cost[c] > 0 else 0
            products.append({
                "product_code": c, "product_name": c, "group_name": "기타", "sub_group": "", "spec": "",
                "unit_cost": uc, "pack_size": 1,
            })

    cost_map = {p["product_code"]: float(p["unit_cost"]) for p in products if p.get("unit_cost")}
    total_val = sum(s["quantity"] * cost_map.get(s["product_code"], 0) for s in snapshot)
    print(f"Rawdata {len(products)}건 | 입고 {len(inbound)}건 | 출고 {len(outbound)}건 | 재고 {len(snapshot)}건 (금액 {total_val:,.0f}원)")

    if args.dry_run:
        print("[DRY-RUN] 업로드 생략")
        return

    supabase: Client = create_client(url, key)
    start = time.time()
    inserted = {"products": 0, "inbound": 0, "outbound": 0, "snapshot": 0}

    def timed_out() -> bool:
        return (time.time() - start) > TIMEOUT_SEC

    # 0. Purge: outbound, snapshot만 삭제. inbound는 누적(삭제 안 함)
    print("기존 출고/스냅샷 삭제 중...", end=" ", flush=True)
    for table, col, val in [
        ("inventory_outbound", "id", "00000000-0000-0000-0000-000000000000"),
        ("inventory_stock_snapshot", "product_code", "__NONE__"),
        ("inventory_current_products", "product_code", "__NONE__"),
    ]:
        try:
            supabase.table(table).delete().neq(col, val).execute()
        except Exception:
            pass
    print("완료")

    # 1. products (Upsert: 기존은 업데이트, 신규만 삽입. 중복 절대 없음)
    print("Rawdata Upsert 중...", end=" ", flush=True)
    for i in range(0, len(products), BATCH_SIZE):
        if timed_out():
            break
        batch = products[i : i + BATCH_SIZE]
        supabase.table("inventory_products").upsert(
            batch, on_conflict="product_code", ignore_duplicates=False
        ).execute()
        inserted["products"] += len(batch)
    print(f"완료({inserted['products']}건)")

    # 2. inbound (product_code+inbound_date 동일 시 수량·total_price 합산)
    if inbound:
        agg: dict[tuple, dict] = {}
        for r in inbound:
            key = (r["product_code"], r["inbound_date"][:10])
            if key not in agg:
                agg[key] = {**r, "quantity": r["quantity"], "total_price": r.get("total_price", 0) or 0}
            else:
                agg[key]["quantity"] += r["quantity"]
                agg[key]["total_price"] = round((agg[key].get("total_price") or 0) + (r.get("total_price") or 0), 2)
        to_upsert = list(agg.values())
        print("입고 업로드 중...", end=" ", flush=True)
        for i in range(0, len(to_upsert), BATCH_SIZE):
            if timed_out():
                break
            batch = to_upsert[i : i + BATCH_SIZE]
            try:
                supabase.table("inventory_inbound").upsert(
                    batch, on_conflict="product_code,inbound_date", ignore_duplicates=False
                ).execute()
                inserted["inbound"] += len(batch)
            except Exception as e:
                print(f"\n  입고 upsert 오류: {e}")
                if batch:
                    print(f"  샘플 행: {batch[0]}")
        print(f"완료({inserted['inbound']}건)")

    # 3. outbound (product_code+outbound_date+sales_channel 동일 시 수량·total_price 합산)
    if outbound:
        agg_out: dict[tuple, dict] = {}
        for r in outbound:
            key = (r["product_code"], r["outbound_date"][:10], r["sales_channel"])
            if key not in agg_out:
                agg_out[key] = {**r, "quantity": r["quantity"], "total_price": r.get("total_price", 0) or 0}
            else:
                agg_out[key]["quantity"] += r["quantity"]
                agg_out[key]["total_price"] = round((agg_out[key].get("total_price") or 0) + (r.get("total_price") or 0), 2)
        to_insert_out = list(agg_out.values())
        print("출고 업로드 중...", end=" ", flush=True)
        for i in range(0, len(to_insert_out), BATCH_SIZE):
            if timed_out():
                break
            batch = to_insert_out[i : i + BATCH_SIZE]
            try:
                supabase.table("inventory_outbound").insert(batch).execute()
                inserted["outbound"] += len(batch)
            except Exception as e:
                print(f"\n  출고 insert 오류: {e}")
                for j, row in enumerate(batch):
                    print(f"    행 {i+j}: product_code={row.get('product_code')} outbound_date={row.get('outbound_date')} sales_channel={row.get('sales_channel')}")
        print(f"완료({inserted['outbound']}건)")

    # 4. stock_snapshot (Replace, Bulk) - (product_code, dest_warehouse) 복합 PK
    # 사전: scripts/migrate_snapshot_channel_pk.sql 실행 필요
    print("재고 스냅샷 업로드 중...", end=" ", flush=True)
    try:
        supabase.table("inventory_stock_snapshot").delete().neq("product_code", "__NONE__").execute()
    except Exception:
        pass
    try:
        for i in range(0, len(snapshot), BATCH_SIZE):
            if timed_out():
                break
            batch = snapshot[i : i + BATCH_SIZE]
            supabase.table("inventory_stock_snapshot").upsert(batch, on_conflict="product_code,dest_warehouse", ignore_duplicates=False).execute()
            inserted["snapshot"] += len(batch)
        print(f"완료({inserted['snapshot']}건)")
    except Exception as e:
        err_msg = str(e) if hasattr(e, "__str__") else repr(e)
        if "ON CONFLICT" in err_msg or "42P10" in err_msg or "unique" in err_msg.lower():
            print(f"\n  → Supabase SQL Editor에서 scripts/migrate_snapshot_channel_pk.sql 을 먼저 실행하세요.")
        raise

    # 5. current_products (대시보드 품목 수 표시용)
    current_rows = [{"product_code": p["product_code"]} for p in products]
    if current_rows:
        try:
            supabase.table("inventory_current_products").upsert(current_rows, on_conflict="product_code", ignore_duplicates=False).execute()
        except Exception:
            pass

    elapsed = time.time() - start
    if timed_out():
        print(f"\n[5분 초과] 강제 종료. 현재까지: products {inserted['products']}, inbound {inserted['inbound']}, outbound {inserted['outbound']}, snapshot {inserted['snapshot']}")
    else:
        print(f"\n완료 ({elapsed:.1f}초) | 재고 금액 {total_val:,.0f}원 | 품목 마스터 {inserted['products']}건 (Upsert, 중복 없음)")


if __name__ == "__main__":
    main()
