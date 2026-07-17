/**
 * achievements.ts — Achievement definitions (data-driven).
 *
 * Each achievement is a pure predicate over GameState, checked hourly by
 * AchievementSystem. Unlocks are stored in `state.achievements` as {id, day}
 * so saves stay JSON-safe; the defs (names, icons, checks) live here as code.
 *
 * To add an achievement: append a def. Checks should be cheap — they run for
 * every locked achievement once per in-game hour.
 */

import type { GameState } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';
import { activeWorldEvents } from './worldEvents';
import { dollars } from './constants';

export interface AchievementDef {
  id: string;
  name: string;
  icon: string;
  /** Shown when unlocked — what the player did. */
  description: string;
  /** Shown while locked — how to get it. */
  hint: string;
  check: (state: GameState) => boolean;
}

function player(state: GameState) {
  return state.firms[state.playerFirmId];
}

function latestNetProfit(state: GameState): number | null {
  const hist = player(state)?.accounting.dailyHistory;
  if (!hist || hist.length === 0) return null;
  return hist[hist.length - 1]!.netProfit;
}

function maxPlayerShare(state: GameState): number {
  const p = player(state);
  if (!p) return 0;
  let best = 0;
  for (const pid in p.marketShareByProduct) {
    best = Math.max(best, p.marketShareByProduct[pid] ?? 0);
  }
  return best;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: 'founder',
    name: 'Open for Business',
    icon: '🏗️',
    description: 'Built your first facility.',
    hint: 'Build any facility from the Build panel.',
    check: (s) => (player(s)?.facilities.length ?? 0) >= 1,
  },
  {
    id: 'first_sale',
    name: 'First Sale',
    icon: '🛒',
    description: 'Earned your first revenue from a customer.',
    hint: 'Sell anything to a citizen at one of your stores.',
    check: (s) => (player(s)?.accounting.lifetime.revenue ?? 0) > 0,
  },
  {
    id: 'in_the_black',
    name: 'In the Black',
    icon: '📗',
    description: 'Closed a day with positive net profit.',
    hint: 'End a full day earning more than you spend.',
    check: (s) => (latestNetProfit(s) ?? 0) > 0,
  },
  {
    id: 'vertical',
    name: 'Vertically Integrated',
    icon: '🔗',
    description: 'Own a producer, a factory, and a store — a full chain.',
    hint: 'Own a farm or mine, plus a factory, plus a retail store.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      let raw = false, fact = false, shop = false;
      for (const fid of p.facilities) {
        const t = s.facilities[fid]?.type;
        if (t === 'farm' || t === 'mine') raw = true;
        else if (t === 'factory') fact = true;
        else if (t === 'retail') shop = true;
      }
      return raw && fact && shop;
    },
  },
  {
    id: 'job_creator',
    name: 'Job Creator',
    icon: '👷',
    description: 'Employ 10 citizens.',
    hint: 'Grow your workforce to 10 employees.',
    check: (s) => (player(s)?.employees.length ?? 0) >= 10,
  },
  {
    id: 'major_employer',
    name: 'Pillar of the Town',
    icon: '🏛️',
    description: 'Employ 25 citizens.',
    hint: 'Grow your workforce to 25 employees.',
    check: (s) => (player(s)?.employees.length ?? 0) >= 25,
  },
  {
    id: 'household_name',
    name: 'Household Name',
    icon: '📣',
    description: 'Reached 50 brand on a product.',
    hint: 'Sustain an ad budget until a product brand hits 50.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      for (const pid in p.brandByProduct) {
        if ((p.brandByProduct[pid] ?? 0) >= 50) return true;
      }
      return false;
    },
  },
  {
    id: 'master_craft',
    name: 'Master Craftsman',
    icon: '⭐',
    description: 'Reached 90 quality on a product.',
    hint: 'Invest in R&D until a product quality hits 90.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      for (const pid in p.qualityByProduct) {
        if ((p.qualityByProduct[pid] ?? 0) >= 90) return true;
      }
      return false;
    },
  },
  {
    id: 'market_leader',
    name: 'Market Leader',
    icon: '🥇',
    description: 'Took over half of a product market.',
    hint: 'Win ≥50% market share in any product.',
    check: (s) => maxPlayerShare(s) >= 0.5,
  },
  {
    id: 'monopolist',
    name: 'Monopolist',
    icon: '👑',
    description: 'Practically the only game in town — 90% share.',
    hint: 'Win ≥90% market share in any product.',
    check: (s) => maxPlayerShare(s) >= 0.9,
  },
  {
    id: 'rising_star',
    name: 'Rising Star',
    icon: '🌟',
    description: 'Company valued at $25,000.',
    hint: 'Grow company valuation to $25,000.',
    check: (s) => companyValuation(s, s.playerFirmId).valuation >= dollars(25000),
  },
  {
    id: 'tycoon',
    name: 'Tycoon',
    icon: '🏆',
    description: 'Hit the $50,000 valuation objective.',
    hint: 'Reach the win objective: $50,000 company value.',
    check: (s) => companyValuation(s, s.playerFirmId).valuation >= dollars(50000),
  },
  {
    id: 'empire',
    name: 'Business Empire',
    icon: '🌆',
    description: 'Company valued at $100,000 — twice the objective.',
    hint: 'Keep going: $100,000 company value.',
    check: (s) => companyValuation(s, s.playerFirmId).valuation >= dollars(100000),
  },
  {
    id: 'shareholder',
    name: 'Shareholder',
    icon: '📊',
    description: 'Bought a stake in a rival company.',
    hint: 'Buy shares of a competitor from the Company dashboard.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      for (const fid in p.sharesHeld) {
        if ((p.sharesHeld[fid] ?? 0) > 0) return true;
      }
      return false;
    },
  },
  {
    id: 'shark',
    name: 'The Shark',
    icon: '🦈',
    description: 'Acquired a rival company outright.',
    hint: 'Buy out an entire AI competitor from the Company dashboard.',
    check: (s) => (player(s)?.acquiredNames.length ?? 0) > 0,
  },
  {
    id: 'storm_rider',
    name: 'Storm Rider',
    icon: '⛈️',
    description: 'Ran a profitable day during bad economic news.',
    hint: 'Close a profitable day while a negative world event is active.',
    check: (s) => {
      if ((player(s)?.facilities.length ?? 0) === 0) return false;
      if ((latestNetProfit(s) ?? 0) <= 0) return false;
      return activeWorldEvents(s).some(
        (ev) => ev.def.severity === 'warning' || ev.def.severity === 'danger',
      );
    },
  },
  {
    id: 'boomtown',
    name: 'Boomtown',
    icon: '🏘️',
    description: 'The town grew to 60 citizens.',
    hint: 'Keep satisfaction and jobs high so 20 new citizens move in.',
    check: (s) => Object.keys(s.citizens).length >= 60,
  },
];

const DEF_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENT_DEFS.map((d) => [d.id, d]),
);

export function getAchievementDef(id: string): AchievementDef | undefined {
  return DEF_BY_ID[id];
}

export function isAchievementUnlocked(state: GameState, id: string): boolean {
  return state.achievements.some((a) => a.id === id);
}
