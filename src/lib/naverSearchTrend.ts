/**
 * 네이버 데이터랩 검색어 트렌드 API (서버 사이드 전용)
 * https://developers.naver.com/docs/serviceapi/datalab/search/search.md
 * - 클라이언트에서 직접 호출 시 CORS 에러 발생 → 반드시 Next.js API Route 경유
 */

const NAVER_DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";

/** keywordGroups 필수 형식: [{ groupName, keywords }] */
const KEYWORD_GROUPS_FORMAT = [
  { groupName: "마스크", keywords: ["마스크", "비말차단마스크", "새부리형마스크", "KF94마스크", "여름마스크"] },
  { groupName: "캡슐세제", keywords: ["캡슐세제", "고농축캡슐세제", "실내건조캡슐세제", "올인원세제", "아기캡슐세제"] },
  { groupName: "섬유유연제", keywords: ["섬유유연제", "향기좋은섬유유연제", "고농축섬유유연제", "대용량섬유유연제", "건조기시트"] },
  { groupName: "액상세제", keywords: ["액상세제", "드럼세탁기세제", "중성세제", "세탁세제추천", "아기세제"] },
] as const;

/**
 * 카테고리 → 네이버 검색어 그룹 매핑 (1:1 대응, 그룹당 최대 5개 키워드)
 * 각 그룹의 평균 검색 지수가 해당 카테고리의 네이버 트렌드 선으로 사용됨
 */
export const CATEGORY_TO_NAVER_KEYWORDS: Record<string, string[]> = {
  마스크: ["마스크", "비말차단마스크", "새부리형마스크", "KF94마스크", "여름마스크"],
  캡슐세제: ["캡슐세제", "고농축캡슐세제", "실내건조캡슐세제", "올인원세제", "아기캡슐세제"],
  섬유유연제: ["섬유유연제", "향기좋은섬유유연제", "고농축섬유유연제", "대용량섬유유연제", "건조기시트"],
  액상세제: ["액상세제", "드럼세탁기세제", "중성세제", "세탁세제추천", "아기세제"],
};

export const NAVER_CATEGORIES = Object.keys(CATEGORY_TO_NAVER_KEYWORDS) as string[];
export const SEARCH_KEYWORDS = NAVER_CATEGORIES;
export type SearchKeyword = (typeof SEARCH_KEYWORDS)[number];

/** API용 keywordGroups 생성 - 네이버 필수 형식 준수 */
function buildKeywordGroups(): { groupName: string; keywords: string[] }[] {
  return KEYWORD_GROUPS_FORMAT.map((g) => ({
    groupName: g.groupName,
    keywords: g.keywords.slice(0, 5),
  }));
}

/** 공통 fetch + 에러 로깅 */
async function naverApiFetch(body: { startDate: string; endDate: string; timeUnit: string; keywordGroups: { groupName: string; keywords: string[] }[] }): Promise<{ ok: boolean; status: number; text: string; json?: unknown }> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  console.log("[naver-datalab] NAVER_CLIENT_ID:", clientId ? `${clientId.slice(0, 4)}***` : "undefined");
  console.log("[naver-datalab] NAVER_CLIENT_SECRET:", clientSecret ? "***설정됨***" : "undefined");
  if (!clientId || !clientSecret) {
    console.error("[naver-datalab] env 미설정 - .env.local에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 확인");
    return { ok: false, status: 0, text: "NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not set" };
  }

  console.log("[naver-datalab] request body:", JSON.stringify(body, null, 2));

  const res = await fetch(NAVER_DATALAB_URL, {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    console.error("[naver-datalab] API 에러 응답 status:", res.status);
    console.error("[naver-datalab] API 에러 응답 body:", text);
    if (json && typeof json === "object" && "errorMessage" in json) {
      console.error("[naver-datalab] errorMessage:", (json as { errorMessage?: string }).errorMessage);
    }
    if (json && typeof json === "object" && "errorCode" in json) {
      console.error("[naver-datalab] errorCode:", (json as { errorCode?: string }).errorCode);
    }
  }

  return { ok: res.ok, status: res.status, text, json };
}

