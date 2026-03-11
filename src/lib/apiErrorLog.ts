/** API 에러 로그 - 파일명:줄번호 형식 (404/500 에러 상세 출력) */
export function logApiError(file: string, line: number, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : "";
  console.error(`[${file}:${line}] line error:`, msg);
  if (stack) {
    const lines = stack.split("\n").slice(0, 5);
    lines.forEach((l) => console.error("  ", l.trim()));
  }
}
