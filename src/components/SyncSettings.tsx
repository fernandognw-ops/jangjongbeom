"use client";

import { useState, useCallback } from "react";
import { useInventory } from "@/context/InventoryContext";
import { storage } from "@/lib/store";
import {
  isSyncAvailable,
  getDefaultWorkspaceId,
  generateSyncCode,
  getStoredSyncCode,
  setStoredSyncCode,
  fetchFromCloud,
  pushToCloud,
} from "@/lib/sync";

export function SyncSettings() {
  const { refresh } = useInventory();
  const [syncCode, setSyncCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const storedCode = getStoredSyncCode();
  const defaultWorkspace = getDefaultWorkspaceId();

  const showMsg = useCallback((type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  }, []);

  /** 연동코드 생성 (PC에서) */
  const handleCreateCode = useCallback(async () => {
    if (!isSyncAvailable()) {
      showMsg("err", "Supabase 설정이 필요합니다. .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 추가하세요.");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const code = generateSyncCode();
      setStoredSyncCode(code);
      setSyncCode(code);
      const json = storage.exportBackup();
      const result = await pushToCloud(code, json);
      if (result.ok) {
        showMsg("ok", `연동코드 생성됨: ${code} — 다른 기기에서 이 코드를 입력하세요.`);
      } else {
        showMsg("err", result.error ?? "저장 실패");
      }
    } catch (e) {
      showMsg("err", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  /** 연동코드 입력 (모바일에서) */
  const handleJoinCode = useCallback(async () => {
    if (!isSyncAvailable()) {
      showMsg("err", "Supabase 설정이 필요합니다.");
      return;
    }
    const code = inputCode.trim().toUpperCase().replace(/\s/g, "");
    if (code.length < 8) {
      showMsg("err", "연동코드는 8자 이상이어야 합니다.");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const result = await fetchFromCloud(code);
      if (!result.ok) {
        showMsg("err", result.error ?? "가져오기 실패");
        return;
      }
      if (result.data) {
        const restore = storage.restoreFromBackup(result.data);
        if (restore.ok) {
          setStoredSyncCode(code);
          setSyncCode(code);
          refresh();
          showMsg("ok", "클라우드 데이터를 가져왔습니다. PC와 연동됩니다.");
        } else {
          showMsg("err", restore.error ?? "복구 실패");
        }
      } else {
        showMsg("err", "해당 연동코드에 저장된 데이터가 없습니다. PC에서 먼저 연동코드를 생성하세요.");
      }
    } catch (e) {
      showMsg("err", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [inputCode, showMsg, refresh]);

  /** 연동 해제 */
  const handleDisconnect = useCallback(() => {
    setStoredSyncCode(null);
    setSyncCode("");
    setInputCode("");
    showMsg("ok", "연동이 해제되었습니다.");
  }, [showMsg]);

  // Supabase 기본 워크스페이스: 전 직원 자동 공유 (연동코드 불필요)
  if (defaultWorkspace) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2 md:rounded-xl md:p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-green-400 md:text-sm">
          ✓ 전 직원 실시간 공유
        </h3>
        <p className="mt-0.5 text-[10px] text-zinc-400 md:mt-2 md:text-sm md:text-zinc-300">
          Supabase 연결됨
        </p>
      </div>
    );
  }

  if (!isSyncAvailable()) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="text-sm font-semibold text-amber-400">PC·모바일 연동</h3>
        <p className="mt-2 text-xs text-zinc-400">
          연동을 사용하려면 Supabase 설정이 필요합니다.{" "}
          <a
            href="https://supabase.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 underline"
          >
            supabase.com
          </a>
          에서 무료 프로젝트를 생성한 뒤, <code className="rounded bg-zinc-800 px-1">.env.local</code>에
          NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 추가하고, supabase-setup.sql을 실행하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-400">
        PC·모바일 데이터 연동
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        동일한 연동코드를 PC와 모바일에서 입력하면 데이터가 자동으로 연동됩니다.
      </p>

      {msg && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            msg.type === "ok" ? "bg-cyan-500/20 text-cyan-200" : "bg-red-500/20 text-red-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {storedCode ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-400">연동코드:</span>
              <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-sm text-cyan-300">
                {storedCode}
              </code>
              <button
                type="button"
                onClick={handleDisconnect}
                className="text-xs text-red-400 hover:underline"
              >
                연동 해제
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              다른 기기에서 위 코드를 입력하면 데이터가 연동됩니다. 데이터 변경 시 자동으로 클라우드에 저장됩니다.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreateCode}
                disabled={loading}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-black hover:bg-cyan-400 disabled:opacity-50"
              >
                {loading ? "처리 중..." : "연동코드 생성 (PC)"}
              </button>
            </div>
            {syncCode && (
              <p className="text-sm text-cyan-300">
                생성된 코드: <strong className="font-mono">{syncCode}</strong> — 모바일에서 이 코드를 입력하세요.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="연동코드 입력 (모바일)"
                maxLength={20}
                className="min-h-[44px] flex-1 min-w-[140px] rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500/50"
              />
              <button
                type="button"
                onClick={handleJoinCode}
                disabled={loading || inputCode.trim().length < 8}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "..." : "연동하기"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