/** 당일 캐시 (API 호출 제한 대응) - 당일에는 재사용 */
const naverCache: {
  date: string;
  weekly: { byCategory: Record<string, number>; monthlyData: Record<string, { period: string; ratio: number }[]>; error?: string } | null;
  monthly: Record<string, { period: string; ratio: number }[]> | null;
  daily: Record<string, { period: string; ratio: number }[]> | null;
} = { date: "", weekly: null, monthly: null, daily: null };

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface NaverSearchTrendResult {
  byCategory: Record<string, number>;
  monthlyData: Record<string, { period: string; ratio: number }[]>;
  error?: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 전주 대비 검색지수 변화율 (WoW). 0.1 = 10% 증가. */
function calcWowChange(data: { period: string; ratio: number }[]): number {
  if (data.length < 2) return 0;
  const thisWeek = data[data.length - 1]?.ratio ?? 0;
  const lastWeek = data[data.length - 2]?.ratio ?? 0;
  if (lastWeek <= 0) return 0;
  return (thisWeek - lastWeek) / lastWeek;
}

/** 검색 가중치 상한 30% */
export const SEARCH_MULTIPLIER_CAP = 0.3;

export async function fetchNaverSearchTrend(): Promise<NaverSearchTrendResult> {
  const today = getTodayStr();
  if (naverCache.date === today && naverCache.weekly) {
    return naverCache.weekly;
  }

  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 90);

  const body = {
    startDate: toDateStr(startDate),
    endDate: toDateStr(endDate),
    timeUnit: "week" as const,
    keywordGroups: buildKeywordGroups(),
  };

  try {
    const { ok, status, text, json: rawJson } = await naverApiFetch(body);

    if (!ok) {
      const errMsg = typeof rawJson === "object" && rawJson && "errorMessage" in rawJson
        ? String((rawJson as { errorMessage?: string }).errorMessage)
        : text || `Naver API ${status}`;
      return { byCategory: {}, monthlyData: {}, error: errMsg };
    }

    const json = (rawJson ?? JSON.parse(text || "{}")) as {
      results?: Array<{
        title: string;
        data: Array<{ period: string; ratio: string | number }>;
      }>;
    };

    const byCategory: Record<string, number> = {};
    const monthlyData: Record<string, { period: string; ratio: number }[]> = {};

    for (const r of json.results ?? []) {
      const title = r.title ?? "";
      const data = (r.data ?? []).map((d) => ({
        period: d.period,
        ratio: typeof d.ratio === "string" ? parseFloat(d.ratio) || 0 : Number(d.ratio) || 0,
      }));
      const changeRate = calcWowChange(data);
      const capped = Math.max(-SEARCH_MULTIPLIER_CAP, Math.min(SEARCH_MULTIPLIER_CAP, changeRate));
      byCategory[title] = capped;
      monthlyData[title] = data;
    }

    return { byCategory, monthlyData };
  } catch (e) {
    console.error("[naver-search-trend] fetch error:", e);
    return { byCategory: {}, monthlyData: {}, error: e instanceof Error ? e.message : "Unknown" };
  }
}

/** 일별 fetch 인플라이트 중복 방지 */
let dailyFetchPromise: Promise<Record<string, { period: string; ratio: number }[]>> | null = null;

