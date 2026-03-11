#!/usr/bin/env python3
"""
생산수불현황 Excel → Supabase 업로드 스크립트

products, inbound, outbound 테이블에 자동 업로드합니다.

사용법:
  python upload_excel_to_supabase.py [Excel파일경로]

환경변수:
  SUPABASE_URL      - Supabase Project URL (필수)
  SUPABASE_KEY      - Supabase anon key 또는 service_role key (필수)

예시:
  set SUPABASE_URL=https://xxxxx.supabase.co
  set SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  python upload_excel_to_supabase.py "C:/Downloads/0304_생산수불현황.xlsx"
"""

import argparse
import os
import sys
from datetime import datetime
from typing import Any, Optional

# 의존성 체크
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


def find_col(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """헤더 행에서 컬럼명 찾기 (부분 일치)"""
    row = df.iloc[header_row]
    for n in names:
        n_clean = n.replace(" ", "").replace("\n", "").lower()
        for i in range(len(row)):
            v = str(row.iloc[i] or "").replace(" ", "").replace("\n", "").lower()
            if n_clean in v or v in n_clean:
                return i
    return -1


def to_sales_channel(val: Any) -> str:
    """매출구분 → coupang | general"""
    s = str(val or "").strip().lower()
    if "쿠팡" in s or "coupang" in s:
        return "coupang"
    return "general"


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
        return f if f > 0 else None
    except (ValueError, TypeError):
        return None


def parse_date(val: Any) -> Optional[str]:
    """날짜를 YYYY-MM-DD로"""
    if pd.isna(val):
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, str) and len(val) >= 10:
        return val[:10]
    try:
        dt = pd.to_datetime(val)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None


def load_products(df: pd.DataFrame, sheet_name: str) -> list[dict]:
    """Rawdata 시트에서 제품 목록 추출"""
    products = []
    for i in range(10):
        if find_col(df, i, ["품목코드", "제품코드"]) >= 0:
            header_row = i
            break
    else:
        return []

    idx_code = find_col(df, header_row, ["품목코드", "제품코드", "코드"])
    idx_name = find_col(df, header_row, ["품목명", "제품명", "상품명"])
    idx_group = find_col(df, header_row, ["품목구분", "품목"])
    idx_cost = find_col(df, header_row, ["원가", "제품원가표", "단가"])
    idx_sub = find_col(df, header_row, ["하위품목", "하위 품목"])
    idx_spec = find_col(df, header_row, ["규격"])
    idx_pack = find_col(df, header_row, ["입수량", "입수"])
    idx_sc = find_col(df, header_row, ["매출구분", "판매처"])

    if idx_code < 0 or idx_name < 0 or idx_group < 0:
        return []

    seen = set()
    for i in range(header_row + 1, len(df)):
        row = df.iloc[i]
        code = str(row.iloc[idx_code] or "").strip()
        name = str(row.iloc[idx_name] or "").strip()
        group = str(row.iloc[idx_group] or "").strip()
        if not code or not name:
            continue
        if code in seen:
            continue
        seen.add(code)

        unit_cost = safe_float(row.iloc[idx_cost]) if idx_cost >= 0 else None
        pack_size = safe_int(row.iloc[idx_pack]) if idx_pack >= 0 else 1
        if pack_size <= 0:
            pack_size = 1

        sc = to_sales_channel(row.iloc[idx_sc]) if idx_sc >= 0 else "general"

        products.append({
            "code": code,
            "name": name,
            "group_name": group or "기타",
            "sub_group": str(row.iloc[idx_sub] or "").strip() if idx_sub >= 0 else "",
            "spec": str(row.iloc[idx_spec] or "").strip() if idx_spec >= 0 else "",
            "unit_cost": unit_cost or 0,
            "pack_size": pack_size,
            "sales_channel": sc,
        })
    return products


