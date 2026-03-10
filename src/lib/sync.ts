/**
 * Supabase 클라우드 저장소
 * - 전 직원 실시간 데이터 공유 (workspace "MAIN" 사용)
 * - 연동코드 방식 (선택): 동일 코드 입력 시 추가 기기 연동
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SYNC_CODE_KEY = "inventory-sync-code";
const DEFAULT_WORKSPACE = "MAIN";

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Supabase가 설정되어 있으면 기본 워크스페이스 ID 반환 */
export function getDefaultWorkspaceId(): string | null {
  if (!isSyncAvailable()) return null;
  return process.env.NEXT_PUBLIC_SUPABASE_WORKSPACE_ID ?? DEFAULT_WORKSPACE;
}

/** 12자리 연동코드 생성 */
export function generateSyncCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getStoredSyncCode(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SYNC_CODE_KEY);
}

export function setStoredSyncCode(code: string | null): void {
  if (typeof window === "undefined") return;
  if (code) localStorage.setItem(SYNC_CODE_KEY, code);
  else localStorage.removeItem(SYNC_CODE_KEY);
}

export function isSyncAvailable(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface SyncResult {
  ok: boolean;
  error?: string;
}

/** 클라우드에서 데이터 가져오기 */
export async function fetchFromCloud(syncCode: string): Promise<SyncResult & { data?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase가 설정되지 않았습니다." };

  try {
    const { data, error } = await supabase
      .from("inventory_sync")
      .select("data")
      .eq("sync_code", syncCode.toUpperCase().replace(/\s/g, ""))
      .single();

    if (error) {
      if (error.code === "PGRST116") return { ok: true, data: undefined }; // no rows
      return { ok: false, error: error.message };
    }
    const raw = data?.data;
    return { ok: true, data: raw != null ? JSON.stringify(raw) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 기본 워크스페이스에서 데이터 가져오기 (전 직원 공유) */
export async function fetchDefaultWorkspace(): Promise<SyncResult & { data?: string }> {
  const workspaceId = getDefaultWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Supabase가 설정되지 않았습니다." };
  return fetchFromCloud(workspaceId);
}

/** 기본 워크스페이스에 데이터 저장 (전 직원 공유) */
export async function pushDefaultWorkspace(jsonData: string): Promise<SyncResult> {
  const workspaceId = getDefaultWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Supabase가 설정되지 않았습니다." };
  return pushToCloud(workspaceId, jsonData);
}

/** 클라우드에 데이터 저장 */
export async function pushToCloud(syncCode: string, jsonData: string): Promise<SyncResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase가 설정되지 않았습니다." };

  const code = syncCode.toUpperCase().replace(/\s/g, "");
  if (!code || code.length < 8) return { ok: false, error: "연동코드는 8자 이상이어야 합니다." };

  try {
    const dataObj = JSON.parse(jsonData) as object;
    const { error } = await supabase.from("inventory_sync").upsert(
      {
        sync_code: code,
        data: dataObj,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sync_code" }
    );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
