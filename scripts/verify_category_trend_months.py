#!/usr/bin/env python3
"""category-trend API가 반환할 months/chartData 확인"""
import os
import sys

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

# inbound
all_in = []
offset = 0
while True:
    res = supabase.table("inventory_inbound").select("inbound_date").gte("inbound_date", "2024-01-01").order("inbound_date").range(offset, offset + 999).execute()
    rows = res.data or []
    all_in.extend(rows)
    if len(rows) < 1000:
        break
    offset += 1000

in_months = set((r.get("inbound_date") or "")[:7] for r in all_in if (r.get("inbound_date") or "")[:7])
print("inbound months:", sorted(in_months))

# outbound
all_out = []
offset = 0
while True:
    res = supabase.table("inventory_outbound").select("outbound_date").gte("outbound_date", "2024-01-01").order("outbound_date").range(offset, offset + 999).execute()
    rows = res.data or []
    all_out.extend(rows)
    if len(rows) < 1000:
        break
    offset += 1000

out_months = set((r.get("outbound_date") or "")[:7] for r in all_out if (r.get("outbound_date") or "")[:7])
print("outbound months:", sorted(out_months))

combined = sorted(in_months | out_months)
print("combined months (API would return):", combined)
