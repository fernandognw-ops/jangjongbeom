/** 상품명 축약 및 표시용 유틸리티 */

/** 원본 상품명에서 불필요한 접두사·기술 정보를 정리한 기초 문자열 */
function normalizeProductName(raw: string): string {
  if (!raw) return "";
  let s = String(raw).trim();

  // 대괄호 수식어 제거: [라이트] 등
  s = s.replace(/^\[[^\]]*]\s*/g, "");

  // 브랜드/시리즈 접두사 제거: CLA_, CLA-
  s = s.replace(/^CLA[_\-\s]+/i, "");

  // 언더바 → 공백
  s = s.replace(/_/g, " ");

  // 공백 정리
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/** 예: "100매", "100개입", "100입" → "100입" */
function extractQuantityToken(tokens: string[]): { qtyLabel?: string; withoutQty: string[] } {
  let qtyLabel: string | undefined;
  const withoutQty: string[] = [];

  for (const t of tokens) {
    const m = t.match(/(\d+)\s*(매|개입|입)/);
    if (m && !qtyLabel) {
      qtyLabel = `${m[1]}입`;
    } else {
      withoutQty.push(t);
    }
  }
  return { qtyLabel, withoutQty };
}

/** 기술 정보/불필요 토큰 필터링 */
function filterTechnicalTokens(tokens: string[]): string[] {
  const stopExact = new Set(["kf94", "kf80", "2d", "3d"]);
  return tokens.filter((t) => {
    const lower = t.toLowerCase();
    if (stopExact.has(lower)) return false;
    // 지나치게 일반적인 기술 단어는 제거
    if (/(캡슐세제|세제|마스크)/.test(t)) return false;
    return true;
  });
}

/** 예시 규칙을 반영한 축약 이름 생성 */
export function simplifyProductName(raw: string): string {
  const base = normalizeProductName(raw);
  if (!base) return "";

  let tokens = base.split(" ").filter(Boolean);
  if (tokens.length === 0) return "";

  // 수량 토큰 추출
  const { qtyLabel, withoutQty } = extractQuantityToken(tokens);
  tokens = withoutQty;

  // 기술 토큰 제거
  tokens = filterTechnicalTokens(tokens);
  if (tokens.length === 0) {
    // 전부 제거되면 수량만이라도 표시
    return qtyLabel ?? raw;
  }

  // 베이스 이름: 첫 단어 + (있다면) 두 번째 단어를 약간 정리해서 사용
  let baseName = tokens[0];
  if (tokens[1]) {
    let second = tokens[1];
    // "미니플러스" → "미니"
    second = second.replace(/플러스$/g, "");
    baseName = `${tokens[0]} ${second}`.trim();
  }

  // 속성 후보: 나머지 토큰 중 의미 있는 것
  const attrCandidates = tokens.slice(1).filter((t) => !/(세트|팩|매입|개입|입)$/.test(t));
  const attrs: string[] = [];
  for (const t of attrCandidates) {
    if (attrs.length >= 2) break;
    attrs.push(t);
  }

  // 괄호 안 내용 구성
  const parts: string[] = [];
  if (attrs.length > 0) {
    parts.push(attrs.join("/"));
  }
  if (qtyLabel) {
    parts.push(qtyLabel);
  }

  if (parts.length === 0) {
    return baseName || raw;
  }

  return `${baseName}(${parts.join("/")})`;
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

