"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type LogRow = {
  id: string;
  uploaded_at: string;
  uploaded_by?: string;
  filename: string;
  target_month?: string | null;
  status: string;
  validation_passed?: boolean | null;
  auto_committed?: boolean | null;
  validation_error_reason?: string | null;
  error_message?: string | null;
  inbound_count?: number;
  outbound_count?: number;
  stock_count?: number;
  anomaly_row_count?: number | null;
  sum_outbound_total_amount?: number | null;
  sum_total_price?: number | null;
  sum_unit_price_x_qty?: number | null;
  source_selection_json?: unknown;
  validation_debug_json?: unknown;
};

type BoardCell = {
  month: string;
  state: "정상" | "실패" | "미업로드";
  latestUploadedAt: string | null;
  reason: string | null;
};

export default function AdminUploadLogsPage() {
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [meta, setMeta] = useState<{
    monthsNeedingReupload?: string[];
    monthBoard?: BoardCell[];
  } | null>(null);
  const [detail, setDetail] = useState<LogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (month.trim()) q.set("month", month.trim());
      if (status) q.set("status", status);
      const res = await fetch(`/api/inventory/upload-logs?${q.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
        setRows([]);
        return;
      }
      setRows(json.rows ?? []);
      setMeta(json.meta ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "조회 실패");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [month, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">업로드 검증 이력</h1>
            <p className="mt-1 text-sm text-slate-500">
              월별 자동 검증·반영 기록. 실패한 월은 재업로드가 필요할 수 있습니다.
            </p>
          </div>
          <Link href="/" className="text-sm font-medium text-indigo-600 hover:underline">
            ← 대시보드
          </Link>
        </div>

        {meta?.monthsNeedingReupload && meta.monthsNeedingReupload.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-medium">재업로드 점검 권장 월: </span>
            {meta.monthsNeedingReupload.join(", ")}
          </div>
        )}
        {meta?.monthBoard && meta.monthBoard.length > 0 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <h2 className="text-sm font-semibold text-slate-800">월별 업로드 상태판</h2>
            <p className="mt-1 text-xs text-slate-500">정상/실패/미업로드를 월 단위로 확인합니다.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {meta.monthBoard.map((c) => (
                <button
                  key={c.month}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-left ${
                    c.state === "정상"
                      ? "border-emerald-200 bg-emerald-50"
                      : c.state === "실패"
                        ? "border-red-200 bg-red-50"
                        : "border-slate-200 bg-slate-50"
                  }`}
                  onClick={() => setMonth(c.month)}
                  title={c.reason ?? ""}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-700">{c.month}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold">{c.state}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            대상 월 (YYYY-MM)
            <input
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              placeholder="예: 2025-03"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            상태
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">전체</option>
              <option value="success">성공</option>
              <option value="error">실패/차단</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            조회
          </button>
        </div>

        {err && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {err}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">일시</th>
                  <th className="px-3 py-2">월</th>
                  <th className="px-3 py-2">파일</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">검증</th>
                  <th className="px-3 py-2">반영</th>
                  <th className="px-3 py-2">행 수</th>
                  <th className="px-3 py-2">사유</th>
                  <th className="px-3 py-2">상세</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">
                      {new Date(r.uploaded_at).toLocaleString("ko-KR")}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.target_month ?? "—"}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-xs" title={r.filename}>
                      {r.filename}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.status === "success" ? "text-emerald-700" : "text-red-700"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.validation_passed === true ? "통과" : r.validation_passed === false ? "실패" : "—"}</td>
                    <td className="px-3 py-2">{r.auto_committed === true ? "예" : r.auto_committed === false ? "아니오" : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      입{r.inbound_count ?? 0} / 출{r.outbound_count ?? 0} / 재{r.stock_count ?? 0}
                    </td>
                    <td className="max-w-[240px] truncate text-xs text-slate-600" title={r.validation_error_reason ?? r.error_message ?? ""}>
                      {(r.validation_error_reason ?? r.error_message ?? "").slice(0, 80)}
                      {(r.validation_error_reason ?? r.error_message ?? "").length > 80 ? "…" : ""}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-indigo-600 hover:underline"
                        onClick={() => setDetail(r)}
                      >
                        보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && !err && (
              <p className="p-6 text-center text-sm text-slate-500">이력이 없거나 조회 권한이 없습니다.</p>
            )}
          </div>
        )}

        {detail && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal
            onClick={() => setDetail(null)}
          >
            <div
              className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-800">검증 상세</h2>
                <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => setDetail(null)}>
                  닫기
                </button>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <dt className="text-slate-500">파일</dt>
                <dd className="font-mono text-xs">{detail.filename}</dd>
                <dt className="text-slate-500">차단/오류 사유</dt>
                <dd className="whitespace-pre-wrap text-red-800">{detail.validation_error_reason ?? detail.error_message ?? "—"}</dd>
                <dt className="text-slate-500">금액 합계 (검증 시점)</dt>
                <dd className="font-mono text-xs">
                  합계(outbound_total/total): {detail.sum_outbound_total_amount ?? "—"} / total_price:{" "}
                  {detail.sum_total_price ?? "—"} / unit×qty: {detail.sum_unit_price_x_qty ?? "—"}
                </dd>
                <dt className="text-slate-500">이상 행 수</dt>
                <dd>{detail.anomaly_row_count ?? "—"}</dd>
                <dt className="text-slate-500">source selection</dt>
                <dd>
                  <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(detail.source_selection_json ?? {}, null, 2)}
                  </pre>
                </dd>
                <dt className="text-slate-500">디버그 JSON</dt>
                <dd>
                  <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(detail.validation_debug_json ?? {}, null, 2)}
                  </pre>
                </dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
