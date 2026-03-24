#!/usr/bin/env python3
"""
4개 시트 엑셀 → Supabase 통합 동기화

[필수 시트] rawdata, 입고, 재고, 출고 (시트 이름 다르면 에러)

[매핑 - 품목코드 기준]
  rawdata   → inventory_products      (Upsert)
  입고      → inventory_inbound       (Upsert, product_code+inbound_date)
  재고      → inventory_stock_snapshot (파일에 나온 달력 월마다 그 달 구간 전부 DELETE 후 INSERT)
  출고      → inventory_outbound       (Upsert, product_code+outbound_date+sales_channel)

[컬럼 매핑 - 정확 일치 우선]
  rawdata:   품목코드→product_code, 품목명 없으면 제품명→product_name,
             제품원가표(개당)→unit_cost, 품목→category, 입수량→pack_size
  입고:      품목코드, 품목명→제품명, 품목→품목구분→category, 입수량, 수량,
             입고처→dest_warehouse, 입고일자→inbound_date, 원가→unit_price, 합계원가→total_price
  재고:      품목코드, 품목명→제품명, 품목구분→category, 입수량, 수량,
             창고명→dest_warehouse, 재고일자→snapshot_date, 원가→unit_cost, 재고원가→total_price
  출고:      품목코드, 품목명→제품명, 품목 또는 품목구분→category, 입수량, 수량,
             출고처→보관/물류 표시만, 출고일자→outbound_date, 원가→unit_price, 합계→total_price,
             「판매 채널」→sales_channel·dest_warehouse (쿠팡|일반) — 매출구분 열 미사용

[운영 정책]
  ★ 실제 DB 반영은 웹 업로드만 사용. 로컬 integrated_sync.py는 운영 DB 반영에 사용하지 않음.
  - 웹: 대시보드 → Excel 업로드 → 검증 → DB 반영
  - 로컬: --dry-run / --validate 전용 (파싱·검증만, DB 미반영)

[사용법]
  python scripts/integrated_sync.py "경로/엑셀.xlsx"        # 기본 dry-run (DB 미반영)
  python scripts/integrated_sync.py "경로/엑셀.xlsx" --dry-run   # 파싱/매핑 결과만 출력
  python scripts/integrated_sync.py "경로/엑셀.xlsx" --validate  # 웹 vs Python 파싱 비교
  python scripts/integrated_sync.py "경로/엑셀.xlsx" --apply    # [비권장] 로컬 DB 반영

환경변수: .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from typing import Any, Optional


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

try:
    import pandas as pd
except ImportError:
    print("pandas 필요: pip install pandas openpyxl")
    sys.exit(1)
try:
    from supabase import create_client
except ImportError:
    print("supabase 필요: pip install supabase")
    sys.exit(1)

# 시트 이름 (대소문자 무시, 공백 제거 후 비교)
REQUIRED_SHEETS = {"rawdata", "입고", "재고", "출고"}
# 테이블명: env로 오버라이드 가능 (INTEGRATED_SYNC_RAWDATA_TABLE 등)
TABLE_RAWDATA = os.environ.get("INTEGRATED_SYNC_RAWDATA_TABLE", "inventory_products")
TABLE_INBOUND = os.environ.get("INTEGRATED_SYNC_INBOUND_TABLE", "inventory_inbound")
TABLE_STOCK = os.environ.get("INTEGRATED_SYNC_STOCK_TABLE", "inventory_stock_snapshot")
TABLE_OUTBOUND = os.environ.get("INTEGRATED_SYNC_OUTBOUND_TABLE", "inventory_outbound")
TABLE_CURRENT = os.environ.get("INTEGRATED_SYNC_CURRENT_TABLE", "inventory_current_products")
BATCH_SIZE = 200

# 수불현황 파일 검색 키워드 (생산수불현황, 수불현황 등)
SUPUL_FILENAME_PATTERNS = ("수불현황", "생산수불현황")

# 기본 검색 경로 (서브폴더 포함)
DEFAULT_SUPUL_SEARCH_DIRS = [
    "Desktop",
    "Desktop/장종범/인수 인계서/물류 재고 관리 시스템 구축/수불 마감 자료",
    "Downloads",
    "Documents",
]


def find_latest_supul_file() -> Optional[str]:
    """수불현황/생산수불현황이 포함된 가장 최신 .xlsx 파일 경로 반환. 서브폴더 포함 검색."""
    search_dirs: list[str] = []
    try:
        user_home = os.path.expanduser("~")
        if user_home:
            for rel in DEFAULT_SUPUL_SEARCH_DIRS:
                d = os.path.join(user_home, rel)
                if os.path.isdir(d):
                    search_dirs.append(d)
            if not any("Desktop" in d for d in search_dirs):
                search_dirs.insert(0, os.path.join(user_home, "Desktop"))
    except Exception:
        pass
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in search_dirs:
        search_dirs.append(project_root)

    candidates: list[tuple[float, str]] = []
    patterns_lower = [p.lower() for p in SUPUL_FILENAME_PATTERNS]
    for base_dir in search_dirs:
        if not os.path.isdir(base_dir):
            continue
        try:
            for name in os.listdir(base_dir):
                if not name.lower().endswith(".xlsx"):
                    continue
                if name.startswith("~$"):
                    continue
                name_lower = name.lower()
                if any(pat in name_lower for pat in patterns_lower):
                    full_path = os.path.join(base_dir, name)
                    if os.path.isfile(full_path):
                        try:
                            mtime = os.path.getmtime(full_path)
                            candidates.append((mtime, full_path))
                        except OSError:
                            pass
        except (PermissionError, OSError):
            continue

    if not candidates:
        return None
    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return candidates[0][1]


def find_latest_supul_in_dir(dir_path: str) -> Optional[str]:
    """지정 폴더(및 하위 폴더)에서 수불현황/생산수불현황 .xlsx 중 가장 최신 파일 반환."""
    candidates: list[tuple[float, str]] = []
    patterns_lower = [p.lower() for p in SUPUL_FILENAME_PATTERNS]
    try:
        for root, _dirs, files in os.walk(dir_path):
            for name in files:
                if not name.lower().endswith(".xlsx"):
                    continue
                if name.startswith("~$"):
                    continue
                name_lower = name.lower()
                if any(pat in name_lower for pat in patterns_lower):
                    full_path = os.path.join(root, name)
                    if os.path.isfile(full_path):
                        try:
                            mtime = os.path.getmtime(full_path)
                            candidates.append((mtime, full_path))
                        except OSError:
                            pass
    except (PermissionError, OSError):
        pass
    if not candidates:
        return None
    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return candidates[0][1]


class TableNotFoundError(Exception):
    def __init__(self, table: str, msg: str = ""):
        super().__init__(f"Table not found: {table}")
        self.table = table
        self.msg = msg


def norm_sheet(s: str) -> str:
    return s.replace(" ", "").replace("\n", "").lower()


def find_col(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """헤더에서 names 중 하나와 일치(또는 포함)하는 컬럼 인덱스. 유사어 매칭."""
    row = df.iloc[header_row]
    for n in names:
        n_clean = norm_sheet(n)
        for i in range(len(row)):
            v = norm_sheet(str(row.iloc[i] or ""))
            if n_clean in v or v in n_clean:
                return i
    return -1


def find_col_exact(df: pd.DataFrame, header_row: int, names: list[str]) -> int:
    """헤더에서 names 중 하나와 정확 일치하는 컬럼만. 유사어 혼동 방지."""
    row = df.iloc[header_row]
    for n in names:
        n_clean = norm_sheet(n)
        for i in range(len(row)):
            v = norm_sheet(str(row.iloc[i] or ""))
            if v == n_clean:
                return i
    return -1


def _find_col_exclude(df: pd.DataFrame, header_row: int, names: list[str], exclude: list[str]) -> int:
    """헤더에서 names 매칭, exclude에 포함된 컬럼 제외 (예: 수량 검색 시 입수량 제외)"""
    row = df.iloc[header_row]
    excl = {norm_sheet(x) for x in exclude}
    # "재고일자", "재고 일자" 등 날짜 컬럼 제외 (수량과 혼동 방지)
    date_excl = {"일자", "날짜", "date"}
    for n in names:
        n_clean = norm_sheet(n)
        for i in range(len(row)):
            v = norm_sheet(str(row.iloc[i] or ""))
            if any(ex in v for ex in excl):
                continue
            if any(d in v for d in date_excl) and n_clean != "재고일자":
                continue
            if n_clean in v or v in n_clean:
                return i
    return -1


def find_header_row(df: pd.DataFrame, required: list[list[str]]) -> int:
    """required: [[품목코드,품번], [수량], ...] - 각 그룹에서 하나라도 있으면 OK"""
    for r in range(min(15, len(df))):
        ok = True
        for group in required:
            if find_col(df, r, group) < 0:
                ok = False
                break
        if ok:
            # 숫자만 있는 행(잘못된 헤더) 제외: 첫 5열 중 한 셀이라도 한글이 있으면 OK
            row_preview = [str(df.iloc[r, c] or "") for c in range(min(5, df.shape[1]))]
            has_korean = any(any("\uac00" <= ch <= "\ud7a3" for ch in s) for s in row_preview)
            if has_korean:
                return r
    return -1


def safe_int(val: Any) -> int:
    try:
        if pd.isna(val):
            return 0
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def safe_float(val: Any) -> Optional[float]:
    try:
        if pd.isna(val):
            return None
        f = float(val)
        return f if f >= 0 else None
    except (ValueError, TypeError):
        return None


def parse_date(val: Any) -> Optional[str]:
    if pd.isna(val):
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    try:
        dt = pd.to_datetime(val)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return None


def to_dest_warehouse(original: Any) -> str:
    """
    원본 창고명/센터명/매출구분 → 판매채널 ("일반" | "쿠팡")
    - "테이칼튼", "테이칼튼 1공장", "쿠팡", "coupang" → "쿠팡"
    - "제이에스", "컬리", 기타, 빈값 → "일반"
    """
    s = str(original or "").strip().lower()
    if not s:
        return "일반"
    if "테이칼튼" in s or "쿠팡" in s or "coupang" in s:
        return "쿠팡"
    return "일반"


def to_sales_channel(val: Any) -> str:
    """판매채널 → sales_channel DB값 (coupang | general)"""
    g = to_dest_warehouse(val)
    return "coupang" if g == "쿠팡" else "general"


def normalize_sales_channel_kr(original: Any) -> str:
    """엑셀 「판매 채널」→ "쿠팡" | "일반" (보관센터 추론 없음)"""
    s = str(original or "").strip().lower()
    if not s:
        return "일반"
    if "쿠팡" in s or "coupang" in s:
        return "쿠팡"
    return "일반"


def log_channel_mapping_stats(
    label: str,
    rows: list[dict],
    raw_key: str,
    dest_key: str = "dest_warehouse",
) -> None:
    """원본→매핑 결과 로그 및 빈값/쿠팡/일반 건수 출력"""
    total = len(rows)
    empty = coupang = general = 0
    seen: set[tuple[str, str]] = set()
    for r in rows:
        raw = str(r.get(raw_key) or "").strip()
        dest = str(r.get(dest_key) or "").strip() or "일반"
        if not raw:
            empty += 1
        elif dest == "쿠팡":
            coupang += 1
        else:
            general += 1
        key = (raw or "(빈값)", dest or "(빈값)")
        if key not in seen:
            seen.add(key)
            print(f"    [매핑] {label} {key[0]!r} → {key[1]!r}")
    print(f"    {label} 매핑: 전체 {total}건 | 빈값→일반 {empty}건 | 쿠팡 {coupang}건 | 일반 {general}건")


def run_web_parse(excel_path: str) -> Optional[dict]:
    """웹 파서 실행 (tsx) 결과 JSON 반환. 실패 시 None."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir)
    tsx_cli = os.path.join(root_dir, "node_modules", "tsx", "dist", "cli.mjs")
    if os.path.isfile(tsx_cli):
        cmd = ["node", tsx_cli, "scripts/parse_excel_for_validation.ts", excel_path]
    else:
        cmd = ["npx", "tsx", "scripts/parse_excel_for_validation.ts", excel_path]
    try:
        result = subprocess.run(
            cmd,
            cwd=root_dir,
            capture_output=True,
            timeout=90,
        )
        if result.returncode != 0:
            err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace")[:500]
            print(f"    [검증] 웹 파서 실행 실패: {err}")
            return None
        out = result.stdout
        if not out:
            print("    [검증] 웹 파서 출력 없음")
            return None
        return json.loads(out.decode("utf-8", errors="replace"))
    except FileNotFoundError:
        print("    [검증] npm 없음. Node.js 설치 후 npm install 실행.")
        return None
    except json.JSONDecodeError as e:
        print(f"    [검증] 웹 파서 출력 파싱 실패: {e}")
        return None
    except subprocess.TimeoutExpired:
        print("    [검증] 웹 파서 실행 타임아웃")
        return None


