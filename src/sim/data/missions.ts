/**
 * missions.ts — Guided mission chain (data-driven tutorial with rewards).
 *
 * Missions form an ordered chain: only the first incomplete mission is active,
 * and completing it pays a cash reward from the world account (money stays
 * conserved). Checks are pure predicates over GameState, evaluated hourly by
 * MissionSystem. Completions are stored in `state.missions` as {id, day}.
 *
 * The chain teaches the full gameplay loop: build → hire → produce → sell →
 * wire supply → profit → win market share → grow valuation.
 */

import type { GameState } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';
import { townOf } from '../core/Town';
import { dollars } from './constants';

export interface MissionDef {
  id: string;
  name: string;
  icon: string;
  /** What to do, phrased as an instruction. */
  description: string;
  /** Reward in cents, paid on completion. */
  reward: number;
  check: (state: GameState) => boolean;
  /**
   * Optional eligibility gate. A mission is only offered in a game where its
   * systems EXIST: `activeMission` skips a def whose `eligible` returns false, so
   * it never becomes the active mission and never completes there. World-scale
   * era missions gate on their channel's config flag, which is OFF at Village
   * preset — so the Village chain is byte-identical (state.missions never gains
   * an era id) and the era arc only surfaces in a City/Metropolis game. A def
   * with no `eligible` is offered everywhere (the classic chain). See the
   * scenario-gated achievements (town_lifted / mill_country) for the sibling
   * idiom on the achievement side.
   */
  eligible?: (state: GameState) => boolean;
}

function player(state: GameState) {
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  return townOf(state).firms[state.playerFirmId];
}

