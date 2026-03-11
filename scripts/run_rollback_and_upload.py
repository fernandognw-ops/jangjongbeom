#!/usr/bin/env python3
"""
롤백 + 재업로드 실행 스크립트

1. Supabase SQL Editor에서 scripts/rollback_snapshot_pk_to_product_code.sql 실행
2. 이 스크립트로 upload_excel_full_reset.py 실행
"""
import os
import subprocess
import sys

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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

print("=" * 60)
print("1단계: Supabase SQL Editor에서 아래 SQL을 먼저 실행하세요.")
print("   파일: scripts/rollback_snapshot_pk_to_product_code.sql")
print("   Supabase 대시보드 > SQL Editor > New query > 붙여넣기 > Run")
print("=" * 60)
input("SQL 실행 완료 후 Enter를 누르세요...")

excel_path = r"C:\Users\pc\Desktop\장종범\인수 인계서\물류 재고 관리 시스템 구축\수불 마감 자료\26년 0311_생산수불현황.xlsx"
if len(sys.argv) > 1:
    excel_path = sys.argv[1]

print(f"\n2단계: Excel 업로드 실행 ({excel_path})")
subprocess.run([sys.executable, "scripts/upload_excel_full_reset.py", excel_path], check=True)
