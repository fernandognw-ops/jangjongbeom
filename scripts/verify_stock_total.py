#!/usr/bin/env python3
"""
inventory_stock_snapshot 총 재고 금액 검증
SUM(total_price) 또는 SUM(quantity * unit_cost) 출력
"""
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

def main():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: SUPABASE_URL, SUPABASE_ANON_KEY 환경변수 필요 (.env.local)")
        sys.exit(1)

    supabase = create_client(url, key)
    res = supabase.table("inventory_stock_snapshot").select("product_code,quantity,unit_cost,total_price,snapshot_date").limit(10000).execute()

    rows = res.data or []
    sum_total_price = 0
    sum_qty_cost = 0
    zero_price_count = 0

    for r in rows:
        tp = float(r.get("total_price") or 0)
        qty = int(r.get("quantity") or 0)
        uc = float(r.get("unit_cost") or 0)
        sum_total_price += tp
        if tp <= 0 and qty > 0 and uc > 0:
            sum_qty_cost += qty * uc
            zero_price_count += 1
        elif tp > 0:
            sum_qty_cost += tp

    print(f"inventory_stock_snapshot: {len(rows)}건")
    print(f"  SUM(total_price):     {sum_total_price:,.0f}원")
    print(f"  (total_price=0인 행: {zero_price_count}건, quantity*unit_cost 사용)")
    print(f"  유효 합계:            {sum_qty_cost:,.0f}원")
    if rows:
        dates = set((r.get("snapshot_date") or "")[:10] for r in rows)
        print(f"  snapshot_date:        {', '.join(sorted(dates)) or '(없음)'}")

if __name__ == "__main__":
    main()
