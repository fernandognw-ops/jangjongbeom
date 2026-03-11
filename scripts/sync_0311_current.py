#!/usr/bin/env python3
"""
0311_생산수불현황.xlsx 기준으로 현재 운영 품목 및 재고 스냅샷 동기화

1. Rawdata → 현재 운영 품목 (inventory_current_products)
2. 재고 시트 → inventory_stock_snapshot (제품 마스터 있는 품목)
3. 재고 시트 → inventory_discontinued_stock_snapshot (제품 마스터 없는 품목 = 단종/미등록)
4. 나머지 품목 → is_active=false (단종)

사전: scripts/migrate_snapshot_channel_pk.sql, scripts/create_discontinued_stock_snapshot.sql
"""
import argparse
import os
import sys
from datetime import date

# .env.local에서 환경변수 로드 (Next.js 프로젝트와 동일)
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


def _find_col(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """헤더 행에서 컬럼 인덱스 찾기"""
    row = df.iloc[header_row]
    for n in names:
        n_clean = n.replace(" ", "").replace("\n", "").lower()
        for i in range(len(row)):
            v = str(row.iloc[i] or "").replace(" ", "").replace("\n", "").lower()
            if n_clean in v or v in n_clean:
                return i
    return -1


def load_rawdata_cost_map(path: str) -> dict[str, float]:
    """Rawdata 시트에서 품목코드 → 제품 원가표(개당) 매핑"""
    pm = load_rawdata_product_master(path)
    return {c: p["unit_cost"] for c, p in pm.items() if p.get("unit_cost")}


def load_rawdata_product_master(path: str) -> dict[str, dict]:
    """Rawdata 시트에서 품목코드별 제품 마스터 (바코드 동일 = 모든 정보 동일)"""
    df = pd.read_excel(path, sheet_name="Rawdata", header=None)
    idx_code, header_row = 1, 3
    for i in range(10):
        for c, v in enumerate(df.iloc[i]):
            s = str(v or "").replace(" ", "").lower()
            if "품목코드" in s or "품번" in s or "제품코드" in s:
                idx_code, header_row = c, i
                break
        else:
            continue
        break

    idx_name = _find_col(df, header_row, ["품목명", "제품명", "상품명"])
    idx_cost = _find_col(df, header_row, ["제품원가표", "제품 원가표", "원가", "단가"])
    idx_cat = _find_col(df, header_row, ["품목", "품목구분", "카테고리"])
    idx_spec = _find_col(df, header_row, ["규격", "스펙"])
    idx_pack = _find_col(df, header_row, ["입수량", "입수"])

    result: dict[str, dict] = {}
    for i in range(header_row + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for ch in code if ch.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
            continue
        product_name = str(df.iloc[i, idx_name] or "").strip() if idx_name >= 0 else ""
        category = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        spec = str(df.iloc[i, idx_spec] or "").strip() if idx_spec >= 0 else ""
        pack_size = 1
        try:
            val = df.iloc[i, idx_pack] if idx_pack >= 0 else None
            if pd.notna(val) and int(float(val)) > 0:
                pack_size = int(float(val))
        except (ValueError, TypeError):
            pass
        unit_cost = 0.0
        try:
            val = df.iloc[i, idx_cost] if idx_cost >= 0 else None
            if pd.notna(val) and float(val) > 0:
                unit_cost = float(val)
        except (ValueError, TypeError):
            pass
        result[code] = {
            "product_name": product_name or code,
            "category": category or "기타",
            "spec": spec,
            "pack_size": pack_size,
            "unit_cost": unit_cost,
        }
    return result


def load_current_codes(path: str) -> set[str]:
    """Rawdata 시트에서 현재 운영 품목코드 478개 추출"""
    df = pd.read_excel(path, sheet_name="Rawdata", header=None)
    idx_code, header_row = 1, 3
    for i in range(10):
        for c, v in enumerate(df.iloc[i]):
            s = str(v or "").replace(" ", "").lower()
            if "품목코드" in s or "품번" in s or "제품코드" in s:
                idx_code, header_row = c, i
                break
        else:
            continue
        break

    codes = set()
    for i in range(header_row + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for ch in code if ch.isdigit())
        if len(code) >= 5 and digits >= len(code) * 0.5:
            codes.add(code)
    return codes


def _find_col_stock(df: pd.DataFrame, header_row: int, names: list[str], exclude: list[str] | None = None) -> int:
    """재고 시트 헤더에서 컬럼 인덱스 찾기. exclude: 제외 (예: 수량 검색 시 입수량 제외)"""
    row = df.iloc[header_row]
    excl = {x.replace(" ", "").lower() for x in (exclude or [])}
    for n in names:
        n_clean = n.replace(" ", "").replace("\n", "").lower()
        for i in range(len(row)):
            v = str(row.iloc[i] or "").replace(" ", "").replace("\n", "").lower()
            if any(ex in v for ex in excl):
                continue
            if n_clean in v or v in n_clean:
                return i
    return -1


def _normalize_warehouse(warehouse: str) -> str:
    """창고명 → dest_warehouse. 테이칼튼/테이칼튼1공장=쿠팡, 제이에스/컬리=일반"""
    w = str(warehouse or "").strip().replace(" ", "")
    if "테이칼튼" in w and "1공장" in w:
        return "테이칼튼1공장"
    if "테이칼튼" in w:
        return "테이칼튼"
    if "제이에스" in w:
        return "제이에스"
    if "컬리" in w:
        return "컬리"
    return "제이에스"


def load_stock_snapshot(
    path: str,
    rawdata_cost_map: dict[str, float] | None = None,
    rawdata_product_master: dict[str, dict] | None = None,
) -> list[dict]:
    """재고 시트에서 품목별 수량·단가 추출. 바코드 동일 = 제품정보 동일 (판매/창고만 상이)"""
    df = pd.read_excel(path, sheet_name="재고", header=None)
    # 헤더 행 탐색 (0~5행)
    idx_code = idx_qty = idx_cost = idx_amount = -1
    header_row = 0
    for hr in range(min(6, len(df))):
        idx_code = _find_col_stock(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
        idx_qty = _find_col_stock(df, hr, ["수량", "재고", "재고수량"], exclude=["입수량"])
        idx_cost = _find_col_stock(df, hr, ["단가", "원가", "제품원가표", "재고원가"])
        idx_amount = _find_col_stock(df, hr, ["재고 금액", "재고금액", "재고원가"])
        if idx_code >= 0 and idx_qty >= 0:
            header_row = hr
            break
    if idx_code < 0 or idx_qty < 0:
        idx_code, idx_qty, idx_cost, idx_amount = 1, 7, 11, 12
        header_row = 3
    if idx_cost < 0:
        idx_cost = 11
    if idx_amount < 0:
        idx_amount = 12
    idx_warehouse = _find_col_stock(df, header_row, ["창고명", "창고", "보관장소", "보관처"])
    idx_name = _find_col_stock(df, header_row, ["품목명", "제품명", "상품명"])
    idx_pack = _find_col_stock(df, header_row, ["입수량", "입수"])
    product_master: dict[str, dict] = dict(rawdata_product_master or {})
    agg: dict[tuple[str, str], dict] = {}
    data_start = header_row + 2
    for r in range(data_start, len(df)):
        code = str(df.iloc[r, idx_code] or "").strip()
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for c in code if c.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
            continue

        qty_val = df.iloc[r, idx_qty] if idx_qty < df.shape[1] else 0
        qty = int(float(qty_val)) if pd.notna(qty_val) else 0
        amount_val = 0.0
        if idx_amount >= 0 and idx_amount < df.shape[1]:
            try:
                amount_val = float(df.iloc[r, idx_amount] or 0)
            except (ValueError, TypeError):
                pass
        cost_from_stock = 0.0
        if idx_cost >= 0 and idx_cost < df.shape[1]:
            try:
                cost_from_stock = float(df.iloc[r, idx_cost] or 0)
            except (ValueError, TypeError):
                pass
        if cost_from_stock <= 0 and amount_val > 0 and qty > 0:
            cost_from_stock = amount_val / qty

        warehouse_raw = str(df.iloc[r, idx_warehouse] or "").strip() if idx_warehouse >= 0 else ""
        dest = _normalize_warehouse(warehouse_raw)
        product_name = str(df.iloc[r, idx_name] or "").strip() if idx_name >= 0 else ""
        pack_size = 1
        if idx_pack >= 0:
            try:
                pv = df.iloc[r, idx_pack]
                if pd.notna(pv) and int(float(pv)) > 0:
                    pack_size = int(float(pv))
            except (ValueError, TypeError):
                pass

        if code not in product_master:
            product_master[code] = {
                "product_name": product_name or code,
                "unit_cost": cost_from_stock or (rawdata_cost_map or {}).get(code) or 0,
                "pack_size": pack_size,
            }
        else:
            if product_name and not (product_master[code].get("product_name") or "").strip():
                product_master[code]["product_name"] = product_name
            if not product_master[code].get("pack_size") and pack_size > 1:
                product_master[code]["pack_size"] = pack_size

        key = (code, dest)
        if key not in agg:
            agg[key] = {"qty": 0, "amount": 0.0, "cost_fallback": 0.0}
        agg[key]["qty"] += qty
        agg[key]["amount"] += amount_val
        if cost_from_stock > 0:
            agg[key]["cost_fallback"] = cost_from_stock

    total_by_code: dict[str, dict] = {}
    for (code, dest), data in agg.items():
        if code not in total_by_code:
            total_by_code[code] = {"qty": 0, "amount": 0.0}
        total_by_code[code]["qty"] += data["qty"]
        total_by_code[code]["amount"] += data["amount"]

    today = date.today().isoformat()
    result: list[dict] = []
    for (code, dest), data in agg.items():
        qty = data["qty"]
        pm = product_master.get(code, {})
        unit_cost = (rawdata_cost_map or {}).get(code) or pm.get("unit_cost")
        if not unit_cost:
            t = total_by_code.get(code, {})
            if t.get("qty") and t.get("amount"):
                unit_cost = t["amount"] / t["qty"]
            else:
                unit_cost = data.get("cost_fallback", 0)
        uc = round(float(unit_cost), 2)
        result.append({
            "product_code": code,
            "dest_warehouse": dest,
            "product_name": (pm.get("product_name") or "").strip() or code,
            "category": pm.get("category") or "기타",
            "quantity": qty,
            "unit_cost": uc,
            "snapshot_date": today,
            "pack_size": pm.get("pack_size", 1) or 1,
            "total_price": round(qty * uc, 2),
        })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="0311 기준 현재 품목·재고 동기화")
    parser.add_argument(
        "file",
        nargs="?",
        default=r"C:\Users\pc\Desktop\장종범\인수 인계서\물류 재고 관리 시스템 구축\수불 마감 자료\26년 0311_생산수불현황.xlsx",
        help="0311 Excel 파일 경로",
    )
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: SUPABASE_URL, SUPABASE_KEY 환경변수 필요")
        sys.exit(1)

    if not os.path.exists(args.file):
        print(f"오류: 파일 없음 {args.file}")
        sys.exit(1)

    rawdata_product_master = load_rawdata_product_master(args.file)
    rawdata_cost_map = {c: p["unit_cost"] for c, p in rawdata_product_master.items() if p.get("unit_cost")}
    current_codes = load_current_codes(args.file)
    snapshot = load_stock_snapshot(args.file, rawdata_cost_map, rawdata_product_master)
    total_val = sum(s["quantity"] * s["unit_cost"] for s in snapshot)

    used_rawdata = sum(1 for s in snapshot if s["product_code"] in rawdata_cost_map)
    print(f"0311 Rawdata: 현재 운영 품목 {len(current_codes)}건, 제품 원가표 {len(rawdata_cost_map)}건")
    print(f"0311 재고: 스냅샷 {len(snapshot)}건 (원가 Rawdata 적용 {used_rawdata}건), 총 재고 금액 {total_val:,.0f}원")

    supabase: Client = create_client(url, key)

    # 0. inventory_products에 있는 product_code 목록 조회 (FK 통과용)
    products_in_db: set[str] = set()
    try:
        products_res = supabase.table("inventory_products").select("product_code").execute()
        products_in_db = {r["product_code"] for r in (products_res.data or []) if r.get("product_code")}
    except Exception:
        pass

    # 스냅샷 분리: 제품 마스터 있음 → inventory_stock_snapshot, 없음 → inventory_discontinued_stock_snapshot
    # (둘 다 load_stock_snapshot에서 dest_warehouse 적용됨: 테이칼튼/테이칼튼1공장=쿠팡, 제이에스/컬리=일반)
    snapshot_active = [s for s in snapshot if s["product_code"] in products_in_db]
    snapshot_discontinued = [s for s in snapshot if s["product_code"] not in products_in_db]
    print(f"  재고 분류: 현재 품목 {len(snapshot_active)}건, 단종/미등록 {len(snapshot_discontinued)}건")

    # 1. inventory_current_products 테이블에 0311 품목 478건 upsert
    TABLE_CURRENT = "inventory_current_products"
    current_rows = [{"product_code": c} for c in current_codes]
    try:
        for i in range(0, len(current_rows), 100):
            batch = current_rows[i : i + 100]
            supabase.table(TABLE_CURRENT).upsert(batch, on_conflict="product_code").execute()
        print(f"  현재 운영 품목: {len(current_codes)}건 (inventory_current_products)")
    except Exception as e:
        print(f"  inventory_current_products 오류: {e}")
        print("  → supabase-schema-stock-snapshot.sql 실행 후 재시도")

    # 1b. is_active 컬럼이 있으면 업데이트 (선택)
    try:
        all_codes = list(products_in_db)
        active_codes = [c for c in all_codes if c in current_codes]
        discontinued_codes = [c for c in all_codes if c not in current_codes]
        if active_codes:
            supabase.table("inventory_products").update({"is_active": True}).in_("product_code", active_codes).execute()
        if discontinued_codes:
            supabase.table("inventory_products").update({"is_active": False}).in_("product_code", discontinued_codes).execute()
        print(f"  is_active 업데이트: 현재 {len(active_codes)}건, 단종 {len(discontinued_codes)}건")
    except Exception as e:
        print(f"  is_active 업데이트 생략 (컬럼 없음): {e}")

    # 2. 현재 품목 재고 스냅샷 → inventory_stock_snapshot
    print("\n재고 스냅샷 업로드 중...")
    for i in range(0, len(snapshot_active), 100):
        batch = snapshot_active[i : i + 100]
        try:
            supabase.table("inventory_stock_snapshot").upsert(
                batch,
                on_conflict="product_code,dest_warehouse",
                ignore_duplicates=False,
            ).execute()
            print(f"  현재 품목 {min(i + 100, len(snapshot_active))}/{len(snapshot_active)} 완료")
        except Exception as e:
            print(f"  오류: {e}")
            raise

    # 3. 단종/미등록 품목 재고 → inventory_discontinued_stock_snapshot (창고 분류 규칙 동일 적용)
    if snapshot_discontinued:
        print(f"\n단종품목 재고 업로드 중... ({len(snapshot_discontinued)}건)")
        try:
            for i in range(0, len(snapshot_discontinued), 100):
                batch = snapshot_discontinued[i : i + 100]
                supabase.table("inventory_discontinued_stock_snapshot").upsert(
                    batch,
                    on_conflict="product_code,dest_warehouse",
                    ignore_duplicates=False,
                ).execute()
                print(f"  단종 {min(i + 100, len(snapshot_discontinued))}/{len(snapshot_discontinued)} 완료")
        except Exception as e:
            print(f"  단종품목 테이블 오류: {e}")
            print("  → scripts/create_discontinued_stock_snapshot.sql 실행 후 재시도")

    print("\n동기화 완료.")


if __name__ == "__main__":
    main()