def _norm_row(r: dict, keys: list[str]) -> tuple:
    """비교용 정규화: (product_code, dest_warehouse, date, quantity, ...)"""
    return tuple(str(r.get(k) or "").strip()[:20] for k in keys)


def _agg_by_key(rows: list[dict], key_fields: list[str], qty_field: str = "quantity") -> dict[tuple, dict]:
    """key_fields 기준 수량 합산"""
    out: dict[tuple, dict] = {}
    for r in rows:
        k = _norm_row(r, key_fields)
        if k not in out:
            out[k] = dict(r)
            out[k][qty_field] = 0
        out[k][qty_field] = (out[k].get(qty_field) or 0) + (r.get(qty_field) or 0)
    return out


def _compare_section(
    label: str,
    py_rows: list[dict],
    web_rows: list[dict],
    key_fields: list[str],
    date_field: str,
    qty_field: str = "quantity",
) -> list[str]:
    """섹션별 비교. 차이 목록 반환."""
    diffs: list[str] = []
    py_by_key = _agg_by_key(py_rows, key_fields, qty_field)
    web_by_key = _agg_by_key(web_rows, key_fields, qty_field)
    all_keys = set(py_by_key) | set(web_by_key)
    for k in sorted(all_keys):
        py_r = py_by_key.get(k)
        web_r = web_by_key.get(k)
        if not py_r:
            diffs.append(f"  [{label}] 웹에만 있음: {k} qty={web_r.get(qty_field)} (원인: 헤더/행필터 차이)")
            continue
        if not web_r:
            diffs.append(f"  [{label}] Python에만 있음: {k} qty={py_r.get(qty_field)} (원인: 헤더/행필터 차이)")
            continue
        if str(py_r.get(qty_field)) != str(web_r.get(qty_field)):
            diffs.append(f"  [{label}] 수량 불일치 {k}: Python={py_r.get(qty_field)} vs 웹={web_r.get(qty_field)} (원인: 매핑/집계)")
        if date_field and str(py_r.get(date_field, ""))[:10] != str(web_r.get(date_field, ""))[:10]:
            diffs.append(f"  [{label}] 날짜 불일치 {k}: Python={py_r.get(date_field)} vs 웹={web_r.get(date_field)} (원인: 날짜파싱)")
    return diffs