def load_inbound(df: pd.DataFrame) -> list[dict]:
    """입고 시트에서 입고 내역 추출"""
    records = []
    for i in range(10):
        if find_col(df, i, ["입고일자", "입고일"]) >= 0:
            header_row = i
            break
    else:
        return []

    idx_code = find_col(df, header_row, ["품목코드", "제품코드"])
    idx_qty = find_col(df, header_row, ["수량"])
    idx_date = find_col(df, header_row, ["입고일자", "입고일", "일자"])
    idx_source = find_col(df, header_row, ["출고처", "생산처"])
    idx_dest = find_col(df, header_row, ["입고처"])
    idx_sc = find_col(df, header_row, ["매출구분", "판매처"])
    idx_name = find_col(df, header_row, ["제품명", "품목명"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    for i in range(header_row + 1, len(df)):
        row = df.iloc[i]
        code = str(row.iloc[idx_code] or "").strip()
        qty = safe_int(row.iloc[idx_qty])
        date_str = parse_date(row.iloc[idx_date])
        if not code or qty <= 0 or not date_str:
            continue

        records.append({
            "product_code": code,
            "quantity": qty,
            "sales_channel": to_sales_channel(row.iloc[idx_sc]) if idx_sc >= 0 else "general",
            "inbound_date": date_str,
            "source_warehouse": str(row.iloc[idx_source] or "").strip() if idx_source >= 0 else None,
            "dest_warehouse": str(row.iloc[idx_dest] or "").strip() if idx_dest >= 0 else None,
            "note": str(row.iloc[idx_name] or "").strip()[:200] if idx_name >= 0 else None,
        })
    return records


def load_outbound(df: pd.DataFrame) -> list[dict]:
    """출고 시트에서 출고 내역 추출"""
    records = []
    for i in range(10):
        if find_col(df, i, ["출고일자", "출고일"]) >= 0:
            header_row = i
            break
    else:
        return []

    idx_code = find_col(df, header_row, ["품목코드", "제품코드"])
    idx_qty = find_col(df, header_row, ["수량"])
    idx_date = find_col(df, header_row, ["출고일자", "출고일", "일자"])
    idx_source = find_col(df, header_row, ["출고처"])
    idx_dest = find_col(df, header_row, ["입고처"])
    idx_sc = find_col(df, header_row, ["매출구분", "판매처"])
    idx_name = find_col(df, header_row, ["제품명", "품목명"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    for i in range(header_row + 1, len(df)):
        row = df.iloc[i]
        code = str(row.iloc[idx_code] or "").strip()
        qty = safe_int(row.iloc[idx_qty])
        date_str = parse_date(row.iloc[idx_date])
        if not code or qty <= 0 or not date_str:
            continue

        records.append({
            "product_code": code,
            "quantity": qty,
            "sales_channel": to_sales_channel(row.iloc[idx_sc]) if idx_sc >= 0 else "general",
            "outbound_date": date_str,
            "source_warehouse": str(row.iloc[idx_source] or "").strip() if idx_source >= 0 else None,
            "dest_warehouse": str(row.iloc[idx_dest] or "").strip() if idx_dest >= 0 else None,
            "note": str(row.iloc[idx_name] or "").strip()[:200] if idx_name >= 0 else None,
        })
    return records


def ensure_products_from_transactions(
    products: list[dict],
    inbound: list[dict],
    outbound: list[dict],
) -> list[dict]:
    """입고/출고에만 있는 제품을 products에 추가"""
    codes = {p["code"] for p in products}
    for r in inbound + outbound:
        code = r["product_code"]
        if code and code not in codes:
            codes.add(code)
            products.append({
                "code": code,
                "name": code,
                "group_name": "기타",
                "sub_group": "",
                "spec": "",
                "unit_cost": 0,
                "pack_size": 1,
                "sales_channel": r.get("sales_channel", "general"),
            })
    return products


def main() -> None:
    parser = argparse.ArgumentParser(description="생산수불현황 Excel → Supabase 업로드")
    parser.add_argument(
        "file",
        nargs="?",
        default=None,
        help="Excel 파일 경로 (예: 0304_생산수불현황.xlsx)",
    )
    parser.add_argument("--dry-run", action="store_true", help="업로드 없이 파싱만 테스트")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

    if not url or not key:
        print("오류: SUPABASE_URL, SUPABASE_KEY 환경변수를 설정하세요.")
        print("  set SUPABASE_URL=https://xxxxx.supabase.co")
        print("  set SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...")
        sys.exit(1)

    file_path = args.file
    if not file_path:
        # 기본 경로 검색
        for name in ["0304_생산수불현황.xlsx", "0310_생산수불현황.xlsx"]:
            for base in [os.path.expanduser("~/Downloads"), os.getcwd(), "."]:
                p = os.path.join(base, name)
                if os.path.exists(p):
                    file_path = os.path.abspath(p)
                    break
            if file_path:
                break
        if not file_path:
            print("오류: Excel 파일 경로를 지정하세요.")
            print("  python upload_excel_to_supabase.py C:\\Downloads\\0304_생산수불현황.xlsx")
            sys.exit(1)

    if not os.path.exists(file_path):
        print(f"오류: 파일을 찾을 수 없습니다: {file_path}")
        sys.exit(1)

    print(f"파일 로드: {file_path}")
    xl = pd.ExcelFile(file_path)
    sheet_names = xl.sheet_names

    # 시트 찾기 (이름 유사도)
    raw_sheet = next((s for s in sheet_names if "raw" in s.lower() or "제품" in s.lower()), None)
    in_sheet = next((s for s in sheet_names if "입고" in s), None)
    out_sheet = next((s for s in sheet_names if "출고" in s), None)

    if not raw_sheet:
        raw_sheet = "Rawdata" if "Rawdata" in sheet_names else sheet_names[0]
    if not in_sheet:
        in_sheet = "입고" if "입고" in sheet_names else None
    if not out_sheet:
        out_sheet = "출고" if "출고" in sheet_names else None

    products: list[dict] = []
    inbound: list[dict] = []
    outbound: list[dict] = []

    df_raw = pd.read_excel(file_path, sheet_name=raw_sheet, header=None)
    products = load_products(df_raw, 0)
    print(f"  Rawdata({raw_sheet}): 제품 {len(products)}건")

    if in_sheet:
        df_in = pd.read_excel(file_path, sheet_name=in_sheet, header=None)
        inbound = load_inbound(df_in)
        print(f"  입고({in_sheet}): {len(inbound)}건")
    else:
        print("  입고 시트 없음")

    if out_sheet:
        df_out = pd.read_excel(file_path, sheet_name=out_sheet, header=None)
        outbound = load_outbound(df_out)
        print(f"  출고({out_sheet}): {len(outbound)}건")
    else:
        print("  출고 시트 없음")

    products = ensure_products_from_transactions(products, inbound, outbound)
    print(f"  총 제품(중복 제거): {len(products)}건")

    if args.dry_run:
        print("\n[DRY-RUN] 업로드 생략")
        if products:
            print("  제품 샘플:", products[0])
        if inbound:
            print("  입고 샘플:", inbound[0])
        if outbound:
            print("  출고 샘플:", outbound[0])
        return

    if not products and not inbound and not outbound:
        print("업로드할 데이터가 없습니다.")
        sys.exit(1)

    supabase: Client = create_client(url, key)

    # 테이블명: inventory_* (기존 products와 충돌 방지)
    # supabase-schema-inventory-alt.sql 실행 필요
    TABLE_PRODUCTS = "inventory_products"
    TABLE_INBOUND = "inventory_inbound"
    TABLE_OUTBOUND = "inventory_outbound"

    # 1. products upsert
    if products:
        print("\n제품 업로드 중...")
        for i in range(0, len(products), 100):
            batch = products[i : i + 100]
            try:
                supabase.table(TABLE_PRODUCTS).upsert(
                    batch,
                    on_conflict="code",
                    ignore_duplicates=False,
                ).execute()
                print(f"  {min(i + 100, len(products))}/{len(products)} 완료")
            except Exception as e:
                print(f"  오류: {e}")
                print(f"  → supabase-schema-inventory-alt.sql 실행 후 재시도")
                raise

    # 2. inbound insert
    if inbound:
        print("\n입고 업로드 중...")
        for i in range(0, len(inbound), 100):
            batch = inbound[i : i + 100]
            try:
                supabase.table(TABLE_INBOUND).insert(batch).execute()
                print(f"  {min(i + 100, len(inbound))}/{len(inbound)} 완료")
            except Exception as e:
                print(f"  오류: {e}")
                raise

    # 3. outbound insert
    if outbound:
        print("\n출고 업로드 중...")
        for i in range(0, len(outbound), 100):
            batch = outbound[i : i + 100]
            try:
                supabase.table(TABLE_OUTBOUND).insert(batch).execute()
                print(f"  {min(i + 100, len(outbound))}/{len(outbound)} 완료")
            except Exception as e:
                print(f"  오류: {e}")
                raise

    print("\n업로드 완료.")


if __name__ == "__main__":
    main()
