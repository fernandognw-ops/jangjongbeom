#!/usr/bin/env python3
"""
Supabase 재고 테이블 전체 비우기
25년도 데이터부터 재업로드 준비용

사용법: python scripts/clear_supabase_data.py
       python scripts/clear_supabase_data.py --dry-run
"""
import argparse
import os
from pathlib import Path

_env_path = Path(__file__).parent.parent / ".env.local"
if _env_path.exists():
    for line in _env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and v:
                os.environ.setdefault(k, v)

from supabase import create_client

# FK 순서: inbound/outbound → products, stock_snapshot 독립
TABLES = [
    ("inventory_inbound", "id"),
    ("inventory_outbound", "id"),
    ("inventory_stock_snapshot", "product_code"),
    ("inventory_current_products", "product_code"),
    ("inventory_products", "product_code"),
]


def clear_table(supabase, table: str, pk: str, dry_run: bool) -> int:
    total = 0
    if dry_run:
        try:
            res = supabase.table(table).select(pk).limit(1000).execute()
            total = len(res.data or [])
            if total >= 1000:
                total = f"{total}+"
        except Exception as e:
            print(f"  {table}: 조회 실패 ({e})")
            return 0
        print(f"  [DRY-RUN] {table}: {total}행 삭제 예정")
        return total if isinstance(total, int) else 0
    try:
        while True:
            res = supabase.table(table).select(pk).limit(500).execute()
            rows = res.data or []
            if not rows:
                break
            vals = [r[pk] for r in rows if r.get(pk) is not None]
            if not vals:
                break
            supabase.table(table).delete().in_(pk, vals).execute()
            total += len(rows)
    except Exception as e:
        print(f"  {table}: 삭제 실패 ({e})")
    return total


def main():
    ap = argparse.ArgumentParser(description="Supabase 재고 테이블 전체 비우기")
    ap.add_argument("--dry-run", action="store_true", help="실제 삭제 없이 확인만")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요")
        return 1

    supabase = create_client(url, key)
    print("[Supabase 데이터 비우기]" + (" (DRY-RUN)" if args.dry_run else ""))
    for table, pk in TABLES:
        n = clear_table(supabase, table, pk, args.dry_run)
        if not args.dry_run and n > 0:
            print(f"  {table}: {n}행 삭제")
    print("\n완료. 25년도 데이터부터 생산수불현황 엑셀로 재업로드하세요.")
    print("  python scripts/integrated_sync.py \"엑셀폴더경로\" --reset")
    return 0


if __name__ == "__main__":
    exit(main())