def _compare_stock(
    py_rows: list[dict],
    web_rows: list[dict],
) -> list[str]:
    """재고 비교 (unit_cost 포함) — 키: 품목×판매채널(dest)×보관센터×일자"""
    diffs: list[str] = []
    py_by_key: dict[tuple, dict] = {}
    for r in py_rows:
        ch = normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or ""))
        k = (
            str(r.get("product_code") or "").strip(),
            ch,
            str(r.get("storage_center") or "").strip() or "미지정",
            str(r.get("snapshot_date") or "")[:10],
        )
        py_by_key[k] = r
    web_by_key: dict[tuple, dict] = {}
    for r in web_rows:
        ch = normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or ""))
        k = (
            str(r.get("product_code") or "").strip(),
            ch,
            str(r.get("storage_center") or "").strip() or "미지정",
            str(r.get("snapshot_date") or "")[:10],
        )
        web_by_key[k] = r
    all_keys = set(py_by_key) | set(web_by_key)
    for k in sorted(all_keys):
        py_r = py_by_key.get(k)
        web_r = web_by_key.get(k)
        if not py_r:
            diffs.append(f"  [재고] 웹에만 있음: {k} qty={web_r.get('quantity')} unit_cost={web_r.get('unit_cost')}")
            continue
        if not web_r:
            diffs.append(f"  [재고] Python에만 있음: {k} qty={py_r.get('quantity')} unit_cost={py_r.get('unit_cost')}")
            continue
        if str(py_r.get("quantity")) != str(web_r.get("quantity")):
            diffs.append(f"  [재고] 수량 불일치 {k}: Python={py_r.get('quantity')} vs 웹={web_r.get('quantity')}")
        py_cost = float(py_r.get("unit_cost") or 0)
        web_cost = float(web_r.get("unit_cost") or 0)
        if abs(py_cost - web_cost) > 0.01:
            diffs.append(f"  [재고] unit_cost 불일치 {k}: Python={py_cost} vs 웹={web_cost} (원인: 원가컬럼매핑)")
    return diffs


def validate_parse_consistency(
    path: str,
    inbound_rows: list[dict],
    outbound_rows: list[dict],
    stock_rows: list[dict],
) -> bool:
    """웹 파서 vs Python 파서 결과 비교. 일치 시 True."""
    web = run_web_parse(path)
    if not web or not web.get("ok"):
        return False
    all_diffs: list[str] = []
    py_in = [{"product_code": r["product_code"], "dest_warehouse": str(r.get("dest_warehouse") or "").strip() or "일반", "inbound_date": str(r.get("inbound_date") or "")[:10], "quantity": r.get("quantity")} for r in inbound_rows]
    web_in = web.get("inbound") or []
    d = _compare_section("입고", py_in, web_in, ["product_code", "dest_warehouse", "inbound_date"], "inbound_date")
    all_diffs.extend(d)
    py_out = [{"product_code": r["product_code"], "dest_warehouse": str(r.get("dest_warehouse") or "").strip() or "일반", "outbound_date": str(r.get("outbound_date") or "")[:10], "quantity": r.get("quantity"), "sales_channel": r.get("sales_channel")} for r in outbound_rows]
    web_out = web.get("outbound") or []
    d = _compare_section("출고", py_out, web_out, ["product_code", "dest_warehouse", "outbound_date"], "outbound_date")
    all_diffs.extend(d)
    py_stock = [
        {
            "product_code": r["product_code"],
            "dest_warehouse": normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or "")),
            "storage_center": str(r.get("storage_center") or "").strip() or "미지정",
            "snapshot_date": str(r.get("snapshot_date") or "")[:10],
            "quantity": r.get("quantity"),
            "unit_cost": r.get("unit_cost") or 0,
        }
        for r in stock_rows
    ]
    web_stock = web.get("stockSnapshot") or []
    d = _compare_stock(py_stock, web_stock)
    all_diffs.extend(d)
    if all_diffs:
        print("\n[검증] 웹 vs Python 파싱 불일치:")
        for x in all_diffs[:50]:
            print(x)
        if len(all_diffs) > 50:
            print(f"    ... 외 {len(all_diffs) - 50}건")
        return False
    print("\n[검증] 웹 vs Python 파싱 일치: OK")
    return True


def validate_stock_duplicates(stock_rows: list[dict]) -> bool:
    """(product_code, 판매채널(dest_warehouse), storage_center, snapshot_date) 중복 검증."""
    seen: dict[tuple[str, str, str, str], list[int]] = {}
    for i, r in enumerate(stock_rows):
        code = str(r.get("product_code") or "").strip()
        ch = normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or ""))
        st = str(r.get("storage_center") or "").strip() or "미지정"
        snap = str(r.get("snapshot_date") or "")[:10] or datetime.now().strftime("%Y-%m-%d")
        key = (code, ch, st, snap)
        if key not in seen:
            seen[key] = []
        seen[key].append(i + 1)
    dups = [(k, v) for k, v in seen.items() if len(v) > 1]
    if dups:
        print(f"\n[검증] inventory_stock_snapshot 원본 중복: {len(dups)}건 (집계 시 수량 합산됨)")
        for k, v in dups[:10]:
            print(f"    {k}: 엑셀 행 {v}")
        if len(dups) > 10:
            print(f"    ... 외 {len(dups) - 10}건")
        print(f"    → 집계 후 적재 시 유일키 보장됨")
    else:
        print("\n[검증] inventory_stock_snapshot 원본 중복 없음: OK")
    return True


def validate_sheets(sheet_names: list[str]) -> dict[str, str]:
    """시트 이름 검증. 반환: {rawdata?, 입고, 재고, 출고} -> 실제 시트명. rawdata 없으면 생략(입고/재고/출고에서 품목 추출)"""
    norm_to_orig = {norm_sheet(s): s for s in sheet_names}
    result = {}

    def find_sheet(want: str, fallbacks: list[str] | None = None) -> str | None:
        w = norm_sheet(want)
        if w in norm_to_orig:
            return norm_to_orig[w]
        for orig in sheet_names:
            n = norm_sheet(orig)
            if want in n:
                return orig
            if want == "rawdata" and ("raw" in n and "data" in n):
                return orig
        if fallbacks:
            for fb in fallbacks:
                fb_norm = norm_sheet(fb)
                for orig in sheet_names:
                    if fb_norm in norm_sheet(orig) or norm_sheet(orig) in fb_norm:
                        return orig
        return None

    for want in ["입고", "재고", "출고"]:
        found = find_sheet(want)
        if found:
            result[want] = found
        else:
            raise SystemExit(
                f"오류: 필수 시트가 없습니다. 필요: 입고, 재고, 출고 / 발견: {sheet_names} / 누락: {want}"
            )
    # rawdata: 있으면 사용, 없으면 생략 (품목은 입고/재고/출고에서 FK 보장으로 추가)
    result["rawdata"] = find_sheet("rawdata", ["제품현황_일반", "제품현황_상세", "제품현황", "품절관리_일반", "품절관리"])
    return result


