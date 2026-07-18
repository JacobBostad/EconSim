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
import { seasonOf, seasonOfDay } from './seasons';
import { ticksPerDay } from '../core/Tick';
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
    description: 'Company valued at $100,000 — Magnate territory.',
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
    id: 'house_of_luxury',
    name: 'House of Luxury',
    icon: '💎',
    description: 'Sold luxury goods (pastries or jewelry) to the town.',
    hint: 'R&D a product to quality 75, run a luxury recipe, and sell it.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return (p.marketShareByProduct['pastries'] ?? 0) > 0 ||
        (p.marketShareByProduct['jewelry'] ?? 0) > 0;
    },
  },
  {
    id: 'winter_proof',
    name: 'Winter-Proof',
    icon: '⛄',
    description: 'Ran profitably through an entire winter.',
    hint: 'Stockpile ahead and keep every winter day in the black.',
    check: (s) => {
      if (seasonOf(s) !== 'spring') return false;
      const day = Math.floor(s.tick / ticksPerDay(s.config));
      if (day < 120) return false; // needs a full first winter behind it
      const hist = player(s)?.accounting.dailyHistory ?? [];
      const winter = hist.filter(
        (d) => d.day >= day - 31 && seasonOfDay(d.day) === 'winter',
      );
      return winter.length >= 30 && winter.every((d) => d.netProfit > 0);
    },
  },
  {
    id: 'trade_baron',
    name: 'Trade Baron',
    icon: '🚢',
    description: 'Earned $2,000 exporting goods to the trade cities.',
    hint: 'Stage goods in a warehouse and export when trade prices spike.',
    check: (s) => (player(s)?.exportRevenue ?? 0) >= dollars(2000),
  },
  {
    id: 'towns_supplier',
    name: "The Town's Supplier",
    icon: '🌾',
    description: 'Earned $1,000 selling wholesale to other firms.',
    hint: 'Overproduce intermediates (grain, minerals) — AI firms switch their import lines to any local surplus that beats the importer price.',
    check: (s) => (player(s)?.wholesaleEarned ?? 0) >= dollars(1000),
  },
  {
    id: 'undercutter',
    name: 'Undercutter',
    icon: '🔪',
    description: 'Served an AI customer while asking 60% of market or less.',
    hint: 'Cut a facility\'s wholesale asking price (facility inspector) — AI buyers always take the cheapest qualifying supplier, and defect to anyone 10%+ cheaper.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      for (const fid of p.facilities) {
        const fac = s.facilities[fid];
        if (!fac || (fac.wholesalePriceMult ?? 1) > 0.6) continue;
        for (const cid in s.contracts) {
          const c = s.contracts[cid]!;
          if (!c.active || c.sourceFacilityId !== fac.id) continue;
          if (s.facilities[c.destinationFacilityId]?.ownerFirmId !== p.id) return true;
        }
      }
      return false;
    },
  },
  {
    id: 'master_crew',
    name: 'Master Crew',
    icon: '🎓',
    description: 'Ran a facility whose crew (2+) averages 1.25+ skill.',
    hint: 'Skill grows on the job (0.012/workday) or jumps +0.15 per training workshop (facility inspector). Veterans produce up to 1.3× — keep them from being poached.',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      for (const fid of p.facilities) {
        const fac = s.facilities[fid];
        if (!fac || fac.employees.length < 2) continue;
        const avg = fac.employees.reduce((sum, cid) => sum + (s.citizens[cid]?.skill ?? 0), 0) / fac.employees.length;
        if (avg >= 1.25) return true;
      }
      return false;
    },
  },
  {
    id: 'bargain_hunter',
    name: 'Bargain Hunter',
    icon: '🏷️',
    description: 'Bought a rival facility in a fire sale.',
    hint: 'When a rival facility bleeds money long enough, its owner puts it on the block at 75% of build cost — watch the ticker and pounce.',
    check: (s) => s.fireSalesBought >= 1,
  },
  {
    id: 'beat_the_clock',
    name: 'Beat the Clock',
    icon: '🚚',
    description: 'Completed a port rush order before the deadline.',
    hint: 'Rush orders appear in the map ticker once you own a warehouse — stockpile the product and ship it out (any port counts) before the buyer moves on.',
    check: (s) => s.rushOrdersCompleted >= 1,
  },
  {
    id: 'arbitrageur',
    name: 'Arbitrageur',
    icon: '⚖️',
    description: 'Earned $500 of export revenue from Port Rosa AND $500 from Ironvale.',
    hint: 'Ironvale pays up for tools, minerals and finery; Port Rosa for the rest. Ship where the spread says.',
    check: (s) => {
      const byCity = player(s)?.exportRevenueByCity ?? {};
      return (byCity['port_rosa'] ?? 0) >= dollars(500) && (byCity['ironvale'] ?? 0) >= dollars(500);
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
  {
    id: 'landlord_baron',
    name: 'Landlord Baron',
    icon: '🏢',
    description: 'Owned three apartments, every one housing residents.',
    hint: 'Build 3 Apartments and fill them all (immigration needs housing).',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      let full = 0;
      for (const fid of p.facilities) {
        const f = s.facilities[fid];
        if (f?.defId === 'apartment' && f.residentIds.length >= 1) full += 1;
      }
      return full >= 3;
    },
  },
  {
    id: 'coffee_magnate',
    name: 'Coffee Magnate',
    icon: '☕',
    description: 'Owned half the coffee market.',
    hint: 'Win ≥50% market share in Coffee — the niche nobody serves at start.',
    check: (s) => (player(s)?.marketShareByProduct['coffee'] ?? 0) >= 0.5,
  },
  {
    id: 'talent_magnet',
    name: 'Talent Magnet',
    icon: '🧲',
    description: 'Paid 1.15× every rival\'s wage with a real team on payroll.',
    hint: 'Set your base wage past the poaching bar (≥1.15× every rival) while employing 5+.',
    check: (s) => {
      const p = player(s);
      if (!p || p.employees.length < 5) return false;
      for (const fid in s.firms) {
        const f = s.firms[fid]!;
        if (f.id === p.id || (f.ownerType !== 'ai' && f.ownerType !== 'player')) continue;
        if (p.wagePolicy.baseWage < f.wagePolicy.baseWage * 1.15) return false;
      }
      return true;
    },
  },
  {
    id: 'weathered_storm',
    name: 'Weathered the Storm',
    icon: '⛈️',
    description: 'Came back from the brink — negative cash to solvency.',
    hint: 'Recover to positive cash after a day in the red (see the receivership screen\'s advice).',
    check: (s) => {
      const p = player(s);
      if (!p || p.cash <= 0) return false;
      return p.accounting.dailyHistory.some((d) => d.cash < 0);
    },
  },
  {
    id: 'high_society',
    name: 'High Society',
    icon: '🥂',
    description: 'The town has its first affluent citizen.',
    hint: 'Prosperity takes weeks of steady income, high satisfaction, and savings or fine housing — pay above market and build apartments to hurry it along.',
    check: (s) => Object.values(s.citizens).some((c) => c.tier === 'affluent'),
  },
  {
    id: 'rising_tide',
    name: 'Rising Tide',
    icon: '🌊',
    description: 'Most of the town lives comfortably (or better).',
    hint: 'When comfortable + affluent citizens outnumber workers, your economy is genuinely lifting people — wages, satisfaction, and full shelves all feed the climb.',
    check: (s) => {
      const cits = Object.values(s.citizens);
      if (cits.length < 10) return false;
      const up = cits.filter((c) => c.tier !== 'worker').length;
      return up > cits.length / 2;
    },
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
