#!/usr/bin/env python3
"""
inventory_stock_snapshot, inventory_inbound, inventory_outbound의
unit_cost/unit_price, total_price를 inventory_products에서 보완

엑셀에 원가 컬럼이 없어 0으로 들어간 경우,
inventory_products의 unit_cost로 채우고 total_price = quantity * unit_cost 계산.

사용법:
  npm run update-stock-costs
  python scripts/update_stock_costs.py
  python scripts/update_stock_costs.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys

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
    from supabase import create_client
except ImportError:
    print("supabase 필요: pip install supabase")
    sys.exit(1)

TABLE_PRODUCTS = os.environ.get("INTEGRATED_SYNC_RAWDATA_TABLE", "inventory_products")
TABLE_STOCK = os.environ.get("INTEGRATED_SYNC_STOCK_TABLE", "inventory_stock_snapshot")
TABLE_INBOUND = os.environ.get("INTEGRATED_SYNC_INBOUND_TABLE", "inventory_inbound")
TABLE_OUTBOUND = os.environ.get("INTEGRATED_SYNC_OUTBOUND_TABLE", "inventory_outbound")
BATCH_SIZE = 100


def _fetch_cost_map(supabase, codes: list[str]) -> dict[str, float]:
    cost_map: dict[str, float] = {}
    for i in range(0, len(codes), BATCH_SIZE):
        batch = codes[i : i + BATCH_SIZE]
        res = supabase.table(TABLE_PRODUCTS).select("product_code, unit_cost").in_("product_code", batch).execute()
        for row in res.data or []:
            uc = row.get("unit_cost") or 0
            if uc > 0:
                cost_map[str(row.get("product_code", ""))] = float(uc)
    return cost_map


def _update_stock(supabase, cost_map: dict[str, float], dry_run: bool) -> int:
    res = supabase.table(TABLE_STOCK).select("*").execute()
    need = [r for r in (res.data or []) if (r.get("unit_cost") or 0) <= 0 or (r.get("total_price") or 0) <= 0]
    if not need:
        return 0
    updates = []
    for r in need:
        code = r["product_code"]
        if code not in cost_map:
            continue
        qty = int(r.get("quantity") or 0)
        uc = cost_map[code]
        row = {k: v for k, v in r.items() if k != "updated_at"}
        row["unit_cost"] = uc
        row["total_price"] = round(qty * uc, 2)
        updates.append(row)
    if not updates:
        return 0
    if dry_run:
        return len(updates)
    for i in range(0, len(updates), BATCH_SIZE):
        supabase.table(TABLE_STOCK).upsert(updates[i : i + BATCH_SIZE], on_conflict="product_code").execute()
    return len(updates)


def _update_inbound(supabase, cost_map: dict[str, float], dry_run: bool) -> int:
    res = supabase.table(TABLE_INBOUND).select("*").execute()
    need = [r for r in (res.data or []) if (r.get("unit_price") or 0) <= 0 or (r.get("total_price") or 0) <= 0]
    if not need:
        return 0
    updates = []
    for r in need:
        code = r["product_code"]
        if code not in cost_map:
            continue
        qty = int(r.get("quantity") or 0)
        uc = cost_map[code]
        row = {k: v for k, v in r.items()}
        row["unit_price"] = uc
        row["total_price"] = round(qty * uc, 2)
        updates.append(row)
    if not updates:
        return 0
    if dry_run:
        return len(updates)
    for i in range(0, len(updates), BATCH_SIZE):
        supabase.table(TABLE_INBOUND).upsert(updates[i : i + BATCH_SIZE], on_conflict="product_code,inbound_date").execute()
    return len(updates)


def _update_outbound(supabase, cost_map: dict[str, float], dry_run: bool) -> int:
    res = supabase.table(TABLE_OUTBOUND).select("*").execute()
    need = [r for r in (res.data or []) if (r.get("unit_price") or 0) <= 0 or (r.get("total_price") or 0) <= 0]
    if not need:
        return 0
    updates = []
    for r in need:
        code = r["product_code"]
        if code not in cost_map:
            continue
        qty = int(r.get("quantity") or 0)
        uc = cost_map[code]
        row = {k: v for k, v in r.items()}
        row["unit_price"] = uc
        row["total_price"] = round(qty * uc, 2)
        updates.append(row)
    if not updates:
        return 0
    if dry_run:
        return len(updates)
    for i in range(0, len(updates), BATCH_SIZE):
        supabase.table(TABLE_OUTBOUND).upsert(updates[i : i + BATCH_SIZE], on_conflict="product_code,outbound_date,sales_channel").execute()
    return len(updates)


def main() -> None:
    ap = argparse.ArgumentParser(description="재고/입고/출고 unit_cost·unit_price·total_price 보완")
    ap.add_argument("--dry-run", action="store_true", help="실제 DB 반영 없이 시뮬레이션")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요 (.env.local)")

    supabase = create_client(url, key)

    # 보완 대상 product_code 수집
    all_codes: set[str] = set()
    for table, col in [(TABLE_STOCK, "unit_cost"), (TABLE_INBOUND, "unit_price"), (TABLE_OUTBOUND, "unit_price")]:
        try:
            res = supabase.table(table).select("product_code").execute()
            for r in res.data or []:
                all_codes.add(str(r.get("product_code", "")))
        except Exception:
            pass
    all_codes = {c for c in all_codes if c}
    if not all_codes:
        print("업데이트할 데이터 없음")
        return

    cost_map = _fetch_cost_map(supabase, list(all_codes))
    if not cost_map:
        print("inventory_products에 unit_cost > 0인 품목이 없습니다. rawdata 시트를 먼저 동기화하세요.")
        return

    print(f"inventory_products 원가 매핑: {len(cost_map)}개 품목")

    n_stock = _update_stock(supabase, cost_map, args.dry_run)
    n_in = _update_inbound(supabase, cost_map, args.dry_run)
    n_out = _update_outbound(supabase, cost_map, args.dry_run)

    if args.dry_run:
        print(f"[DRY-RUN] inventory_stock_snapshot: {n_stock}건")
        print(f"[DRY-RUN] inventory_inbound: {n_in}건")
        print(f"[DRY-RUN] inventory_outbound: {n_out}건")
    else:
        print(f"inventory_stock_snapshot: {n_stock}건 업데이트")
        print(f"inventory_inbound: {n_in}건 업데이트")
        print(f"inventory_outbound: {n_out}건 업데이트")
        print("완료.")


if __name__ == "__main__":
    main()