/** 최근 1년치 일별 검색 지수 (timeUnit: date) - 안전하게 최근 3개월 이상 확보 */
export async function fetchNaverSearchTrendDaily(): Promise<Record<string, { period: string; ratio: number }[]>> {
  const today = getTodayStr();
  if (naverCache.date === today && naverCache.daily) {
    return naverCache.daily;
  }

  if (dailyFetchPromise) return dailyFetchPromise;

  dailyFetchPromise = (async () => {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1); // 어제까지 (오늘 데이터 실시간 미제공)
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 13); // 최근 14개월 (차트용 + 여유)

    const body = {
      startDate: toDateStr(startDate),
      endDate: toDateStr(endDate),
      timeUnit: "date" as const,
      keywordGroups: buildKeywordGroups(),
    };

    try {
      const { ok, status, text, json: rawJson } = await naverApiFetch(body);

      if (!ok) {
        const errMsg = typeof rawJson === "object" && rawJson && "errorMessage" in rawJson
          ? String((rawJson as { errorMessage?: string }).errorMessage)
          : text || `Naver API ${status}`;
        console.error("[naver-datalab] fetchNaverSearchTrendDaily 실패:", errMsg);
        return {};
      }

      const json = (rawJson ?? (text ? JSON.parse(text) : {})) as {
        results?: Array<{
          title: string;
          data: Array<{ period: string; ratio: string | number }>;
        }>;
      };

      const out: Record<string, { period: string; ratio: number }[]> = {};
      for (const r of json.results ?? []) {
        out[r.title ?? ""] = (r.data ?? []).map((d) => ({
          period: d.period,
          ratio: typeof d.ratio === "string" ? parseFloat(d.ratio) || 0 : Number(d.ratio) || 0,
        }));
      }
      naverCache.date = today;
      naverCache.daily = out;
      return out;
    } catch (e) {
      console.error("[naver-datalab] fetchNaverSearchTrendDaily 예외:", e);
      return {};
    } finally {
      dailyFetchPromise = null;
    }
  })();

  return dailyFetchPromise;
}

/**
 * 일별 데이터 → 월별 집계 (값이 존재하는 날짜만 평균, 당월 보간)
 * - 데이터가 없는 날은 0으로 계산하지 않음 (평균을 깎아먹지 않음)
 * - 당월 데이터가 없으면 가장 최근 존재하는 값으로 보간
 */
function aggregateDailyToMonthly(
  daily: Record<string, { period: string; ratio: number }[]>,
  months: string[]
): Record<string, { period: string; ratio: number }[]> {
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const out: Record<string, { period: string; ratio: number }[]> = {};

  for (const [kw, data] of Object.entries(daily)) {
    // 월별: 값이 존재하는(ratio > 0) 날짜만 수집 후 평균 (데이터 없는 날은 0으로 계산 안 함)
    const byMonth: Record<string, number[]> = {};
    for (const d of data) {
      const m = (d.period ?? "").slice(0, 7);
      if (!m || m.length < 7) continue;
      if (d.ratio > 0) {
        if (!byMonth[m]) byMonth[m] = [];
        byMonth[m].push(d.ratio);
      }
    }

    // 당월 보간용: 가장 최근 존재하는 일별 값 (어제/그저께)
    const sortedByDate = [...data].filter((d) => d.ratio > 0).sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
    const lastKnownRatio = sortedByDate.length > 0 ? sortedByDate[0].ratio : 0;

    const monthlyData: { period: string; ratio: number }[] = [];
    for (const m of months) {
      const values = byMonth[m] ?? [];
      let ratio: number;
      if (values.length > 0) {
        ratio = values.reduce((a, b) => a + b, 0) / values.length;
      } else if (m === thisMonthKey && lastKnownRatio > 0) {
        // 당월 보간: 이번 달 데이터가 아직 없으면 가장 최근 일별 값 사용
        ratio = lastKnownRatio;
      } else {
        ratio = 0;
      }
      monthlyData.push({ period: m, ratio });
    }
    out[kw] = monthlyData;
  }
  return out;
}

/** 차트용 14개월 슬롯 생성 */
function getChartMonthSlots(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const slots: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    slots.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return slots;
}

/** 월별 검색 트렌드 (차트용) - 일별 데이터로 집계 후 당월 보간 */
export async function fetchNaverSearchTrendMonthly(): Promise<Record<string, { period: string; ratio: number }[]>> {
  const today = getTodayStr();
  if (naverCache.date === today && naverCache.monthly) {
    return naverCache.monthly;
  }

  const daily = await fetchNaverSearchTrendDaily();
  if (Object.keys(daily).length === 0) {
    return {};
  }

  const months = getChartMonthSlots();
  const out = aggregateDailyToMonthly(daily, months);
  naverCache.date = today;
  naverCache.monthly = out;
  return out;
}
