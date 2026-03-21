#!/usr/bin/env python3
"""
2026-03-18 07:00 KST 이후 적재된 데이터 삭제 (적재 없음)
Supabase REST API로 삭제. .env.local 사용.
"""
import os
import sys

# .env.local 로드
_env = os.path.join(os.path.dirname(__file__), "..", ".env.local")
if os.path.exists(_env):
    with open(_env, encoding="utf-8") as f:
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

CUTOFF = "2026-03-18T07:00:00+09:00"

def main():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요")
        sys.exit(1)

    supabase = create_client(url, key)

    # 1. inbound
    try:
        r = supabase.table("inventory_inbound").delete().gte("created_at", CUTOFF).execute()
        print(f"inbound: 07:00 이후 삭제 완료 (count: {len(r.data) if r.data else 'N/A'})")
    except Exception as e:
        print(f"inbound 삭제 오류: {e}")

    # 2. outbound
    try:
        r = supabase.table("inventory_outbound").delete().gte("created_at", CUTOFF).execute()
        print(f"outbound: 07:00 이후 삭제 완료 (count: {len(r.data) if r.data else 'N/A'})")
    except Exception as e:
        print(f"outbound 삭제 오류: {e}")

    # 3. stock
    try:
        r = supabase.table("inventory_stock_snapshot").delete().gte("updated_at", CUTOFF).execute()
        print(f"stock: 07:00 이후 삭제 완료 (count: {len(r.data) if r.data else 'N/A'})")
    except Exception as e:
        print(f"stock 삭제 오류: {e}")

    print("완료.")

if __name__ == "__main__":
    main()