export const MISSION_DEFS: MissionDef[] = [
  {
    id: 'build_first',
    name: 'Break Ground',
    icon: '🏗️',
    description: 'Build your first facility — pick one in the Build panel, then click an empty spot on the map.',
    reward: dollars(500),
    check: (s) => (player(s)?.facilities.length ?? 0) >= 1,
  },
  {
    id: 'hire_two',
    name: 'Staff Up',
    icon: '🤝',
    description: 'Hire 2 workers. Click a facility you own, then use Hire in the inspector.',
    reward: dollars(500),
    check: (s) => (player(s)?.employees.length ?? 0) >= 2,
  },
  {
    id: 'produce',
    name: 'Production Line',
    icon: '⚙️',
    description: 'Produce goods: select a recipe at a farm, mine, or factory and let your workers finish a batch today.',
    reward: dollars(750),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => (townOf(s).facilities[fid]?.dailyStats.unitsProduced ?? 0) > 0);
    },
  },
  {
    id: 'open_shop',
    name: 'Open a Shop',
    icon: '🏪',
    description: 'Open a staffed retail store and choose which product it sells.',
    reward: dollars(750),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => {
        const f = townOf(s).facilities[fid];
        return f?.type === 'retail' && f.retailProductIds.length > 0 && f.employees.length >= 1;
      });
    },
  },
  {
    id: 'wire_supply',
    name: 'Wire the Supply Line',
    icon: '🚚',
    description: 'Create a supply contract feeding a store you own (from your factory or the importer).',
    reward: dollars(1000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      const mine = new Set(p.facilities);
      return Object.values(s.contracts).some(
        (c) => c.active && mine.has(c.destinationFacilityId),
      );
    },
  },
  {
    id: 'first_hundred',
    name: 'Ring the Register',
    icon: '💵',
    description: 'Earn $100 of lifetime revenue from customers.',
    reward: dollars(1000),
    check: (s) => (player(s)?.accounting.lifetime.revenue ?? 0) >= dollars(100),
  },
  {
    id: 'profitable_day',
    name: 'A Day in the Black',
    icon: '📗',
    description: 'Close a full day with positive net profit (watch wages, maintenance, and interest).',
    reward: dollars(1500),
    check: (s) => {
      const hist = player(s)?.accounting.dailyHistory;
      return !!hist && hist.length > 0 && hist[hist.length - 1]!.netProfit > 0;
    },
  },
  {
    id: 'share_ten',
    name: 'Carve a Niche',
    icon: '📈',
    description: 'Win 10% market share in any product (undercut, out-advertise, or out-quality the AI).',
    reward: dollars(2000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return Object.values(p.marketShareByProduct).some((v) => v >= 0.1);
    },
  },
  {
    id: 'share_thirty',
    name: 'Serious Competitor',
    icon: '🥊',
    description: 'Win 30% market share in any product.',
    reward: dollars(3000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return Object.values(p.marketShareByProduct).some((v) => v >= 0.3);
    },
  },
  {
    // Before the export arc: buying wholesale needs nothing but a store and
    // a rival with surplus, so it comes as soon as the shop is established.
    id: 'local_sourcing',
    name: 'Local Sourcing',
    icon: '🤝',
    description: 'Spend $200 buying wholesale from another firm: create a supply contract whose source is a rival\'s facility (marked "wholesale" in the picker) — you pay their asking price (~70% of market by default), cheaper than importing.',
    reward: dollars(1500),
    check: (s) => (player(s)?.wholesaleSpend ?? 0) >= dollars(200),
  },
  {
    id: 'first_export',
    name: 'Open the Trade Route',
    icon: '🚢',
    description: 'Export goods: build a warehouse, stage goods there via a contract, and hit Export in its inspector — it ships to the best-paying port.',
    reward: dollars(2500),
    check: (s) => (player(s)?.exportRevenue ?? 0) > 0,
  },
  {
    id: 'best_port_broker',
    name: 'Best-Port Broker',
    icon: '🚂',
    description: 'Earn $500 of export revenue from Ironvale, the industrial hub — it pays a premium for tools, minerals and finery (see the Gazette\'s Trade Desk for today\'s spreads).',
    reward: dollars(2000),
    check: (s) => ((player(s)?.exportRevenueByCity ?? {})['ironvale'] ?? 0) >= dollars(500),
  },
  {
    id: 'wage_leader',
    name: 'Wage Leader',
    icon: '🤝',
    description: 'Pay the town\'s best wage — set your base wage above every rival\'s (Wages card in your firm inspector) while employing at least one worker.',
    reward: dollars(1500),
    check: (s) => {
      const p = player(s);
      if (!p || p.employees.length === 0) return false;
      const firms = townOf(s).firms;
      for (const fid in firms) {
        const f = firms[fid]!;
        if (f.id === p.id || (f.ownerType !== 'ai' && f.ownerType !== 'player')) continue;
        if (f.wagePolicy.baseWage >= p.wagePolicy.baseWage) return false;
      }
      return true;
    },
  },
  {
    id: 'morning_rush',
    name: 'Morning Rush',
    icon: '☕',
    description: 'Serve the town coffee: carry it in one of your stores and make a sale (roast it yourself or buy from the importer).',
    reward: dollars(1500),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      const carries = p.facilities.some((fid) => townOf(s).facilities[fid]?.retailProductIds.includes('coffee'));
      return carries && (townOf(s).marketStats['coffee']?.unitsSoldByFirm[p.id] ?? 0) > 0;
    },
  },
  {
    id: 'landlord',
    name: 'Landlord',
    icon: '🏢',
    description: 'Build an Apartment and house a resident — rent collects daily, and new arrivals need somewhere to live.',
    reward: dollars(2000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => {
        const f = townOf(s).facilities[fid];
        return f?.defId === 'apartment' && f.residentIds.length >= 1;
      });
    },
  },
  {
    id: 'play_the_news',
    name: 'Play the News',
    icon: '📯',
    description: 'Trade the market both ways: buy goods FROM a city twice on the warehouse commodity desk (watch the ticker for 📯 announced price moves — buy before the surge, sell into it).',
    reward: dollars(1500),
    check: (s) => s.deskTrades >= 2,
  },
  {
    id: 'valuation_30k',
    name: 'On the Map',
    icon: '🏢',
    description: 'Grow your company valuation to $30,000 — the objective is in sight.',
    reward: dollars(5000),
    check: (s) => companyValuation(s, s.playerFirmId).valuation >= dollars(30000),
  },

  // --- World-scale era (City/Metropolis only) ------------------------------
  // These teach the specialist channels a full City world switches on: leasing
  // premises, B2B compute, rival stakes, and the trade-city demand pools. Each
  // gates on its channel's config flag (OFF at Village preset), so activeMission
  // skips them in a Village game and the classic chain stays byte-identical.
  {
    id: 'lease_premises',
    name: "Lease, Don't Buy",
    icon: '🔑',
    description:
      'Open a premises without the build bill: when you place a facility, pick a landlord to LEASE from (the Build panel offers it once a property firm is in town) — the landlord fronts the capital and you pay daily rent instead.',
    reward: dollars(3000),
    eligible: (s) => s.config.realEstateEnabled,
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => townOf(s).facilities[fid]?.landlordFirmId !== undefined);
    },
  },
  {
    id: 'subscribe_compute',
    name: 'Plug In',
    icon: '🔌',
    description:
      "Subscribe your firm to a datacenter's compute (the Company dashboard lists providers and their per-seat price) — full coverage runs every producing facility of yours a few percent faster.",
    reward: dollars(3000),
    eligible: (s) => s.config.servicesEnabled,
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return Object.values(s.serviceContracts).some(
        (c) => c.subscriberFirmId === p.id && c.serviceId === 'compute',
      );
    },
  },
  {
    id: 'buy_stake',
    name: 'Own a Piece',
    icon: '📜',
    description:
      "Buy a stake in a rival (the Company dashboard's holdings tab) — a healthy firm pays you dividends on your share of its profit, an income stream you never have to staff.",
    reward: dollars(4000),
    eligible: (s) => s.config.sizePreset !== 'village',
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return Object.values(p.sharesHeld).some((v) => v > 0);
    },
  },
  {
    id: 'read_ports',
    name: 'Read the Ports',
    icon: '🧭',
    description:
      "Ship into a hungry port: the Trade Desk flags a port whose larder has run thin (🔥 low cover) and pays a premium for it — export a staple there from your warehouse while its cover is below the thin bar.",
    reward: dollars(3000),
    eligible: (s) => s.config.tradeDemandPoolsEnabled,
    check: (s) => s.poolFeedsWhileThin >= 1,
  },
  {
    id: 'four_streams',
    name: 'Four Streams',
    icon: '🏙️',
    description:
      'Run a full world-scale firm: hold all four income streams at once — a selling retail store, a rent stream (a premises you lease OR one you lease OUT as landlord), a dividend stake in a rival, and a live compute boost.',
    reward: dollars(8000),
    eligible: (s) => s.config.servicesEnabled && s.config.realEstateEnabled,
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      const facilities = townOf(s).facilities;
      const retail = p.facilities.some((fid) => {
        const f = facilities[fid];
        return f?.type === 'retail' && f.retailProductIds.length > 0;
      });
      const rent =
        p.facilities.some((fid) => facilities[fid]?.landlordFirmId !== undefined) ||
        Object.values(facilities).some((f) => f.landlordFirmId === p.id);
      const dividends = Object.values(p.sharesHeld).some((v) => v > 0);
      const boost = (p.serviceBoost ?? 1) > 1;
      return retail && rent && dividends && boost;
    },
  },

  // --- Region era (City new-game default) ----------------------------------
  // The region wires a SECOND live economy — the partner port, Port Rosa — that
  // home trades with across a FREIGHT edge with a lead time (region.md step 4).
  // These teach that loop: ship the lane, read its price, then live on it. Each
  // gates on `regionEnabled` (OFF at Village and Metropolis presets), so the
  // Village chain stays byte-identical (state.missions never gains a region id)
  // and the arc only surfaces in a City region game. Same gating idiom as the
  // world-scale era missions above. The switcher itself is UI state invisible to
  // the sim, so the lane is taught through the sim-observable freight signals
  // (delivered revenue by city; the settled locked-price read) instead.
  {
    id: 'freight_to_port_rosa',
    name: 'Open the Freight Lane',
    icon: '🚢',
    description:
      "Ship to the partner port: build a warehouse, stage a staple, and hit Freight to Port Rosa in its inspector — the goods leave now and pay on arrival a few days later, at the price you lock today.",
    reward: dollars(3000),
    eligible: (s) => s.config.regionEnabled,
    check: (s) => ((player(s)?.exportRevenueByCity ?? {})['port_rosa'] ?? 0) > 0,
  },
  {
    id: 'read_the_market',
    name: 'Read the Market',
    icon: '🧭',
    description:
      "Trade the spread: Port Rosa's quote drifts on its own supply — freight a staple there when its price sits ABOVE base (the Gazette's Trade Desk shows today's quote), so the price you lock beats what the good is worth at home.",
    reward: dollars(3500),
    eligible: (s) => s.config.regionEnabled,
    check: (s) => s.freightBestSpikePct > 100,
  },
  {
    id: 'freight_lane_established',
    name: 'Establish the Lane',
    icon: '⚓',
    description:
      'Make the port a habit: earn $1,000 of freight revenue delivered to Port Rosa — a second demand pool your warehouse feeds while the home town buys the rest.',
    reward: dollars(4000),
    eligible: (s) => s.config.regionEnabled,
    check: (s) => ((player(s)?.exportRevenueByCity ?? {})['port_rosa'] ?? 0) >= dollars(1000),
  },
];

const DEF_BY_ID: Record<string, MissionDef> = Object.fromEntries(
  MISSION_DEFS.map((d) => [d.id, d]),
);

export function getMissionDef(id: string): MissionDef | undefined {
  return DEF_BY_ID[id];
}

/** Missions offered in THIS game — the classic chain plus any era missions
 * whose channel is switched on. Village drops every eligible-gated era mission,
 * so its chain is exactly the classic list. */
export function eligibleMissions(state: GameState): MissionDef[] {
  return MISSION_DEFS.filter((d) => !d.eligible || d.eligible(state));
}

/** The first incomplete, ELIGIBLE mission in the chain, or null when all the
 * game's offered missions are done. An ineligible def (an era mission in a
 * Village game) is skipped, never surfaced, and never checked — so it can never
 * complete and perturb Village's serialized mission list. */
export function activeMission(state: GameState): MissionDef | null {
  const done = new Set(state.missions.map((m) => m.id));
  for (const def of MISSION_DEFS) {
    if (done.has(def.id)) continue;
    if (def.eligible && !def.eligible(state)) continue;
    return def;
  }
  return null;
}
