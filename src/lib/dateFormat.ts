/** 로컬 타임존 기준 YYYY-MM-DD */
export function toYmd(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";

  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}
