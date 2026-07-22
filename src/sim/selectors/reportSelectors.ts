/**
 * reportSelectors — the quarterly report card, derived entirely from state
 * histories (no new engine bookkeeping). A "quarter" is 30 in-game days.
 */

import type { GameState } from '../core/GameState';
import { townOf } from '../core/Town';
import { companyValuation } from './companySelectors';
import { CONSUMER_PRODUCT_IDS_BY_PRESET, getProduct } from '../data/products';
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

  const marketStats = townOf(state).marketStats;
  const shares: ShareLine[] = CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset].map((pid) => {
    const h = marketStats[pid]?.history ?? [];
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
  total: number; // 0–1000 raw points × difficulty multiplier
  /** Difficulty scaling applied to the raw sum (0.85 / 1.0 / 1.15). */
  difficultyMult: number;
  rawTotal: number;
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
 *
 * The score reads the era economy honestly: `valuation` is net-worth-based
 * (companyValuation — cash + inventory + assets + stakes − debt, plus a P/E
 * premium on recent daily net profit), and at City scale rent, service seats,
 * dividends, and pool-export revenue all flow through cash and daily net profit
 * into that number, so a City empire's income streams score the same as an
 * operator's sales. Town satisfaction is population-weighted over the whole
 * town — the simulated cast AND the crowd cohorts — so a City score reflects
 * the hundreds it never individually simulates. In a Village the crowd is
 * empty, so that weighting reduces to the cast mean exactly and the score stays
 * bit-identical.
 */
export function challengeScore(state: GameState): ChallengeScore {
  const player = state.firms[state.playerFirmId];
  const valuation = companyValuation(state, state.playerFirmId).valuation;
  // Town satisfaction — population-weighted over the cast plus the crowd
  // cohorts, mirroring the cohort migration gate's townAvg (CohortSocialSystem).
  // Village cohorts are empty, so the crowd loop is a no-op and this equals the
  // cast mean the Village score has always used (bit-identity preserved).
  const cits = Object.values(townOf(state).citizens);
  let satMass = 0;
  let headcount = 0;
  for (const c of cits) {
    satMass += c.satisfaction;
    headcount += 1;
  }
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohorts = townOf(state).cohorts;
  for (const cid of Object.keys(cohorts).sort()) {
    const co = cohorts[cid]!;
    if (co.population <= 0) continue;
    satMass += co.avgSatisfaction * co.population;
    headcount += co.population;
  }
  const satisfaction = headcount > 0 ? satMass / headcount : 0;
  const peakShare = player
    ? Object.values(player.marketShareByProduct).reduce((a, v) => Math.max(a, v), 0)
    : 0;
  const exportRevenue = player?.exportRevenue ?? 0;

  const valuationPts = Math.round(600 * clamp(valuation / 15_000_000, 0, 1)); // $150k caps it
  // Satisfaction only scores above the immigration-gate baseline (55): an
  // unattended town equilibrates around 60-65 on its own, so points start
  // where stewardship starts — 90 (a genuinely pampered town) maxes it.
  const satisfactionPts = Math.round(150 * clamp((satisfaction - 55) / 35, 0, 1));
  const sharePts = Math.round(150 * clamp(peakShare, 0, 1));
  const exportPts = Math.round(100 * clamp(exportRevenue / 2_000_000, 0, 1)); // $20k caps it
  const rawTotal = valuationPts + satisfactionPts + sharePts + exportPts;
  // Harder starts are worth more — equal output on Brutal beats it on Relaxed.
  const difficultyMult =
    state.config.difficulty === 'brutal' ? 1.15 : state.config.difficulty === 'relaxed' ? 0.85 : 1;

  return {
    total: Math.round(rawTotal * difficultyMult),
    difficultyMult,
    rawTotal,
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
