#!/usr/bin/env python3
"""inventory_inbound 월별 데이터 확인"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_env = os.path.join(os.path.dirname(__file__), "..", ".env.local")
if os.path.exists(_env):
    with open(_env, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from supabase import create_client

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
if not url or not key:
    print("Need SUPABASE_URL and SUPABASE_KEY")
    sys.exit(1)

supabase = create_client(url, key)
all_rows = []
offset = 0
while True:
    res = supabase.table("inventory_inbound").select("product_code,quantity,inbound_date").gte("inbound_date", "2024-01-01").order("inbound_date").range(offset, offset + 999).execute()
    rows = res.data or []
    all_rows.extend(rows)
    if len(rows) < 1000:
        break
    offset += 1000

print(f"Total rows: {len(all_rows)}")
by_month = Counter()
total_by_month = {}
for r in all_rows:
    m = (r.get("inbound_date") or "")[:7]
    if m:
        by_month[m] += 1
        total_by_month[m] = total_by_month.get(m, 0) + int(r.get("quantity") or 0)

for m in sorted(by_month.keys()):
    print(f"  {m}: {by_month[m]} rows, total qty: {total_by_month[m]:,}")
