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
import { townOf } from '../core/Town';
import { activeWorldEvents } from './worldEvents';
import { seasonOf, seasonOfDay } from './seasons';
import { ticksPerDay } from '../core/Tick';
import { dollars } from './constants';
import { SERVICE_BOOST_MULT } from './services';

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
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  return townOf(state).firms[state.playerFirmId];
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
      const facilities = townOf(s).facilities;
      for (const fid of p.facilities) {
        const t = facilities[fid]?.type;
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
      const facilities = townOf(s).facilities;
      for (const fid of p.facilities) {
        const fac = facilities[fid];
        if (!fac || (fac.wholesalePriceMult ?? 1) > 0.6) continue;
        for (const cid in s.contracts) {
          const c = s.contracts[cid]!;
          if (!c.active || c.sourceFacilityId !== fac.id) continue;
          if (facilities[c.destinationFacilityId]?.ownerFirmId !== p.id) return true;
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
      const facilities = townOf(s).facilities;
      for (const fid of p.facilities) {
        const fac = facilities[fid];
        if (!fac || fac.employees.length < 2) continue;
        const avg = fac.employees.reduce((sum, cid) => sum + (townOf(s).citizens[cid]?.skill ?? 0), 0) / fac.employees.length;
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
    check: (s) => Object.keys(townOf(s).citizens).length >= 60,
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
      const facilities = townOf(s).facilities;
      for (const fid of p.facilities) {
        const f = facilities[fid];
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
      const firms = townOf(s).firms;
      for (const fid in firms) {
        const f = firms[fid]!;
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
    id: 'market_wizard',
    name: 'Market Wizard',
    icon: '📈',
    description: 'Delivered a forward contract locked at a 1.3×+ spike.',
    hint: 'On the warehouse commodity desk, lock a city\'s spiked price as a forward, then buy or produce the goods cheaper and deliver before the deadline.',
    check: (s) => (player(s)?.forwardWins ?? 0) >= 1,
  },
  {
    id: 'high_society',
    name: 'High Society',
    icon: '🥂',
    description: 'The town has its first affluent citizen.',
    hint: 'Prosperity takes weeks of steady income, high satisfaction, and savings or fine housing — pay above market and build apartments to hurry it along.',
    check: (s) => Object.values(townOf(s).citizens).some((c) => c.tier === 'affluent'),
  },
  {
    id: 'rising_tide',
    name: 'Rising Tide',
    icon: '🌊',
    description: 'Most of the town lives comfortably (or better).',
    hint: 'When comfortable + affluent citizens outnumber workers, your economy is genuinely lifting people — wages, satisfaction, and full shelves all feed the climb.',
    check: (s) => {
      const cits = Object.values(townOf(s).citizens);
      if (cits.length < 10) return false;
      const up = cits.filter((c) => c.tier !== 'worker').length;
      return up > cits.length / 2;
    },
  },
  {
    id: 'stopped_the_bleed',
    name: 'Stopped the Bleed',
    icon: '⛑️',
    description: 'Families were leaving town — and you turned it around.',
    hint: 'When emigration starts, the fix is jobs and full shelves: build supply for the town, employ people, and hold satisfaction until nobody wants to leave anymore.',
    check: (s) => {
      if (s.emigrationDepartures < 1 || s.emigrationPressure !== 0) return false;
      const cits = Object.values(townOf(s).citizens);
      if (cits.length === 0) return false;
      const avg = cits.reduce((a, c) => a + c.satisfaction, 0) / cits.length;
      return avg >= 50;
    },
  },
  // --- World-scale era (City/Metropolis specialist channels) ---------------
  // Each check gates on its channel's config flag FIRST and returns false when
  // it's off (Village always). The underlying state — a landlord lease, a
  // compute boost, a demand pool — never exists in a Village game anyway, but
  // the explicit gate makes the inertness structural, not incidental: these
  // achievements can never fire in a Village run, so its serialized achievement
  // list stays byte-identical. Same discipline as town_lifted's scenario gate.
  {
    id: 'first_lease',
    name: 'Keys, Not Deeds',
    icon: '🔑',
    description: 'Opened a premises on a lease instead of buying it.',
    hint: 'Place a facility and lease it from a landlord (City-scale, real estate on).',
    check: (s) => {
      if (!s.config.realEstateEnabled) return false;
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => townOf(s).facilities[fid]?.landlordFirmId !== undefined);
    },
  },
  {
    id: 'full_compute',
    name: 'Fully Plugged In',
    icon: '🔌',
    description: 'Ran on full compute coverage — every facility a few percent faster.',
    hint: 'Subscribe to enough datacenter seats to cover your whole firm (City-scale, services on).',
    check: (s) => {
      if (!s.config.servicesEnabled) return false;
      // Full coverage stamps serviceBoost at exactly the boost multiplier; a
      // partial subscription lands proportionally under it. Epsilon guards the
      // float compare.
      return (player(s)?.serviceBoost ?? 1) >= SERVICE_BOOST_MULT - 1e-9;
    },
  },
  {
    id: 'closed_forward',
    name: 'Closed at the Mark',
    icon: '🎯',
    description: 'Closed a forward early at the mark — the exit is the skill, whatever the P&L.',
    hint: 'On the commodity desk, close an open forward before delivery (City-scale).',
    check: (s) => {
      if (s.config.sizePreset === 'village') return false;
      return s.forwardsClosed >= 1;
    },
  },
  {
    id: 'three_stakes',
    name: 'Portfolio',
    icon: '📊',
    description: 'Held stakes in three different rivals at once.',
    hint: 'Buy and hold equity in three separate firms (City-scale).',
    check: (s) => {
      if (s.config.sizePreset === 'village') return false;
      const p = player(s);
      if (!p) return false;
      return Object.values(p.sharesHeld).filter((v) => v > 0).length >= 3;
    },
  },
  {
    id: 'landlord_repossession',
    name: 'Called the Loan',
    icon: '🏚️',
    description: 'Repossessed a leased premises when its tenant went under.',
    hint: 'Lease a premises out as landlord and recover it when the tenant folds (City-scale, real estate on).',
    check: (s) => {
      if (!s.config.realEstateEnabled) return false;
      return s.landlordRepossessions >= 1;
    },
  },
  {
    id: 'pool_restored',
    name: 'Filled the Larder',
    icon: '🧭',
    description: 'Shipped a thin port back up to its target cover.',
    hint: 'Export into a port whose larder has run below its buffer until its cover is restored (City-scale, trade pools on).',
    check: (s) => {
      if (!s.config.tradeDemandPoolsEnabled) return false;
      return s.poolCoversRestored >= 1;
    },
  },
  {
    id: 'town_lifted',
    name: 'Lifted the Town',
    icon: '🌅',
    description: 'Brought a comfortable majority to Mill Country — the worker town that waited.',
    hint: 'Mill Country stays a worker town on its own: import prices eat every paycheck. Build local farms and mines, cut the cost of living, and raise wages until most citizens climb out of the worker tier.',
    check: (s) => {
      if (s.scenarioId !== 'mill_country') return false;
      const cits = Object.values(townOf(s).citizens);
      if (cits.length < 10) return false;
      const up = cits.filter((c) => c.tier !== 'worker').length;
      return up > cits.length / 2;
    },
  },
  // --- Region era (City new-game default) ----------------------------------
  // The region opens a FREIGHT edge to a second live economy, the partner port
  // Port Rosa (region.md step 4). Both checks gate on `regionEnabled` FIRST and
  // return false when it's off (Village always, Metropolis too): the freight
  // record never exists without a live partner, but the explicit gate makes the
  // inertness structural, not incidental — these can never fire in a Village run,
  // so its serialized achievement list stays byte-identical. Same discipline as
  // the world-scale era gates above.
  {
    id: 'port_rosa_run',
    name: 'Port Rosa Run',
    icon: '⚓',
    description: 'Landed your first freight in Port Rosa, the partner port.',
    hint: 'Freight a staple from your warehouse to Port Rosa and let it arrive (region on).',
    check: (s) => {
      if (!s.config.regionEnabled) return false;
      return ((player(s)?.exportRevenueByCity ?? {})['port_rosa'] ?? 0) > 0;
    },
  },
  {
    id: 'shock_trader',
    name: 'Rode the Spike',
    icon: '🌩️',
    description: 'Settled a Port Rosa freight locked at a 1.3× price spike.',
    hint: "Freight when Port Rosa's quote has spiked, so the price you lock lands at 1.3× base or more (region on).",
    check: (s) => {
      if (!s.config.regionEnabled) return false;
      return s.freightBestSpikePct >= 130;
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