def load_rawdata(path: str, sheet_name: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["품목명", "제품명", "품명"]])
    if hr < 0:
        return []

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번", "제품코드", "SKU"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명", "품명"])
        idx_pool_name2 = -1
    idx_cost = find_col_exact(df, hr, ["제품 원가표(개당)", "제품원가표(개당)"])
    if idx_cost < 0:
        idx_cost = find_col(df, hr, ["제품원가표", "원가", "단가"])
    idx_cat = find_col_exact(df, hr, ["품목"])
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량", "입수"])

    if idx_code < 0:
        return []

    rows = []
    for i in range(hr + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for c in code if c.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cost = safe_float(df.iloc[i, idx_cost]) if idx_cost >= 0 else 0
        cat = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        if pack <= 0:
            pack = 1

        row: dict[str, Any] = {
            "product_code": code,
            "product_name": name,
            "unit_cost": cost or 0,
            "category": cat or "기타",
            "pack_size": pack,
        }
        rows.append(row)
    return rows


def load_inbound(path: str, sheet_name: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["수량"], ["입고일자", "입고일"]])
    if hr < 0:
        return []

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명"])
        idx_pool_name2 = -1
    idx_cat = find_col_exact(df, hr, ["품목구분"])
    if idx_cat < 0:
        idx_cat = find_col_exact(df, hr, ["품목"])
    if idx_cat < 0:
        idx_cat = find_col(df, hr, ["품목", "품목구분"])
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량"])
    idx_qty = find_col_exact(df, hr, ["입고 수량"])
    if idx_qty < 0:
        idx_qty = _find_col_exclude(df, hr, ["수량", "입고수량"], exclude=["입수량", "금액", "원가", "일자"])
    idx_wh = find_col_exact(df, hr, ["입고처", "입고 센터"])
    if idx_wh < 0:
        idx_wh = find_col(df, hr, ["입고처", "입고 센터", "판매 채널"])
    idx_date = find_col_exact(df, hr, ["입고일자"])
    if idx_date < 0:
        idx_date = find_col(df, hr, ["입고일자", "입고 일자", "입고일", "입고일자 주차"])
    idx_unit = find_col_exact(df, hr, ["원가"])
    idx_total = find_col_exact(df, hr, ["합계원가"])
    if idx_total < 0:
        idx_total = find_col(df, hr, ["합계 금액", "합계원가"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    rows = []
    for i in range(hr + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        qty = safe_int(df.iloc[i, idx_qty])
        date_str = parse_date(df.iloc[i, idx_date])
        if not code or code.lower() == "nan" or qty <= 0 or not date_str:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cat = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        wh_raw = str(df.iloc[i, idx_wh] or "").strip() if idx_wh >= 0 else ""
        wh = to_dest_warehouse(wh_raw)
        unit = safe_float(df.iloc[i, idx_unit]) if idx_unit >= 0 else None
        total = safe_float(df.iloc[i, idx_total]) if idx_total >= 0 else None

        rows.append({
            "product_code": code,
            "product_name": name,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "quantity": qty,
            "dest_warehouse": wh,
            "dest_warehouse_raw": wh_raw,
            "inbound_date": date_str,
            "unit_price": unit or 0,
            "total_price": total or 0,
        })
    return rows


def load_stock(path: str, sheet_name: str, debug: bool = False, check_product: str | None = None) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["수량", "재고"]])
    if hr < 0:
        return []

    if debug:
        headers = [str(df.iloc[hr, c] or "").strip() for c in range(min(20, df.shape[1]))]
        print(f"    [DEBUG] 재고 시트 헤더(최대20열): {headers}")

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명"])
        idx_pool_name2 = -1
    idx_cat = find_col_exact(df, hr, ["품목구분"])
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량"])
    # 수량: "수량"/"재고수량" 우선. "재고"/"재고 금액"/"재고일자" 제외 (금액·날짜와 혼동 방지)
    idx_qty = _find_col_exclude(df, hr, ["수량", "재고수량"], exclude=["입수량", "금액", "원가", "일자", "날짜"])
    if idx_qty < 0:
        idx_qty = find_col_exact(df, hr, ["수량"])
    if debug:
        print(f"    [DEBUG] 수량 컬럼 idx_qty={idx_qty}, 헤더={df.iloc[hr, idx_qty] if idx_qty >= 0 else None!r}")
    idx_sales_ch = find_col_exact(df, hr, ["판매 채널"])
    if idx_sales_ch < 0:
        idx_sales_ch = find_col(df, hr, ["판매채널", "판매 채널명"])
    idx_storage = find_col(df, hr, ["보관 센터", "재고 센터", "창고명", "창고", "보관장소", "보관처", "입고처", "warehouse", "dest_warehouse"])
    if debug:
        print(
            f"    [DEBUG] 판매채널 idx={idx_sales_ch}, 보관센터 idx={idx_storage}, "
            f"헤더 sales={df.iloc[hr, idx_sales_ch] if idx_sales_ch >= 0 else None!r}"
        )
    idx_date = find_col_exact(df, hr, ["재고일자"])
    if idx_date < 0:
        idx_date = find_col(df, hr, ["재고일자", "재고일"])
    idx_cost = find_col_exact(df, hr, ["원가"])
    if idx_cost < 0:
        idx_cost = find_col(df, hr, ["원가"])
    # 재고 금액(합계) 우선 - 재고원가는 단가일 수 있음
    idx_total = find_col_exact(df, hr, ["재고 금액"])
    if idx_total < 0:
        idx_total = find_col_exact(df, hr, ["합계 금액"])
    if idx_total < 0:
        idx_total = find_col_exact(df, hr, ["재고금액"])
    if idx_total < 0:
        idx_total = find_col(df, hr, ["재고 금액", "합계 금액", "재고금액", "재고원가"])

    if idx_code < 0 or idx_qty < 0:
        return []

    rows = []
    # 데이터 시작: header 다음 행. (부제목 있는 엑셀은 hr+2, 0318 형식은 hr+1)
    data_start = hr + 1
    if data_start < len(df):
        first_code = str(df.iloc[data_start, idx_code] or "").strip()
        digits = sum(1 for c in first_code if c.isdigit())
        if not first_code or len(first_code) < 5 or digits < len(first_code) * 0.5:
            data_start = min(hr + 2, len(df))  # 부제목 행 스킵
    for i in range(data_start, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        qty = safe_int(df.iloc[i, idx_qty])
        if not code or code.lower() == "nan":
            continue
        digits = sum(1 for c in code if c.isdigit())
        if len(code) < 5 or digits < len(code) * 0.5:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cat = str(df.iloc[i, idx_cat] or "").strip() if idx_cat >= 0 else ""
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        sales_raw = str(df.iloc[i, idx_sales_ch] or "").strip() if idx_sales_ch >= 0 else ""
        storage_raw = str(df.iloc[i, idx_storage] or "").strip() if idx_storage >= 0 else ""
        wh = normalize_sales_channel_kr(sales_raw)
        physical = storage_raw or "미지정"
        cost = safe_float(df.iloc[i, idx_cost]) if idx_cost >= 0 else None
        total = safe_float(df.iloc[i, idx_total]) if idx_total >= 0 else None
        # 재고일자: 엑셀 컬럼 있으면 파싱, 없으면 오늘
        snap_date = None
        if idx_date >= 0:
            snap_date = parse_date(df.iloc[i, idx_date])
        if not snap_date:
            snap_date = datetime.now().strftime("%Y-%m-%d")

        if check_product and code == check_product:
            row_preview = [str(df.iloc[i, c] or "")[:12] for c in range(min(18, df.shape[1]))]
            print(f"    [진단] 품목 {check_product} 원시행: idx_qty={idx_qty}, qty_raw={df.iloc[i, idx_qty] if idx_qty >= 0 else None!r}, 파싱qty={qty}, 행일부={row_preview}")
        rows.append({
            "product_code": code,
            "product_name": name,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "quantity": qty,
            "dest_warehouse": physical,
            "sales_channel": wh,
            "dest_warehouse_raw": storage_raw,
            "sales_channel_raw": sales_raw,
            "snapshot_date": snap_date,
            "unit_cost": cost or 0,
            "total_price": total or 0,
        })
    return rows


def load_outbound(path: str, sheet_name: str) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    hr = find_header_row(df, [["품목코드", "품번"], ["수량"], ["출고일자", "출고일"]])
    if hr < 0:
        return []

    idx_code = find_col_exact(df, hr, ["품목코드"])
    if idx_code < 0:
        idx_code = find_col(df, hr, ["품목코드", "품번"])
    idx_pool_name = find_col_exact(df, hr, ["품목명"])
    idx_pool_name2 = find_col_exact(df, hr, ["제품명"])
    if idx_pool_name < 0 and idx_pool_name2 < 0:
        idx_pool_name = find_col(df, hr, ["품목명", "제품명"])
        idx_pool_name2 = -1
    idx_cat = find_col_exact(df, hr, ["품목"])
    idx_cat2 = find_col_exact(df, hr, ["품목구분"])
    if idx_cat < 0 and idx_cat2 < 0:
        idx_cat = find_col(df, hr, ["품목", "품목구분"])
        idx_cat2 = -1
    idx_pack = find_col_exact(df, hr, ["입수량"])
    if idx_pack < 0:
        idx_pack = find_col(df, hr, ["입수량"])
    idx_qty = find_col_exact(df, hr, ["출고 수량"])
    if idx_qty < 0:
        idx_qty = _find_col_exclude(df, hr, ["수량", "출고수량"], exclude=["입수량", "금액", "원가", "일자"])
    idx_wh = find_col_exact(df, hr, ["출고처", "출고 센터"])
    if idx_wh < 0:
        idx_wh = find_col(df, hr, ["출고처", "출고 센터"])
    idx_date = find_col_exact(df, hr, ["출고일자"])
    if idx_date < 0:
        idx_date = find_col(df, hr, ["출고일자", "출고 일자", "출고일"])
    idx_unit = find_col_exact(df, hr, ["원가"])
    idx_total = find_col_exact(df, hr, ["합계"])
    if idx_total < 0:
        idx_total = find_col(df, hr, ["합계", "합계원가"])
    idx_sc = find_col_exact(df, hr, ["매출구분"])
    if idx_sc < 0:
        idx_sc = find_col(df, hr, ["매출구분", "매출 구분", "판매처"])

    if idx_code < 0 or idx_qty < 0 or idx_date < 0:
        return []

    rows = []
    for i in range(hr + 1, len(df)):
        code = str(df.iloc[i, idx_code] or "").strip()
        qty = safe_int(df.iloc[i, idx_qty])
        date_str = parse_date(df.iloc[i, idx_date])
        if not code or code.lower() == "nan" or qty <= 0 or not date_str:
            continue

        name = ""
        if idx_pool_name >= 0:
            name = str(df.iloc[i, idx_pool_name] or "").strip()
        if not name and idx_pool_name2 >= 0:
            name = str(df.iloc[i, idx_pool_name2] or "").strip()
        name = name or code
        cat = ""
        if idx_cat >= 0:
            cat = str(df.iloc[i, idx_cat] or "").strip()
        if not cat and idx_cat2 >= 0:
            cat = str(df.iloc[i, idx_cat2] or "").strip()
        pack = safe_int(df.iloc[i, idx_pack]) if idx_pack >= 0 else 1
        wh_raw = str(df.iloc[i, idx_wh] or "").strip() if idx_wh >= 0 else ""
        sc_raw = str(df.iloc[i, idx_sc] or "").strip() if idx_sc >= 0 else ""
        combined_raw = sc_raw or wh_raw
        wh = to_dest_warehouse(combined_raw)
        sc = to_sales_channel(combined_raw)
        unit = safe_float(df.iloc[i, idx_unit]) if idx_unit >= 0 else None
        total = safe_float(df.iloc[i, idx_total]) if idx_total >= 0 else None

        rows.append({
            "product_code": code,
            "product_name": name,
            "category": cat or "기타",
            "pack_size": pack if pack > 0 else 1,
            "quantity": qty,
            "dest_warehouse": wh,
            "dest_warehouse_raw": combined_raw,
            "outbound_date": date_str,
            "unit_price": unit or 0,
            "total_price": total or 0,
            "sales_channel": sc,
        })
    return rows


def _exit_missing_tables(table: str) -> None:
    sql_path = os.path.join(os.path.dirname(__file__), "create_inventory_tables_for_sync.sql")
    raise SystemExit(
        f"\n오류: 테이블 '{table}'이(가) 없습니다.\n\n"
        f"Supabase 대시보드 → SQL Editor에서 아래 파일을 실행하세요:\n"
        f"  {sql_path}\n\n"
        "테이블 생성 후 다시 sync-excel을 실행하세요."
    )


def truncate_table(supabase, table: str, key_column: str = "product_code") -> int:
    """테이블 전체 삭제 (TRUNCATE 대체). key_column이 있으면 neq로 전체 삭제 시도."""
    try:
        # product_code/id가 '__NONE__'이 아닌 모든 행 삭제 (= 전체 삭제)
        supabase.table(table).delete().neq(key_column, "__NONE__").execute()
        return -1  # 개수 모름
    except Exception:
        pass
    # 배치 삭제
    total = 0
    for pk in [key_column, "id"]:
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
            break
        except Exception:
            continue
    return total


def insert_batch(supabase, table: str, rows: list[dict], dry_run: bool) -> int:
    """[운영 반영 금지] dry_run=True 시 DB 미반영"""
    """테이블에 INSERT (재고 스냅샷용)"""
    if not rows:
        return 0
    if dry_run:
        print(f"  [운영 반영 금지] [DRY-RUN] {table}: {len(rows)}건 insert")
        return len(rows)
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            supabase.table(table).insert(batch).execute()
            total += len(batch)
        except Exception as e:
            if "could not find the table" in str(e).lower() or "PGRST205" in str(e):
                raise TableNotFoundError(table, str(e)) from e
            raise
    return total


def delete_by_date_range(supabase, table: str, date_col: str, date_from: str, date_to: str, dry_run: bool) -> bool:
    """해당 기간 데이터 삭제 (수불 교체 시 기존 데이터 제거)"""
    if dry_run:
        return True
    try:
        supabase.table(table).delete().gte(date_col, date_from).lte(date_col, date_to).execute()
        return True
    except Exception as e:
        print(f"    [경고] {table} 기간 삭제 실패: {e}")
        return False


def delete_by_dates(supabase, table: str, date_col: str, dates: list[str], dry_run: bool) -> bool:
    """지정된 날짜 목록에 해당하는 행 삭제"""
    if not dates or dry_run:
        return True
    try:
        supabase.table(table).delete().in_(date_col, dates).execute()
        return True
    except Exception as e:
        print(f"    [경고] {table} 날짜별 삭제 실패: {e}")
        return False


def delete_stock_snapshot_calendar_months(supabase, month_keys: list[str], dry_run: bool) -> bool:
    """재고 스냅샷: 각 YYYY-MM 달에 대해 [해당월 1일, 다음달 1일) 구간 행 전부 삭제 (웹 commit과 동일 운영 규칙)."""
    if not month_keys or dry_run:
        return True
    for ym in sorted(set(month_keys)):
        start = f"{ym}-01"
        y, m = map(int, ym.split("-"))
        if m == 12:
            before_next = f"{y + 1}-01-01"
        else:
            before_next = f"{y}-{m + 1:02d}-01"
        try:
            supabase.table(TABLE_STOCK).delete().gte("snapshot_date", start).lt("snapshot_date", before_next).execute()
        except Exception as e:
            print(f"    [경고] {TABLE_STOCK} 월 구간 삭제 실패 ({ym}): {e}")
            return False
    return True


def upsert_batch(supabase, table: str, rows: list[dict], on_conflict: list[str], dry_run: bool) -> int:
    """[운영 반영 금지] dry_run=True 시 DB 미반영"""
    if not rows:
        return 0
    if dry_run:
        print(f"  [운영 반영 금지] [DRY-RUN] {table}: {len(rows)}건 upsert")
        return len(rows)
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            supabase.table(table).upsert(batch, on_conflict=",".join(on_conflict)).execute()
            total += len(batch)
        except Exception as e:
            if "could not find the table" in str(e).lower() or "PGRST205" in str(e):
                raise TableNotFoundError(table, str(e)) from e
            raise
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description="4개 시트 엑셀 → Supabase 통합 동기화")
    ap.add_argument(
        "file",
        nargs="?",
        default=None,
        help="엑셀 파일 경로 (생략 시 수불현황 포함된 가장 최신 .xlsx 자동 검색)",
    )
    ap.add_argument("--dry-run", action="store_true", help="DB 반영 없이 파싱/매핑 결과만 출력 (기본값)")
    ap.add_argument("--validate", action="store_true", help="웹 vs Python 파싱 비교, 재고 중복 검증 (DB 반영 없음)")
    ap.add_argument("--apply", action="store_true", help="실제 DB 반영 (권장: 웹 업로드 사용. 로컬 DB 직접 적재는 비권장)")
    ap.add_argument("--debug", action="store_true", help="재고 시트 헤더·창고 컬럼 진단 출력")
    ap.add_argument("--check-product", metavar="CODE", help="특정 품목코드 수량 추출 결과 진단 (예: 8809912473788)")
    ap.add_argument("--reset", action="store_true", help="기존 데이터 삭제 후 재업로드 (--apply와 함께 사용)")
    args = ap.parse_args()

    # 웹 업로드 단일 반영: 기본값 dry-run. DB 반영은 --apply 명시 시에만
    if not args.dry_run and not args.validate and not args.apply:
        args.dry_run = True
        print("[운영 반영 금지] 웹 업로드 = 유일한 데이터 반영 경로. 로컬은 dry-run/validate 전용.")
        print("  DB 반영: 대시보드에서 Excel 업로드 → 검증 → DB 반영 클릭")
        print("  로컬 DB 반영(비권장): --apply 옵션 사용\n")

    if args.file:
        raw_path = os.path.abspath(args.file)
        if os.path.isdir(raw_path):
            path = find_latest_supul_in_dir(raw_path)
            if not path:
                raise SystemExit(
                    f"오류: 폴더 내에 '수불현황' 또는 '생산수불현황'이 포함된 .xlsx 파일이 없습니다.\n  폴더: {raw_path}"
                )
            print(f"[폴더 검색] {raw_path}\n[사용 파일] {path}")
        else:
            path = raw_path
    else:
        path = find_latest_supul_file()
        if not path:
            raise SystemExit(
                f"오류: 수불현황 파일을 찾을 수 없습니다. "
                f"Downloads/Desktop/Documents 또는 프로젝트 폴더에 '수불현황'이 포함된 .xlsx 파일을 넣거나, "
                f"경로를 직접 지정하세요.\n  예: npm run sync-excel -- \"경로/수불현황.xlsx\""
            )
        print(f"[자동 검색] 사용 파일: {path}")

    if not os.path.exists(path) or not os.path.isfile(path):
        raise SystemExit(f"오류: 파일 없음 - {path}")

    try:
        mtime = os.path.getmtime(path)
        mtime_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        print(f"[데이터 출처] {path}")
        print(f"[파일 수정일] {mtime_str} (이 날짜의 수불 데이터가 Supabase에 반영됩니다)")
    except Exception:
        pass

    xl = pd.ExcelFile(path)
    sheet_map = validate_sheets(xl.sheet_names)
    print(f"[1] 시트 검증 완료: {sheet_map}")

    raw_rows: list[dict] = []
    if sheet_map.get("rawdata"):
        raw_rows = load_rawdata(path, sheet_map["rawdata"])
    print(f"[2] rawdata 파싱: {len(raw_rows)}건" + (" (시트 없음, 입고/재고/출고에서 품목 추출)" if not raw_rows and not sheet_map.get("rawdata") else ""))

    inbound_rows = load_inbound(path, sheet_map["입고"])
    print(f"    입고 파싱: {len(inbound_rows)}건")

    outbound_rows = load_outbound(path, sheet_map["출고"])
    print(f"    출고 파싱: {len(outbound_rows)}건")

    stock_rows = load_stock(path, sheet_map["재고"], debug=args.debug, check_product=args.check_product)
    stock_sum = sum(
        float(r.get("total_price") or 0) if (r.get("total_price") or 0) > 0
        else float(r.get("quantity") or 0) * float(r.get("unit_cost") or 0)
        for r in stock_rows
    )
    # 판매채널별 분포 (엑셀 「판매 채널」)
    wh_dist: dict[str, int] = {}
    for r in stock_rows:
        wh = normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or ""))
        wh_dist[wh] = wh_dist.get(wh, 0) + 1
    wh_info = ", ".join(f"{k}:{v}건" for k, v in sorted(wh_dist.items(), key=lambda x: -x[1]))
    print(f"    재고 파싱: {len(stock_rows)}건 (엑셀 총합 {stock_sum:,.0f}원)")
    print(f"    판매채널별: {wh_info}")

    if inbound_rows:
        log_channel_mapping_stats("입고", inbound_rows, "dest_warehouse_raw", "dest_warehouse")
    if outbound_rows:
        log_channel_mapping_stats("출고", outbound_rows, "dest_warehouse_raw", "dest_warehouse")
    if stock_rows:
        log_channel_mapping_stats("재고", stock_rows, "sales_channel_raw", "dest_warehouse")

    if args.check_product:
        code = str(args.check_product).strip()
        matches = [r for r in stock_rows if str(r.get("product_code", "")).strip() == code]
        matches_partial = [r for r in stock_rows if code in str(r.get("product_code", "")).strip() or str(r.get("product_code", "")).strip() in code]
        agg_check: dict[str, int] = {}
        for r in matches:
            wh = normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or ""))
            agg_check[wh] = agg_check.get(wh, 0) + r["quantity"]
        total_check = sum(agg_check.values())
        print(f"    [진단] 품목 {code}: 엑셀 원본 {len(matches)}행 (유사 {len(matches_partial)}행) → 채널별 {agg_check} → 합계 {total_check}")

    if args.dry_run or args.validate:
        print("\n" + "=" * 60)
        print("[검증 모드] DB 반영 없이 파싱/매핑 결과 출력")
        print("=" * 60)
        print(f"\n[파싱 요약] 입고 {len(inbound_rows)}건 | 출고 {len(outbound_rows)}건 | 재고 {len(stock_rows)}건")
        if stock_rows:
            validate_stock_duplicates(stock_rows)
        if args.validate:
            validate_parse_consistency(path, inbound_rows, outbound_rows, stock_rows)
        if args.dry_run:
            print("\n[DRY-RUN] DB 반영 생략")
        else:
            print("\n[VALIDATE] 검증 완료")
        return

    # --apply 시 운영 반영 차단: 웹 UI 승인 경로만 DB 반영 허용
    if args.apply:
        allow_script = os.environ.get("ALLOW_SCRIPT_APPLY", "").lower() in ("true", "1", "yes")
        if not allow_script:
            raise SystemExit(
                "[운영 반영 차단] 로컬 스크립트로 DB 반영 불가. 웹 UI 승인 경로만 허용.\n"
                "  DB 반영: 대시보드 → Excel 업로드 → 검증 → DB 반영 클릭\n"
                "  (로컬 테스트용: ALLOW_SCRIPT_APPLY=true 설정 시 --apply 허용)"
            )

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요 (.env.local)")

    supabase = create_client(url, key)

    if args.reset:
        print("\n[0] 기존 데이터 삭제 중...")
        for tbl, pk in [
            (TABLE_RAWDATA, "product_code"),
            (TABLE_INBOUND, "id"),
            (TABLE_STOCK, "product_code"),
            (TABLE_OUTBOUND, "id"),
        ]:
            try:
                n = truncate_table(supabase, tbl, pk)
                if n != 0:
                    msg = f"{n}행 삭제" if n > 0 else "삭제 완료"
                    print(f"    {tbl}: {msg}")
            except Exception as e:
                print(f"    {tbl}: 스킵 ({e})")
        print("    완료.\n")

    # rawdata → inventory_products (product_code 기준, Upsert)
    if raw_rows:
        try:
            n = upsert_batch(supabase, TABLE_RAWDATA, raw_rows, ["product_code"], args.dry_run)
            print(f"[3] {TABLE_RAWDATA}: {n}건 upsert")
        except TableNotFoundError:
            print(f"    {TABLE_RAWDATA}: 테이블 없음, 스킵 (나머지 진행)")

    # FK 보장: 입고/출고/재고에 등장하는 product_code가 inventory_products에 없으면 최소 행 추가
    if not args.dry_run:
        all_codes: set[str] = set()
        name_by_code: dict[str, str] = {}
        for rows, key in [
            (inbound_rows, "product_name"),
            (outbound_rows, "product_name"),
            (stock_rows, "product_name"),
        ]:
            for r in rows:
                c = str(r.get("product_code", "")).strip()
                if c:
                    all_codes.add(c)
                    if c not in name_by_code and r.get(key):
                        name_by_code[c] = str(r.get(key, c))
        if all_codes:
            try:
                existing: set[str] = set()
                codes_list = list(all_codes)
                for i in range(0, len(codes_list), BATCH_SIZE):
                    batch = codes_list[i : i + BATCH_SIZE]
                    res = supabase.table(TABLE_RAWDATA).select("product_code").in_("product_code", batch).execute()
                    for r in res.data or []:
                        existing.add(str(r.get("product_code", "")))
                missing = [c for c in all_codes if c not in existing]
                if missing:
                    to_insert = [
                        {
                            "product_code": c,
                            "product_name": name_by_code.get(c, c) or c,
                            "unit_cost": 0,
                            "category": "기타",
                            "pack_size": 1,
                        }
                        for c in missing
                    ]
                    for i in range(0, len(to_insert), BATCH_SIZE):
                        batch = to_insert[i : i + BATCH_SIZE]
                        supabase.table(TABLE_RAWDATA).upsert(batch, on_conflict="product_code").execute()
                    print(f"    {TABLE_RAWDATA}: FK용 {len(to_insert)}건 추가")
            except Exception as e:
                print(f"    {TABLE_RAWDATA} FK 보완 실패: {e}")

    # 입고: [품목코드+날짜+채널]별 수량 합산 후, (product_code, inbound_date)당 수량 많은 채널로 1행
    # DB unique: (product_code, inbound_date) → 1행만 저장 가능
    if inbound_rows:
        by_key: dict[tuple[str, str, str], dict] = {}
        for r in inbound_rows:
            wh = str(r.get("dest_warehouse") or "").strip() or "일반"
            k = (r["product_code"], r["inbound_date"], wh)
            if k not in by_key:
                by_key[k] = {**r, "quantity": 0}
                by_key[k].pop("dest_warehouse_raw", None)
            by_key[k]["quantity"] += r["quantity"]
        # (product_code, inbound_date)당: 수량 합산, dest_warehouse=수량 많은 채널
        by_pd: dict[tuple[str, str], dict] = {}
        for r in by_key.values():
            pk = (r["product_code"], r["inbound_date"])
            if pk not in by_pd:
                by_pd[pk] = dict(r)
                by_pd[pk]["_best_qty"] = r["quantity"]
            else:
                by_pd[pk]["quantity"] += r["quantity"]
                if r["quantity"] > by_pd[pk]["_best_qty"]:
                    by_pd[pk]["dest_warehouse"] = r["dest_warehouse"]
                    by_pd[pk]["_best_qty"] = r["quantity"]
        for r in by_pd.values():
            r.pop("_best_qty", None)
        inbound_merged = list(by_pd.values())
        inbound_dates = sorted({(r.get("inbound_date") or "")[:10] for r in inbound_merged if r.get("inbound_date")})
        # 파일에 포함된 입고일만 삭제 후 교체 (누적 append 금지)
        if not args.dry_run and inbound_merged and inbound_dates:
            if delete_by_dates(supabase, TABLE_INBOUND, "inbound_date", inbound_dates, args.dry_run):
                print(
                    f"    {TABLE_INBOUND}: 파일 날짜 {len(inbound_dates)}일 기존 삭제 후 교체 "
                    f"({inbound_dates[0]} ~ {inbound_dates[-1]})"
                )
        # unit_price/total_price가 0이면 inventory_products에서 보완
        if not args.dry_run and inbound_merged:
            codes = list({r["product_code"] for r in inbound_merged})
            cost_map: dict[str, float] = {}
            for i in range(0, len(codes), BATCH_SIZE):
                batch = codes[i : i + BATCH_SIZE]
                res = supabase.table(TABLE_RAWDATA).select("product_code,unit_cost").in_("product_code", batch).execute()
                for row in res.data or []:
                    uc = (row.get("unit_cost") or 0)
                    if uc > 0:
                        cost_map[str(row.get("product_code", ""))] = float(uc)
            for r in inbound_merged:
                if (r.get("unit_price") or 0) <= 0 and r["product_code"] in cost_map:
                    r["unit_price"] = cost_map[r["product_code"]]
                if (r.get("total_price") or 0) <= 0 and (r.get("unit_price") or 0) > 0:
                    r["total_price"] = round(r["quantity"] * r["unit_price"], 2)
        try:
            n = upsert_batch(
                supabase, TABLE_INBOUND, inbound_merged,
                ["product_code", "inbound_date"],
                args.dry_run,
            )
            print(f"    {TABLE_INBOUND}: {n}건 upsert")
        except TableNotFoundError as e:
            _exit_missing_tables(e.table)

    # 재고: product_code + dest_warehouse(판매채널) + storage_center + snapshot_date
    # 파일 snapshot_date 집합만 DELETE 후 INSERT
    if stock_rows:
        try:
            agg: dict[tuple[str, str, str, str], dict] = {}
            for r in stock_rows:
                code = r["product_code"]
                ch = normalize_sales_channel_kr(str(r.get("dest_warehouse") or r.get("sales_channel") or ""))
                st = str(r.get("storage_center") or "").strip() or "미지정"
                snap = str(r.get("snapshot_date") or "")[:10]
                if not snap:
                    snap = datetime.now().strftime("%Y-%m-%d")
                key = (code, ch, st, snap)
                if key not in agg:
                    agg[key] = dict(r)
                    agg[key].pop("dest_warehouse_raw", None)
                    agg[key].pop("sales_channel_raw", None)
                    agg[key]["dest_warehouse"] = ch
                    agg[key]["sales_channel"] = ch
                    agg[key]["storage_center"] = st
                    agg[key]["snapshot_date"] = snap
                    agg[key]["quantity"] = 0
                    agg[key]["total_price"] = 0.0
                agg[key]["quantity"] += r["quantity"]
                agg[key]["total_price"] = (agg[key].get("total_price") or 0) + float(r.get("total_price") or 0)
            for r in agg.values():
                r["total_price"] = round(r.get("total_price") or 0, 2)
            stock_merged = list(agg.values())

            if args.check_product:
                code = str(args.check_product).strip()
                merged_for_code = [r for r in stock_merged if str(r.get("product_code", "")).strip() == code]
                total_merged = sum(r["quantity"] for r in merged_for_code)
                print(f"    [진단] 품목 {code}: 집계 후 DB 저장 예정 {[(r['dest_warehouse'], r.get('storage_center'), r['snapshot_date'], r['quantity']) for r in merged_for_code]} → 합계 {total_merged}")

            # unit_cost/total_price가 0이면 inventory_products에서 보완 (엑셀에 원가 컬럼 없을 때)
            if not args.dry_run and stock_merged:
                codes = list({r["product_code"] for r in stock_merged})
                cost_map: dict[str, float] = {}
                for i in range(0, len(codes), BATCH_SIZE):
                    batch = codes[i : i + BATCH_SIZE]
                    res = supabase.table(TABLE_RAWDATA).select("product_code,unit_cost").in_("product_code", batch).execute()
                    for row in res.data or []:
                        uc = (row.get("unit_cost") or 0)
                        if uc > 0:
                            cost_map[str(row.get("product_code", ""))] = float(uc)
                for r in stock_merged:
                    if (r.get("unit_cost") or 0) <= 0 and r["product_code"] in cost_map:
                        r["unit_cost"] = cost_map[r["product_code"]]
                    if (r.get("total_price") or 0) <= 0 and (r.get("unit_cost") or 0) > 0:
                        r["total_price"] = round(r["quantity"] * r["unit_cost"], 2)

            merged_sum = sum(float(r.get("total_price") or 0) for r in stock_merged)
            # 업로드에 포함된 달력 월마다 해당 월 스냅샷 전부 삭제 후 insert (한 달에는 최종적으로 한 snapshot_date만 남도록)
            if not args.dry_run and stock_merged:
                month_keys = sorted({(r.get("snapshot_date") or "")[:7] for r in stock_merged if r.get("snapshot_date")})
                if month_keys and delete_stock_snapshot_calendar_months(supabase, month_keys, args.dry_run):
                    print(f"    {TABLE_STOCK}: 달력 월 {len(month_keys)}개 구간 기존 삭제 후 insert ({', '.join(month_keys)})")
            n = insert_batch(supabase, TABLE_STOCK, stock_merged, args.dry_run)
            print(f"    {TABLE_STOCK}: {n}건 insert (품목·센터·날짜별 {len(stock_merged)}행, 합계 {merged_sum:,.0f}원)")
        except TableNotFoundError as e:
            _exit_missing_tables(e.table)

    # 출고: (product_code, outbound_date, sales_channel) 기준 집계 후 upsert
    if outbound_rows:
        agg: dict[tuple, dict] = {}
        for r in outbound_rows:
            k = (r["product_code"], r["outbound_date"], r["sales_channel"])
            if k not in agg:
                agg[k] = dict(r)
                agg[k].pop("dest_warehouse_raw", None)
                agg[k]["quantity"] = 0
            agg[k]["quantity"] += r["quantity"]
        outbound_merged = list(agg.values())
        outbound_dates = sorted({(r.get("outbound_date") or "")[:10] for r in outbound_merged if r.get("outbound_date")})
        # 파일에 포함된 출고일만 삭제 후 교체 (누적 append 금지)
        if not args.dry_run and outbound_merged and outbound_dates:
            if delete_by_dates(supabase, TABLE_OUTBOUND, "outbound_date", outbound_dates, args.dry_run):
                print(
                    f"    {TABLE_OUTBOUND}: 파일 날짜 {len(outbound_dates)}일 기존 삭제 후 교체 "
                    f"({outbound_dates[0]} ~ {outbound_dates[-1]})"
                )
        # unit_price/total_price가 0이면 inventory_products에서 보완
        if not args.dry_run and outbound_merged:
            codes = list({r["product_code"] for r in outbound_merged})
            cost_map: dict[str, float] = {}
            for i in range(0, len(codes), BATCH_SIZE):
                batch = codes[i : i + BATCH_SIZE]
                res = supabase.table(TABLE_RAWDATA).select("product_code,unit_cost").in_("product_code", batch).execute()
                for row in res.data or []:
                    uc = (row.get("unit_cost") or 0)
                    if uc > 0:
                        cost_map[str(row.get("product_code", ""))] = float(uc)
            for r in outbound_merged:
                if (r.get("unit_price") or 0) <= 0 and r["product_code"] in cost_map:
                    r["unit_price"] = cost_map[r["product_code"]]
                if (r.get("total_price") or 0) <= 0 and (r.get("unit_price") or 0) > 0:
                    r["total_price"] = round(r["quantity"] * r["unit_price"], 2)
        try:
            n = upsert_batch(
                supabase, TABLE_OUTBOUND, outbound_merged,
                ["product_code", "outbound_date", "sales_channel"],
                args.dry_run,
            )
            print(f"    {TABLE_OUTBOUND}: {n}건 upsert")
        except TableNotFoundError as e:
            _exit_missing_tables(e.table)

    # inventory_current_products 동기화 (대시보드 현재 품목 목록)
    if not args.dry_run:
        current_codes: set[str] = set()
        if stock_rows:
            for r in stock_rows:
                c = str(r.get("product_code", "")).strip()
                if c:
                    current_codes.add(c)
        for r in inbound_rows:
            c = str(r.get("product_code", "")).strip()
            if c:
                current_codes.add(c)
        for r in outbound_rows:
            c = str(r.get("product_code", "")).strip()
            if c:
                current_codes.add(c)
        if current_codes:
            try:
                to_upsert = [{"product_code": c} for c in current_codes]
                for i in range(0, len(to_upsert), BATCH_SIZE):
                    batch = to_upsert[i : i + BATCH_SIZE]
                    supabase.table(TABLE_CURRENT).upsert(batch, on_conflict="product_code").execute()
                print(f"    {TABLE_CURRENT}: {len(to_upsert)}건 동기화")
            except Exception as e:
                print(f"    {TABLE_CURRENT}: 스킵 ({e})")

    print("\n[4] 완료.")


if __name__ == "__main__":
    main()
