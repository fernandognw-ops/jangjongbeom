#!/usr/bin/env python3
"""
여러 마감 엑셀 파일 순차 동기화 → Supabase

[데이터 누적]
  rawdata   → upsert (품목 마스터 갱신)
  입고      → upsert (날짜별 누적)
  출고      → upsert (날짜별 누적)

[재고]
  마지막 파일의 재고로 교체 (최신 스냅샷)

[사용법]
  npm run sync-all-maram
  python scripts/sync_all_maram.py
  python scripts/sync_all_maram.py "25년 11월마감.xlsx" "25년 12월마감.xlsx" "26년 0311.xlsx"
"""

from __future__ import annotations

import os
import sys

# .env.local 로드
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

# 기본 경로: 수불 마감 자료 폴더
DEFAULT_DIR = r"C:\Users\pc\Desktop\장종범\인수 인계서\물류 재고 관리 시스템 구축\수불 마감 자료"
DEFAULT_FILES = [
    "25년 3월마감_생산수불현황.xlsx",
    "25년 4월마감_생산수불현황.xlsx",
    "25년 5월마감_생산수불현황.xlsx",
    "25년 6월마감_생산수불현황.xlsx",
    "25년 7월마감_생산수불현황.xlsx",
    "25년 8월마감_생산수불현황.xlsx",
    "25년 9월마감_생산수불현황.xlsx",
    "25년 10월마감_생산수불현황.xlsx",
    "25년 11월마감_생산수불현황.xlsx",
    "25년 12월마감_생산수불현황.xlsx",
    "26년 0311_생산수불현황.xlsx",
]


def main() -> None:
    if len(sys.argv) > 1:
        # 인자로 파일 경로 지정
        paths = [os.path.abspath(p) for p in sys.argv[1:]]
    else:
        # 기본 경로 사용
        paths = [os.path.join(DEFAULT_DIR, f) for f in DEFAULT_FILES]

    existing = [p for p in paths if os.path.exists(p)]
    missing = [p for p in paths if not os.path.exists(p)]

    if missing:
        print("경고: 다음 파일이 없어 스킵합니다:")
        for p in missing:
            print(f"  - {p}")
        print()

    if not existing:
        print("오류: 동기화할 엑셀 파일이 없습니다.")
        print("사용법: python scripts/sync_all_maram.py [파일1.xlsx] [파일2.xlsx] ...")
        sys.exit(1)

    print(f"[sync_all_maram] {len(existing)}개 파일 순차 동기화")
    for i, p in enumerate(existing, 1):
        print(f"\n--- [{i}/{len(existing)}] {os.path.basename(p)} ---")
        ret = os.system(f'python "{os.path.join(os.path.dirname(__file__), "integrated_sync.py")}" "{p}"')
        if ret != 0:
            print(f"경고: {p} 동기화 중 오류 (exit {ret})")
    print("\n[sync_all_maram] 완료.")


if __name__ == "__main__":
    main()
