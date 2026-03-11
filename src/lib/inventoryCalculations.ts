/**
 * 재고 관리 계산 함수
 * - 실시간 가용 재고 (물류센터 마감 시차 보정)
 * - 재고 소진일(Run-out date) 예측
 * - 쿠팡/일반 매출 분리 분석
 */

import type { Transaction } from "./types";
import { mapGroupToItemId } from "./unifiedImport";

export type SalesChannel = "coupang" | "general";

/** 물류센터 마감 시각 (KST 기준) */
export interface LogisticsCutoff {
  channel: SalesChannel;
  hour: number;   // 0-23
  minute: number; // 0-59
}

const DEFAULT_CUTOFF: LogisticsCutoff[] = [
  { channel: "coupang", hour: 18, minute: 0 },  // 쿠팡: 18:00 마감
  { channel: "general", hour: 23, minute: 59 }, // 일반: 23:59 마감
];

/** Transaction에 매출구분(쿠팡/일반) 필드 확장 */
export interface TransactionWithChannel extends Transaction {
  salesChannel?: SalesChannel;
}

/**
 * 현재 시각이 해당 채널의 "당일 마감 전"인지 판단
 * @param channel 쿠팡 | 일반
 * @param now 기준 시각 (Date)
 * @param cutoffs 마감 시각 설정 (없으면 기본값)
 */
export function isBeforeCutoff(
  channel: SalesChannel,
  now: Date = new Date(),
  cutoffs: LogisticsCutoff[] = DEFAULT_CUTOFF
): boolean {
  const cfg = cutoffs.find((c) => c.channel === channel) ?? {
    channel,
    hour: 23,
    minute: 59,
  };
  const cutoffMinutes = cfg.hour * 60 + cfg.minute;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes < cutoffMinutes;
}

/**
 * 실시간 가용 재고 계산 (물류센터 마감 시차 보정)
 *
 * - 쿠팡: 18시 이전이면 오늘 출고분이 아직 반영 안 됨 → "가용" = 현재고
 * - 쿠팡: 18시 이후면 오늘 출고 반영됨 → "가용" = 현재고 (이미 차감된 상태)
 * - 일반: 24시 전까지 당일 출고 반영
 *
 * "실시간 가용" = 현재 시점에서 실제로 주문 가능한 수량
 * - 물류센터 마감 전: 당일 예정 출고분을 아직 차감하지 않은 "가용" 수량
 * - 물류센터 마감 후: 이미 차감된 현재고 = 가용 수량
 *
 * @param currentStock 현재 재고 (품목별 또는 제품별)
 * @param todayOutByChannel 오늘 출고 예정/실적 (채널별)
 * @param now 기준 시각
 */
export function computeRealTimeAvailableStock(
  currentStock: number,
  todayOutByChannel: { coupang: number; general: number },
  now: Date = new Date()
): number {
  let pendingDeduction = 0;

  // 쿠팡: 18시 이전이면 오늘 쿠팡 출고분은 아직 시스템에 반영 안 됨
  // → "가용" = 현재고 - (아직 반영 안 된 쿠팡 출고)
  if (isBeforeCutoff("coupang", now)) {
    pendingDeduction += todayOutByChannel.coupang;
  }

  // 일반: 23:59 이전이면 오늘 일반 출고분 미반영
  if (isBeforeCutoff("general", now)) {
    pendingDeduction += todayOutByChannel.general;
  }

  // 실시간 가용 = 현재고 - 아직 반영되지 않은 당일 출고
  return Math.max(0, currentStock - pendingDeduction);
}

/**
 * 트랜잭션에서 오늘 출고량을 채널별로 집계 (전체)
 */
export function getTodayOutboundByChannel(
  transactions: Transaction[],
  now: Date = new Date()
): { coupang: number; general: number } {
  const today = now.toISOString().slice(0, 10);
  const result = { coupang: 0, general: 0 };

  for (const tx of transactions) {
    if (tx.type !== "out" || tx.date !== today) continue;
    const ch = (tx as TransactionWithChannel).salesChannel;
    if (ch === "coupang") result.coupang += tx.quantity;
    else result.general += tx.quantity; // 일반 또는 미지정
  }
  return result;
}

/**
 * 품목별 오늘 출고량 (채널 구분 없이 합계 - 마감 시차 보정용)
 * 채널별 보정이 필요하면 getTodayOutboundByChannelPerItem 사용
 */
