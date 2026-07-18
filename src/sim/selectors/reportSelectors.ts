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

// ---------------------------------------------------------------------------
// Challenge mode — the day-200 final score
// ---------------------------------------------------------------------------

export const CHALLENGE_END_DAY = 200;

export interface ChallengeScore {
  total: number; // 0–1000
  valuation: number;
  valuationPts: number; // up to 600
  satisfaction: number;
  satisfactionPts: number; // up to 150
  peakShare: number;
  sharePts: number; // up to 150
  exportRevenue: number;
  exportPts: number; // up to 100
}

/**
 * The challenge-run score: deterministic, pure, and comparable across runs of
 * the same scenario/difficulty/seed. Valuation dominates (it is the game's
 * scoreboard metric), but a thriving town and trade empire pay too.
 */
export function challengeScore(state: GameState): ChallengeScore {
  const player = state.firms[state.playerFirmId];
  const valuation = companyValuation(state, state.playerFirmId).valuation;
  const cits = Object.values(state.citizens);
  const satisfaction = cits.length
    ? cits.reduce((a, c) => a + c.satisfaction, 0) / cits.length
    : 0;
  const peakShare = player
    ? Object.values(player.marketShareByProduct).reduce((a, v) => Math.max(a, v), 0)
    : 0;
  const exportRevenue = player?.exportRevenue ?? 0;

  const valuationPts = Math.round(600 * clamp(valuation / 15_000_000, 0, 1)); // $150k caps it
  const satisfactionPts = Math.round(150 * clamp(satisfaction / 100, 0, 1));
  const sharePts = Math.round(150 * clamp(peakShare, 0, 1));
  const exportPts = Math.round(100 * clamp(exportRevenue / 2_000_000, 0, 1)); // $20k caps it

  return {
    total: valuationPts + satisfactionPts + sharePts + exportPts,
    valuation,
    valuationPts,
    satisfaction,
    satisfactionPts,
    peakShare,
    sharePts,
    exportRevenue,
    exportPts,
  };
}
