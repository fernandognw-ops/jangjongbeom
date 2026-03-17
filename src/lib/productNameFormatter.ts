/** 상품명 축약 및 표시용 유틸리티
 * - 중복 문구 제거
 * - 브랜드/사이즈/컬러·향/개입수 등 유의미한 정보 포함
 */

/** 사이즈·용량 패턴: 2kg, 1L, 500ml, 1.5L 등 */
const SIZE_REGEX = /(\d+(?:\.\d+)?)\s*(kg|g|L|ml|ℓ)\b/i;

/** 수량 패턴: 100매, 30개입, 25매입, 4개 등 (개입수/매입수/개 = 수량) */
const QTY_REGEX = /(\d+)\s*(매|개입|입|매입|개)\b/i;

function normalizeRaw(raw: string): string[] {
  let s = String(raw ?? "").trim();
  s = s.replace(/^\[[^\]]*]\s*/g, "");
  s = s.replace(/라이트\s*패키지/gi, "라이트");
  s = s.replace(/섬유유연제/g, "섬유");
  s = s.replace(/[\[\]_]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  let tokens = s ? s.split(" ").filter(Boolean) : [];
  tokens = tokens
    .map((t) => (t.toUpperCase() === "CLA" ? "클라" : t))
    .filter((t) => !/^8인1초고농축$/i.test(t) && !/^라이프케어$/i.test(t));
  return tokens;
}

/** 중복 제거 (대소문자 무시) */
function dedupeTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

/** 수량 추출: 25매입, 100개입 등 */
function extractQty(tokens: string[]): { qty?: string; rest: string[] } {
  const str = tokens.join(" ");
  const m = str.match(QTY_REGEX);
  if (!m) return { rest: tokens };
  const unit = m[2].toLowerCase();
  const num = m[1];
  const qty =
    unit === "매" || unit === "매입" ? `${num}매입`
    : unit === "개" ? `${num}개`
    : `${num}개입`;
  const restStr = str.replace(QTY_REGEX, " ").replace(/\s+/g, " ").trim();
  return { qty, rest: restStr ? restStr.split(" ").filter(Boolean) : [] };
}

/** 사이즈·용량 추출: 2kg, 1L, 500ml 등 */
function extractSize(tokens: string[]): { size?: string; rest: string[] } {
  const str = tokens.join(" ");
  const m = str.match(SIZE_REGEX);
  if (!m) return { rest: tokens };
  const size = `${m[1]}${m[2].toLowerCase().replace("ℓ", "L")}`;
  const restStr = str.replace(SIZE_REGEX, " ").replace(/\s+/g, " ").trim();
  return { size, rest: restStr ? restStr.split(" ").filter(Boolean) : [] };
}

/** 제거할 일반 토큰 (의미 없음) */
const STOP_TOKENS = new Set([
  "kf94", "kf80", "2d", "3d", "세트", "팩", "용", "형",
  "일반", "기본", "표준", "프리미엄", "에코",
  "캡슐세제", "세제", "마스크", "유연제", "액상",
]);

/**
 * 축약 이름 생성 - 중복 제거, 유의미한 정보 포함
 * @param raw - 원본 품목명
 * @param packSize - SKU당 개입수 (있으면 수량 없을 때 기본으로 추가)
 */
export function simplifyProductName(raw: string, packSize?: number): string {
  let tokens = normalizeRaw(raw);
  if (tokens.length === 0) return "";

  tokens = dedupeTokens(tokens);

  const { qty, rest: r1 } = extractQty(tokens);
  const { size, rest: r2 } = extractSize(r1);

  const remaining = dedupeTokens(r2);
  const meaningful: string[] = [];
  for (const t of remaining) {
    const lower = t.toLowerCase();
    if (STOP_TOKENS.has(lower)) continue;
    if (/^\d+$/.test(t)) continue;
    if (t.length < 2) continue;
    meaningful.push(t);
  }

  const baseName = meaningful.slice(0, 2).map((t) => t.replace(/플러스$/g, "")).join(" ").trim() || meaningful[0] || "";
  const attrParts: string[] = [];
  if (meaningful.length > 2) attrParts.push(meaningful.slice(2, 4).join("/"));
  if (size) attrParts.push(size);
  if (qty) attrParts.push(qty);
  if (!qty && packSize != null && packSize > 0) attrParts.push(`${Math.round(packSize)}개입`);

  if (!baseName) return attrParts.join("/") || raw;
  if (attrParts.length === 0) return baseName;

  return `${baseName}(${attrParts.join("/")})`;
}

/**
 * 표/리스트용 표시 이름 생성
 * - 최대 maxChars 글자로 자르고, 넘치면 … 추가
 * - Tooltip에는 원본 전체 이름을 사용하는 것을 권장
 */
export function formatProductDisplayName(
  raw: string,
  maxChars: number = 15
): { display: string; full: string; simplified: string } {
  const simplified = simplifyProductName(raw) || raw || "";
  const base = simplified.trim();
  if (base.length <= maxChars) {
    return { display: base, full: raw, simplified: base };
  }
  const display = `${base.slice(0, Math.max(0, maxChars - 1))}…`;
  return { display, full: raw, simplified: base };
}
