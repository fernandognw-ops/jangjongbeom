#!/usr/bin/env python3
"""
inventory_current_products를 stock + inbound + outbound에서 product_code 수집해 동기화

대시보드가 inventory_current_products를 참조하므로, sync-excel 후 이 테이블이 비어있으면
대시보드에 데이터가 표시되지 않음. 이 스크립트로 수동 동기화 가능.

사용법:
  npm run sync-current-products
  python scripts/sync_current_products.py
"""

from __future__ import annotations

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

TABLE_CURRENT = "inventory_current_products"
TABLE_STOCK = "inventory_stock_snapshot"
TABLE_INBOUND = "inventory_inbound"
TABLE_OUTBOUND = "inventory_outbound"
BATCH_SIZE = 200


def main() -> None:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요 (.env.local)")

    supabase = create_client(url, key)
    codes: set[str] = set()

    for table in [TABLE_STOCK, TABLE_INBOUND, TABLE_OUTBOUND]:
        try:
            res = supabase.table(table).select("product_code").limit(50000).execute()
            for r in res.data or []:
                c = str(r.get("product_code", "")).strip()
                if c:
                    codes.add(c)
        except Exception as e:
            print(f"  {table}: {e}")

    if not codes:
        print("동기화할 품목 없음")
        return

    try:
        to_upsert = [{"product_code": c} for c in codes]
        for i in range(0, len(to_upsert), BATCH_SIZE):
            batch = to_upsert[i : i + BATCH_SIZE]
            supabase.table(TABLE_CURRENT).upsert(batch, on_conflict="product_code").execute()
        print(f"inventory_current_products: {len(to_upsert)}건 동기화 완료")
    except Exception as e:
        if "PGRST205" in str(e) or "could not find the table" in str(e).lower():
            print("inventory_current_products 테이블이 없습니다. Supabase SQL Editor에서")
            print("scripts/create_inventory_tables_for_sync.sql 을 실행하세요.")
        else:
            raise


if __name__ == "__main__":
    main()
