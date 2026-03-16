#!/usr/bin/env python3
"""
0316 생산수불현황 기준 전체 동기화 (품목·입고·출고·재고)
1. integrated_sync: 품목, 입고, 출고, 재고(1차)
2. sync_0311_current: 재고 금액 보정 (813M 정확 반영)
"""
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

DEFAULT_FILE = r"C:\Users\pc\Desktop\장종범\인수 인계서\물류 재고 관리 시스템 구축\수불 마감 자료\0316_생산수불현황.xlsx"

def main():
    file_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FILE
    if not os.path.exists(file_path):
        print(f"오류: 파일 없음 {file_path}")
        sys.exit(1)

    os.chdir(PROJECT_DIR)
    print(f"[1/2] integrated_sync: {file_path}")
    r1 = subprocess.run(
        [sys.executable, "scripts/integrated_sync.py", file_path],
        cwd=PROJECT_DIR,
    )
    if r1.returncode != 0:
        sys.exit(r1.returncode)

    print(f"\n[2/2] sync_0311_current: 재고 금액 보정")
    snapshot_date = "2026-03-16" if "0316" in file_path else None
    cmd = [sys.executable, "scripts/sync_0311_current.py", file_path]
    if snapshot_date:
        cmd.extend(["--snapshot-date", snapshot_date])
    r2 = subprocess.run(cmd, cwd=PROJECT_DIR)
    if r2.returncode != 0:
        sys.exit(r2.returncode)

    print("\n전체 동기화 완료. 대시보드를 새로고침하세요.")

if __name__ == "__main__":
    main()
