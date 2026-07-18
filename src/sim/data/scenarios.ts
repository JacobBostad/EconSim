/**
 * scenarios.ts — data-driven starting scenarios (town variants).
 *
 * A scenario decides which AI chains exist, where they sit, and how they are
 * stocked/staffed. Every scenario leaves at least one consumer market
 * underserved or contested — that gap is the player's opening. The default
 * 'meadowbrook' reproduces the classic three-chain town.
 */

import type { Vec2 } from '../entities/Location';
import { dollars } from './constants';
import type { PersonalityId } from './personalities';

export interface AiChainSpec {
  firmName: string;
  /** Consumer product the chain ends in. */
  product: 'bread' | 'tools' | 'clothes';
  producerDef: 'farm' | 'mine';
  producerRecipe: string;
  factoryRecipe: string;
  inputProduct: string;
  producerName: string;
  factoryName: string;
  retailName: string;
  loc: { producer: Vec2; factory: Vec2; retail: Vec2 };
  cash: number;
  adBudget: number;
  brand: number;
  /** Starting stocks. */
  stocks: { producerOut: number; factoryIn: number; factoryOut: number; shopIn: number };
  /** Staffing per stage. */
  staff: { producer: number; factory: number; retail: number };
  /** Contract params: producer→factory and factory→shop. */
  pf: { target: number; reorder: number; max: number };
  fs: { target: number; reorder: number; max: number };
  /** CEO archetype; defaults to a deterministic rotation when omitted. */
  personality?: PersonalityId;
  /**
   * No producer of its own: the factory buys inputs from the Import Terminal
   * (1.5× markup) — and the AI's local-sourcing logic will switch to any
   * cheaper local supplier, so these chains are born customers.
   */
  importerFed?: boolean;
}

export interface ScenarioDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** The town's social character through the prosperity-tier lens — one
   * line, grounded in 300-day unattended probe measurements. */
  society: string;
  aiChains: AiChainSpec[];
  /**
   * Starting homes (default 20, two citizens each). Fewer homes = a housing
   * crunch: immigration wants in but has nowhere to live until someone —
   * the player or the AI landlord — builds.
   */
  homes?: number;
}

const breadChain = (over: Partial<AiChainSpec> = {}): AiChainSpec => ({
  firmName: 'Sunrise Foods',
  product: 'bread',
  producerDef: 'farm',
  producerRecipe: 'grow_grain',
  factoryRecipe: 'bake_bread',
  inputProduct: 'grain',
  producerName: 'Sunrise Farm',
  factoryName: 'Sunrise Bakery',
  retailName: 'Sunrise Bread Shop',
  loc: { producer: { x: 26, y: 16 }, factory: { x: 48, y: 32 }, retail: { x: 46, y: 48 } },
  cash: dollars(40000),
  adBudget: dollars(20),
  brand: 22,
  stocks: { producerOut: 60, factoryIn: 30, factoryOut: 24, shopIn: 40 },
  staff: { producer: 2, factory: 2, retail: 2 },
  pf: { target: 40, reorder: 15, max: 80 },
  fs: { target: 60, reorder: 24, max: 110 },
  personality: 'brand_builder',
  ...over,
});

const toolsChain = (over: Partial<AiChainSpec> = {}): AiChainSpec => ({
  firmName: 'Granite Industries',
  product: 'tools',
  producerDef: 'mine',
  producerRecipe: 'mine_minerals',
  factoryRecipe: 'make_tools',
  inputProduct: 'minerals',
  producerName: 'Granite Mine',
  factoryName: 'Granite Tool Works',
  retailName: 'Granite Hardware',
  loc: { producer: { x: 104, y: 16 }, factory: { x: 86, y: 32 }, retail: { x: 78, y: 48 } },
  cash: dollars(45000),
  adBudget: dollars(14),
  brand: 22,
  stocks: { producerOut: 50, factoryIn: 24, factoryOut: 12, shopIn: 20 },
  staff: { producer: 2, factory: 2, retail: 1 },
  pf: { target: 30, reorder: 12, max: 60 },
  fs: { target: 40, reorder: 14, max: 80 },
  personality: 'price_fighter',
  ...over,
});

