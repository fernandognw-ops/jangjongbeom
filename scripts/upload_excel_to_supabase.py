#!/usr/bin/env python3
"""
생산수불현황 Excel → Supabase 업로드 스크립트

inventory_products, inventory_inbound, inventory_outbound 테이블에 자동 업로드합니다.

- 품번/품목코드/SKU → code (제품 식별자)
- 날짜: 25.03.01, 2025-03-01 등 다양한 형식 → YYYY-MM-DD 자동 변환
- 중복: DB 기존 + 파일 내 동일 건(product_code, date, qty, channel) 자동 제외

사용법:
  python upload_excel_to_supabase.py [Excel파일경로]
  python upload_excel_to_supabase.py "25년 3월마감_생산수불현황.xlsx" --dry-run

25년 3월~26년 2월 자료를 순서대로 업로드:
  python upload_excel_to_supabase.py "25년 3월마감_생산수불현황.xlsx"
  python upload_excel_to_supabase.py "25년 4월마감_생산수불현황.xlsx"
  ...

환경변수:
  SUPABASE_URL, SUPABASE_KEY (또는 NEXT_PUBLIC_*)
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
    """헤더 행에서 컬럼명 찾기 (정확 일치 우선, 없으면 부분 일치)"""
    row = df.iloc[header_row]
    # 1순위: 정확 일치 (입수량 vs 수량 구분)
    for n in names:
        n_clean = n.replace(" ", "").replace("\n", "").lower()
        for i in range(len(row)):
            v = str(row.iloc[i] or "").replace(" ", "").replace("\n", "").lower()
            if v == n_clean:
                return i
    # 2순위: 부분 일치
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
    """날짜를 YYYY-MM-DD 형식으로 자동 변환 (과거 자료 다양한 형식 지원)"""
    if pd.isna(val):
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    # 이미 YYYY-MM-DD 형태
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    # YYYY.MM.DD, YYYY/MM/DD
    if len(s) >= 10 and s[4] in "./" and s[7] in "./":
        try:
            dt = pd.to_datetime(s[:10].replace(".", "-").replace("/", "-"))
            return dt.strftime("%Y-%m-%d")
        except Exception:
            pass
    # 25.03.01, 2025.03.01, 250301, 20250301 등
    try:
        dt = pd.to_datetime(val)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    # 25-03-01 → 2025-03-01
    if len(s) == 8 and s[2] in "-./" and s[5] in "-./":
        try:
            y, m, d = s.split(s[2])[0], s.split(s[2])[1], s.split(s[2])[2]
            year = int(y)
            if year < 100:
                year += 2000 if year < 50 else 1900
            return f"{year:04d}-{int(m):02d}-{int(d):02d}"
        except Exception:
            pass
    return None


def load_products(df: pd.DataFrame, sheet_name: str) -> list[dict]:
    """Rawdata 시트에서 제품 목록 추출"""
    products = []
    for i in range(10):
        if find_col(df, i, ["품목코드", "품번", "제품코드", "SKU"]) >= 0:
            header_row = i
            break
    else:
        return []

    idx_code = find_col(df, header_row, ["품목코드", "품번", "제품코드", "SKU", "코드"])
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
        if not code or code.lower() == "nan" or not name or name.lower() == "nan":
            continue
        # 품목코드/품번은 숫자 위주 (예: 8809912471715) - "3월 잔여출고" 등 제외
        digits = sum(1 for c in code if c.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
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

    idx_code = find_col(df, header_row, ["품목코드", "품번", "제품코드", "SKU"])
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

    idx_code = find_col(df, header_row, ["품목코드", "품번", "제품코드", "SKU"])
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


def _inbound_dedup_key(r: dict) -> tuple:
    """중복 판별용 키: (product_code, inbound_date, quantity, sales_channel)"""
    return (
        str(r.get("product_code", "")),
        str(r.get("inbound_date", "")),
        int(r.get("quantity", 0)),
        str(r.get("sales_channel", "general")),
    )


def _outbound_dedup_key(r: dict) -> tuple:
    """중복 판별용 키"""
    return (
        str(r.get("product_code", "")),
        str(r.get("outbound_date", "")),
        int(r.get("quantity", 0)),
        str(r.get("sales_channel", "general")),
    )


def fetch_existing_inbound_keys(supabase: Client, table: str) -> set[tuple]:
    """DB에 이미 있는 입고 건의 (product_code, inbound_date, quantity, sales_channel) 집합"""
    keys = set()
    try:
        resp = supabase.table(table).select("product_code,inbound_date,quantity,sales_channel").execute()
        for row in resp.data or []:
            keys.add(
                (
                    str(row.get("product_code", "")),
                    str(row.get("inbound_date", ""))[:10],
                    int(row.get("quantity", 0)),
                    str(row.get("sales_channel", "general")),
                )
            )
    except Exception as e:
        print(f"  기존 입고 조회 경고: {e}")
    return keys


def fetch_existing_outbound_keys(supabase: Client, table: str) -> set[tuple]:
    """DB에 이미 있는 출고 건의 키 집합"""
    keys = set()
    try:
        resp = supabase.table(table).select("product_code,outbound_date,quantity,sales_channel").execute()
        for row in resp.data or []:
            keys.add(
                (
                    str(row.get("product_code", "")),
                    str(row.get("outbound_date", ""))[:10],
                    int(row.get("quantity", 0)),
                    str(row.get("sales_channel", "general")),
                )
            )
    except Exception as e:
        print(f"  기존 출고 조회 경고: {e}")
    return keys


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

    # 시트 찾기 (수불 마감 자료 형식: 생산계획_전체, 입고, 출고 등)
    raw_sheet = next(
        (s for s in sheet_names if "raw" in s.lower() or "제품" in s or "생산계획" in s),
        None,
    )
    in_sheet = next((s for s in sheet_names if s == "입고" or "입고" in s), None)
    out_sheet = next((s for s in sheet_names if s == "출고" or "출고" in s), None)

    if not raw_sheet:
        raw_sheet = (
            "Rawdata"
            if "Rawdata" in sheet_names
            else ("생산계획_전체" if "생산계획_전체" in sheet_names else sheet_names[0])
        )
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

    # 2. inbound insert (DB 기존 + 파일 내 중복 제거)
    if inbound:
        existing_in = fetch_existing_inbound_keys(supabase, TABLE_INBOUND)
        seen_in_file: set[tuple] = set()
        to_insert = []
        for r in inbound:
            k = _inbound_dedup_key(r)
            if k in existing_in or k in seen_in_file:
                continue
            seen_in_file.add(k)
            to_insert.append(r)
        skipped = len(inbound) - len(to_insert)
        if skipped:
            print(f"\n입고: 기존 중복 {skipped}건 제외, 신규 {len(to_insert)}건 업로드")
        if to_insert:
            print("\n입고 업로드 중...")
            for i in range(0, len(to_insert), 100):
                batch = to_insert[i : i + 100]
                try:
                    supabase.table(TABLE_INBOUND).insert(batch).execute()
                    print(f"  {min(i + 100, len(to_insert))}/{len(to_insert)} 완료")
                except Exception as e:
                    print(f"  오류: {e}")
                    raise

    # 3. outbound insert (DB 기존 + 파일 내 중복 제거)
    if outbound:
        existing_out = fetch_existing_outbound_keys(supabase, TABLE_OUTBOUND)
        seen_out_file: set[tuple] = set()
        to_insert = []
        for r in outbound:
            k = _outbound_dedup_key(r)
            if k in existing_out or k in seen_out_file:
                continue
            seen_out_file.add(k)
            to_insert.append(r)
        skipped = len(outbound) - len(to_insert)
        if skipped:
            print(f"\n출고: 기존 중복 {skipped}건 제외, 신규 {len(to_insert)}건 업로드")
        if to_insert:
            print("\n출고 업로드 중...")
            for i in range(0, len(to_insert), 100):
                batch = to_insert[i : i + 100]
                try:
                    supabase.table(TABLE_OUTBOUND).insert(batch).execute()
                    print(f"  {min(i + 100, len(to_insert))}/{len(to_insert)} 완료")
                except Exception as e:
                    print(f"  오류: {e}")
                    raise

    print("\n업로드 완료.")


if __name__ == "__main__":
    main()