export function getTodayOutboundByItem(
  transactions: Transaction[],
  now: Date = new Date()
): Record<string, { coupang: number; general: number }> {
  const today = now.toISOString().slice(0, 10);
  const result: Record<string, { coupang: number; general: number }> = {};

  for (const tx of transactions) {
    if (tx.type !== "out" || tx.date !== today) continue;
    const ch = (tx as TransactionWithChannel).salesChannel;
    const itemId = tx.itemId;
    if (!result[itemId]) result[itemId] = { coupang: 0, general: 0 };
    if (ch === "coupang") result[itemId].coupang += tx.quantity;
    else result[itemId].general += tx.quantity;
  }
  return result;
}

/**
 * 최근 N일 평균 일일 출고량 계산 (소진일 예측용)
 * @param transactions 출고 트랜잭션
 * @param itemId 품목 ID (또는 productCode로 제품별)
 * @param days 최근 일수 (기본 30일, 1년 데이터 있으면 90일 권장)
 */
export function getAverageDailyOutbound(
  transactions: Transaction[],
  itemId: string,
  days: number = 30,
  byProduct: boolean = false
): number {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const dailyTotal: Record<string, number> = {};
  let totalQty = 0;

  for (const tx of transactions) {
    if (tx.type !== "out" || tx.date < cutoffStr) continue;
    const key = byProduct ? (tx.productCode ?? itemId) : itemId;
    const match = byProduct
      ? tx.productCode === itemId
      : tx.itemId === itemId;
    if (!match) continue;

    dailyTotal[tx.date] = (dailyTotal[tx.date] ?? 0) + tx.quantity;
    totalQty += tx.quantity;
  }

  const dayCount = Object.keys(dailyTotal).length;
  if (dayCount === 0) return 0;
  return totalQty / dayCount; // 실제 거래일 기준 평균
}

/**
 * 재고 소진일(Run-out date) 예측
 * @param currentStock 현재 재고 수량
 * @param avgDailyOut 평균 일일 출고량
 * @param fromDate 기준일 (기본: 오늘)
 * @returns 예상 소진일 (YYYY-MM-DD) 또는 null (소진 불가/재고 충분)
 */
export function predictRunOutDate(
  currentStock: number,
  avgDailyOut: number,
  fromDate: Date = new Date()
): { date: string | null; daysLeft: number; isInfinite: boolean } {
  if (currentStock <= 0) {
    return { date: fromDate.toISOString().slice(0, 10), daysLeft: 0, isInfinite: false };
  }
  if (avgDailyOut <= 0) {
    return { date: null, daysLeft: Infinity, isInfinite: true };
  }

  const daysLeft = Math.floor(currentStock / avgDailyOut);
  const runOut = new Date(fromDate);
  runOut.setDate(runOut.getDate() + daysLeft);

  return {
    date: runOut.toISOString().slice(0, 10),
    daysLeft,
    isInfinite: false,
  };
}

/**
 * 품목별 소진일 예측 결과
 */
export interface RunOutPrediction {
  itemId: string;
  itemName: string;
  currentStock: number;
  avgDailyOut: number;
  runOutDate: string | null;
  daysLeft: number;
  isInfinite: boolean;
  isUrgent: boolean; // 7일 이내 소진 예상
}

/**
 * 전체 품목에 대한 소진일 예측
 */
export function predictAllRunOutDates(
  stock: Record<string, number>,
  transactions: Transaction[],
  itemNames: Record<string, string>,
  lookbackDays: number = 30
): RunOutPrediction[] {
  const results: RunOutPrediction[] = [];
  const itemIds = Object.keys(stock);

  for (const itemId of itemIds) {
    const currentStock = stock[itemId] ?? 0;
    const avgDailyOut = getAverageDailyOutbound(transactions, itemId, lookbackDays, false);
    const pred = predictRunOutDate(currentStock, avgDailyOut);
    const daysLeft = pred.isInfinite ? 999 : pred.daysLeft;

    results.push({
      itemId,
      itemName: itemNames[itemId] ?? itemId,
      currentStock,
      avgDailyOut: Math.round(avgDailyOut * 10) / 10,
      runOutDate: pred.date,
      daysLeft,
      isInfinite: pred.isInfinite,
      isUrgent: !pred.isInfinite && pred.daysLeft <= 7 && pred.daysLeft >= 0,
    });
  }

  // 소진일 가까운 순 정렬 (무한대 제외)
  return results.sort((a, b) => {
    if (a.isInfinite && b.isInfinite) return 0;
    if (a.isInfinite) return 1;
    if (b.isInfinite) return -1;
    return a.daysLeft - b.daysLeft;
  });
}