const clothesChain = (over: Partial<AiChainSpec> = {}): AiChainSpec => ({
  firmName: 'Loom & Thread',
  product: 'clothes',
  producerDef: 'farm',
  producerRecipe: 'grow_cotton',
  factoryRecipe: 'sew_clothes',
  inputProduct: 'cotton',
  producerName: 'Loom Cotton Farm',
  factoryName: 'Loom Tailor Works',
  retailName: 'Loom Boutique',
  loc: { producer: { x: 64, y: 14 }, factory: { x: 66, y: 32 }, retail: { x: 62, y: 48 } },
  cash: dollars(38000),
  adBudget: dollars(12),
  brand: 20,
  stocks: { producerOut: 40, factoryIn: 20, factoryOut: 12, shopIn: 18 },
  staff: { producer: 2, factory: 2, retail: 1 },
  pf: { target: 30, reorder: 12, max: 60 },
  fs: { target: 36, reorder: 14, max: 80 },
  personality: 'expansionist',
  ...over,
});

export const SCENARIOS: Record<string, ScenarioDef> = {
  meadowbrook: {
    id: 'meadowbrook',
    name: 'Meadowbrook',
    icon: '🏘️',
    description:
      'The classic town: three AI firms cover bread, tools, and clothes. Compete anywhere.',
    society: 'A balanced town — a broad working class, and a ladder that is yours to build.',
    aiChains: [breadChain(), toolsChain(), clothesChain()],
  },
  gold_rush: {
    id: 'gold_rush',
    name: 'Gold Rush Gulch',
    icon: '⛏️',
    description:
      'A mining boomtown: TWO tool companies wage a price war, one bakery feeds everyone — and nobody sells clothes. That gap is yours.',
    society: 'Mining pay mints affluence — half this town climbs the ladder on its own.',
    aiChains: [
      breadChain({ cash: dollars(32000) }),
      toolsChain(),
      toolsChain({
        firmName: 'Deepvein Mining Co',
        producerName: 'Deepvein Shaft',
        factoryName: 'Deepvein Forge',
        retailName: 'Deepvein Outfitters',
        loc: { producer: { x: 118, y: 22 }, factory: { x: 108, y: 36 }, retail: { x: 96, y: 50 } },
        cash: dollars(40000),
        brand: 16,
        personality: 'exporter',
      }),
    ],
  },
  port_haven: {
    id: 'port_haven',
    name: 'Port Haven',
    icon: '⚓',
    description:
      'A harbor town obsessed with the export trade: the bakery and the forge both ship their best to Port Rosa, leaving home shelves thin — and nobody sells clothes. Feed the town they forgot, or out-sail them.',
    society: 'Export wealth showers the docks — affluence comes easy, and the shops that court it thrive.',
    aiChains: [
      breadChain({
        firmName: 'Harbor Loaf Co',
        producerName: 'Harbor Grain Fields',
        factoryName: 'Harbor Bakehouse',
        retailName: 'Harbor Loaf Shop',
        // Compact, homes-adjacent layout: a scenario whose buildings sit in a
        // far corner starves — commutes eat the whole workday (measured).
        loc: { producer: { x: 28, y: 16 }, factory: { x: 46, y: 32 }, retail: { x: 50, y: 48 } },
        cash: dollars(36000),
        adBudget: dollars(10),
        brand: 14, // the home market is an afterthought
        stocks: { producerOut: 60, factoryIn: 30, factoryOut: 24, shopIn: 30 },
        staff: { producer: 3, factory: 3, retail: 2 },
        personality: 'exporter',
      }),
      toolsChain({
        firmName: 'Quayside Ironworks',
        producerName: 'Quayside Mine',
        factoryName: 'Quayside Forge',
        retailName: 'Quayside Supply',
        loc: { producer: { x: 86, y: 18 }, factory: { x: 76, y: 34 }, retail: { x: 64, y: 48 } },
        adBudget: dollars(10),
        brand: 14,
        stocks: { producerOut: 50, factoryIn: 24, factoryOut: 12, shopIn: 18 },
        staff: { producer: 3, factory: 3, retail: 2 },
        personality: 'exporter',
      }),
    ],
  },
  harvest_valley: {
    id: 'harvest_valley',
    name: 'Harvest Valley',
    icon: '🌾',
    description:
      'Breadbasket country: two bakery empires fight for every crumb, a boutique clothes the town — but no one makes tools. Bring the hardware.',
    society: 'Steady farm towns climb slowly — a solid middle emerges, but real wealth must be grown.',
    aiChains: [
      breadChain(),
      breadChain({
        firmName: 'Golden Grain Co',
        producerName: 'Golden Grain Fields',
        factoryName: 'Golden Grain Bakehouse',
        retailName: 'Golden Grain Bakery',
        loc: { producer: { x: 100, y: 14 }, factory: { x: 92, y: 32 }, retail: { x: 84, y: 48 } },
        cash: dollars(36000),
        brand: 18,
        personality: 'price_fighter',
      }),
      clothesChain(),
    ],
  },
  mill_country: {
    id: 'mill_country',
    name: 'Mill Country',
    icon: '🏭',
    description:
      'A town of mills and no fields: every factory buys its raw goods from the Import Terminal at a stiff markup. Build the farms and mines they lack, undercut the importer, and every mill in town becomes your customer.',
    society: 'A worker town waiting for someone to lift it — import prices eat every paycheck.',
    aiChains: [
      breadChain({
        importerFed: true,
        // No fields — the bakery imports its grain. Extra cash cushions the
        // premium until a local supplier (ideally the player) appears.
        cash: dollars(46000),
        stocks: { producerOut: 0, factoryIn: 40, factoryOut: 24, shopIn: 40 },
        staff: { producer: 0, factory: 2, retail: 2 },
      }),
      toolsChain({
        importerFed: true,
        cash: dollars(46000),
        stocks: { producerOut: 0, factoryIn: 40, factoryOut: 20, shopIn: 30 },
        staff: { producer: 0, factory: 2, retail: 2 },
        personality: 'price_fighter',
      }),
      clothesChain({
        importerFed: true,
        cash: dollars(46000),
        stocks: { producerOut: 0, factoryIn: 40, factoryOut: 20, shopIn: 30 },
        staff: { producer: 0, factory: 2, retail: 2 },
      }),
    ],
  },
  boomtown_flats: {
    id: 'boomtown_flats',
    name: 'Boomtown Flats',
    icon: '🏗️',
    description:
      'Every home is full and the mills are hiring — the boom is here but there is nowhere to live. Immigration stalls until someone builds housing: be the developer, collect the rent, and grow the town that makes you rich. Watch out — rival landlords want the same ground.',
    society: 'Rents crowd out savings — a town of workers until housing lets people breathe.',
    homes: 13,
    aiChains: [
      breadChain({
        cash: dollars(40000),
        staff: { producer: 2, factory: 2, retail: 2 },
      }),
      toolsChain({
        cash: dollars(40000),
        staff: { producer: 2, factory: 2, retail: 2 },
        personality: 'expansionist',
      }),
      clothesChain({
        cash: dollars(40000),
        staff: { producer: 2, factory: 2, retail: 2 },
        personality: 'brand_builder',
      }),
    ],
  },
  dust_hollow: {
    id: 'dust_hollow',
    name: 'Dust Hollow',
    icon: '🏚️',
    description:
      'The company pulled out and took every job with it: no stores, no employers — just boarded-up storefronts and families already packing. Build fast enough to give them a reason to stay.',
    society:
      'A dying town — satisfaction is collapsing and the wagons start loading within weeks. You are the last chance.',
    // 48 citizens, zero AI firms: satisfaction slides below the emigration
    // bar (~day 13) and households leave from ~day 24 until someone builds
    // jobs and shelves. Probed: one bread chain from starting cash stops the
    // bleed inside three weeks; unattended the town drains toward the floor.
    homes: 24,
    aiChains: [],
  },
};

export const DEFAULT_SCENARIO_ID = 'meadowbrook';

export function getScenario(id: string): ScenarioDef {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO_ID]!;
}
