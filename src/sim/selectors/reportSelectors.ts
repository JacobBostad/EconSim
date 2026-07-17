/**
 * reportSelectors — the quarterly report card, derived entirely from state
 * histories (no new engine bookkeeping). A "quarter" is 30 in-game days.
 */

import type { GameState } from '../core/GameState';
import { companyValuation } from './companySelectors';
import { CONSUMER_PRODUCT_IDS, getProduct } from '../data/products';
import { getAchievementDef } from '../data/achievements';
import { getMissionDef } from '../data/missions';
import { ticksPerDay } from '../core/Tick';
import { clamp } from '../../utils/clamp';

export const QUARTER_DAYS = 30;

export interface ShareLine {
  productId: string;
  name: string;
  shareNow: number;
  shareStart: number;
}

export interface QuarterReport {
  quarter: number; // 1-based
  startDay: number;
  endDay: number;
  valuationStart: number;
  valuationEnd: number;
  valuationSeries: number[];
  netProfitTotal: number;
  revenueTotal: number;
  shares: ShareLine[];
  achievementNames: string[];
  missionNames: string[];
  employees: number;
  acquisitions: string[];
  grade: string;
  score: number;
}

export function currentDay(state: GameState): number {
  return Math.floor(state.tick / ticksPerDay(state.config));
}

/** 1-based index of the most recently COMPLETED quarter, or 0 if none. */
export function completedQuarters(state: GameState): number {
  return Math.floor(currentDay(state) / QUARTER_DAYS);
}

export function letterGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 68) return 'B';
  if (score >= 55) return 'C';
  if (score >= 42) return 'D';
  return 'F';
}

/** Build the report for a completed quarter (1-based). */
export function quarterReport(state: GameState, quarter: number): QuarterReport {
  const startDay = (quarter - 1) * QUARTER_DAYS;
  const endDay = quarter * QUARTER_DAYS - 1;
  const player = state.firms[state.playerFirmId];
  const hist = (player?.accounting.dailyHistory ?? []).filter(
    (d) => d.day >= startDay && d.day <= endDay,
  );

  const valuationSeries = hist.map((d) => d.valuation);
  const valuationEnd =
    valuationSeries.length > 0
      ? valuationSeries[valuationSeries.length - 1]!
      : companyValuation(state, state.playerFirmId).valuation;
  const valuationStart = valuationSeries[0] ?? valuationEnd;
  const netProfitTotal = hist.reduce((a, d) => a + d.netProfit, 0);
  const revenueTotal = hist.reduce((a, d) => a + d.revenue, 0);

  const shares: ShareLine[] = CONSUMER_PRODUCT_IDS.map((pid) => {
    const h = state.marketStats[pid]?.history ?? [];
    const at = (day: number): number => {
      // Latest snapshot at or before `day` (0 when none).
      let share = 0;
      for (const snap of h) {
        if (snap.day > day) break;
        share = snap.sharesByFirm[state.playerFirmId] ?? 0;
      }
      return share;
    };
    return {
      productId: pid,
      name: getProduct(pid).name,
      shareNow: at(endDay),
      shareStart: at(startDay),
    };
  });

  const achievementNames = state.achievements
    .filter((a) => a.day >= startDay && a.day <= endDay)
    .map((a) => getAchievementDef(a.id))
    .filter((d) => !!d)
    .map((d) => `${d.icon} ${d.name}`);
  const missionNames = state.missions
    .filter((m) => m.day >= startDay && m.day <= endDay)
    .map((m) => getMissionDef(m.id))
    .filter((d) => !!d)
    .map((d) => `${d.icon} ${d.name}`);

  // Grade: growth, profitability, and market presence. A quarter spent
  // building (heavy buildSpend) is a growth phase, not failure — losses are
  // judged gently while investing.
  const growth = (valuationEnd - valuationStart) / Math.max(1, valuationStart);
  const buildSpend = hist.reduce((a, d) => a + d.buildSpend, 0);
  const investing = buildSpend > Math.abs(netProfitTotal);
  const bestShare = Math.max(0, ...shares.map((s) => s.shareNow));
  const shareGain = Math.max(0, ...shares.map((s) => s.shareNow - s.shareStart));
  let score = 50;
  score += clamp(growth * 100, -25, 25);
  score += netProfitTotal > 0 ? 12 : netProfitTotal < 0 ? (investing ? -4 : -12) : 0;
  score += bestShare * 25 + shareGain * 15;
  score += clamp(achievementNames.length * 2, 0, 8);
  score = clamp(score, 0, 100);

  return {
    quarter,
    startDay,
    endDay,
    valuationStart,
    valuationEnd,
    valuationSeries,
    netProfitTotal,
    revenueTotal,
    shares,
    achievementNames,
    missionNames,
    employees: player?.employees.length ?? 0,
    acquisitions: player?.acquiredNames ?? [],
    grade: letterGrade(score),
    score,
  };
}
