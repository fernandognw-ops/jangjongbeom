#!/usr/bin/env python3
"""
inventory_inbound, inventory_outbound 테이블에서 중복 레코드 삭제

중복 기준: (product_code, date, quantity, sales_channel)
→ 각 그룹에서 id가 가장 작은 1건만 남기고 나머지 삭제

사용법:
  python remove_duplicates.py
"""
import os
import sys

try:
    from supabase import create_client, Client
except ImportError:
    print("supabase 필요: pip install supabase")
    sys.exit(1)

TABLE_INBOUND = "inventory_inbound"
TABLE_OUTBOUND = "inventory_outbound"
BATCH = 1000


def fetch_all(supabase: Client, table: str, date_col: str) -> list[dict]:
    """테이블 전체 조회 (페이지네이션)"""
    rows = []
    offset = 0
    while True:
        resp = (
            supabase.table(table)
            .select("id,product_code,quantity,sales_channel," + date_col)
            .order("id")
            .range(offset, offset + BATCH - 1)
            .execute()
        )
        data = resp.data or []
        if not data:
            break
        rows.extend(data)
        if len(data) < BATCH:
            break
        offset += BATCH
    return rows


def remove_duplicates(supabase: Client, table: str, date_col: str) -> int:
    """중복 제거: (product_code, date, quantity, sales_channel) 기준"""
    rows = fetch_all(supabase, table, date_col)
    if not rows:
        return 0

    # 그룹별로 id 수집
    groups: dict[tuple, list[str]] = {}
    for r in rows:
        date_val = str(r.get(date_col, ""))[:10]
        key = (
            str(r.get("product_code", "")),
            date_val,
            int(r.get("quantity", 0)),
            str(r.get("sales_channel", "general")),
        )
        if key not in groups:
            groups[key] = []
        groups[key].append(r["id"])

    # 중복된 그룹에서 min(id) 제외한 나머지 삭제
    to_delete = []
    for ids in groups.values():
        if len(ids) > 1:
            ids.sort()
            to_delete.extend(ids[1:])  # 첫 번째(id 최소) 제외

    if not to_delete:
        return 0

    deleted = 0
    for i in range(0, len(to_delete), 100):
        batch = to_delete[i : i + 100]
        for uid in batch:
            try:
                supabase.table(table).delete().eq("id", uid).execute()
                deleted += 1
            except Exception as e:
                print(f"  삭제 실패 id={uid}: {e}")
    return deleted


def main() -> None:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

    if not url or not key:
        print("오류: SUPABASE_URL, SUPABASE_KEY 환경변수를 설정하세요.")
        sys.exit(1)

    supabase: Client = create_client(url, key)

    print("입고 중복 삭제 중...")
    n_in = remove_duplicates(supabase, TABLE_INBOUND, "inbound_date")
    print(f"  입고: {n_in}건 삭제")

    print("출고 중복 삭제 중...")
    n_out = remove_duplicates(supabase, TABLE_OUTBOUND, "outbound_date")
    print(f"  출고: {n_out}건 삭제")

    print(f"\n총 {n_in + n_out}건 중복 삭제 완료.")


if __name__ == "__main__":
    main()
