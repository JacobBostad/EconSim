/**
 * scenarios.ts — data-driven starting scenarios (town variants).
 *
 * A scenario decides which AI chains exist, where they sit, and how they are
 * stocked/staffed. Every scenario leaves at least one consumer market
 * underserved or contested — that gap is the player's opening. The default
 * 'meadowbrook' reproduces the classic three-chain town.
 */

import type { Vec2 } from '../entities/Location';
import type { ProductId } from '../core/Id';
import type { SizePreset } from '../core/SimulationConfig';
import { dollars } from './constants';
import type { PersonalityId } from './personalities';

export interface AiChainSpec {
  firmName: string;
  /** Consumer product the chain ends in. Any product id — adding a product is
   * a data change (a new chain factory), not a type change here. */
  product: ProductId;
  producerDef: 'farm' | 'mine';
  producerRecipe: string;
  factoryRecipe: string;
  inputProduct: ProductId;
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
  /**
   * World-scale requirement (UX gate only — the sim never reads it). Absent =
   * a classic town that composes at ANY scale (the default Meadowbrook + City IS
   * the pinned City baseline, so a village-authored scenario is viable at City
   * by construction). A scenario tagged 'city' is authored for — and only makes
   * sense at — the world-scale era (crowd + the specialist archetypes), so the
   * New Game picker shows it ONLY when that world scale is chosen and never in
   * the Village flow. It never touches SimulationConfig; worldScaleConfig still
   * owns every flag. See NewGameModal (the picker filter) and grand_junction.
   */
  worldScale?: SizePreset;
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
  grand_junction: {
    id: 'grand_junction',
    name: 'Grand Junction',
    icon: '🌆',
    // The first scenario authored FOR the world-scale era: it only appears when
    // the City world scale is chosen (worldScale gate), so it never lands as a
    // village. Everything that makes it a *City* — the crowd of hundreds, the
    // compute provider humming from day zero, the landlord that breaks ground
    // under the housing squeeze, the holdco that shows up for the yields — comes
    // from the City flags worldScaleConfig turns on, NOT from this data. The
    // scenario only sets the opening posture: two entrenched incumbents and a
    // deliberately tight housing stock.
    worldScale: 'city',
    description:
      'The crowd is already here, the datacenter already hums, and housing is tight enough that a landlord breaks ground within weeks. Two entrenched giants hold bread and tools and a struggling boutique clings to clothes — but the city is far bigger than they can serve, and a quarter to nearly half of the staple demand goes unmet. Build into that hungry market while rent, seats, and stakes already flow.',
    // Grounded in the 300-day unattended City probe (docs/design/probes/grand-junction.ts,
    // seeds 11/4/7): the founder floods to the City cap (16-18 firms) with zero
    // insolvencies, the crowd lands renter-heavy (worker share ~.67-.71), and
    // even a full field leaves the staples ~25-45% unmet — the real, permanent
    // opening a newcomer enters (a scripted operator building into the bread
    // market grows its book +$9-27k over 200 days; the balance run below).
    society:
      'A working city that never sits still — a broad renter class, incumbents entrenched at the top, and a ladder the newcomer climbs by serving the crowd the giants can never fully reach.',
    // Tight on purpose but not brutal: at City scale 16 homes house the cast near
    // capacity from day one, so occupancy sits above the landlord bar and a
    // rentals firm founds early (measured ~day 56) — the "rent already flows" of
    // the pitch — without starving the cast the way a harder squeeze did (probed:
    // 14 homes + a missing staple pushed cast satisfaction and pool drift out of
    // the City norms; 16 homes + all staples supplied holds them inside). The
    // crowd itself lives in cohorts (preset crowdStart), untouched by this number.
    homes: 16,
    aiChains: [
      // A brand-led bakery that has owned the city's bread for years: deep
      // pockets, a full crew, and shelves it keeps stocked. An incumbent to
      // undercut, not a gap to fill.
      breadChain({
        firmName: 'Junction Baking Co',
        producerName: 'Junction Grain Fields',
        factoryName: 'Junction Bakehouse',
        retailName: 'Junction Bread Market',
        cash: dollars(60000),
        adBudget: dollars(28),
        brand: 30,
        stocks: { producerOut: 90, factoryIn: 45, factoryOut: 36, shopIn: 60 },
        staff: { producer: 3, factory: 3, retail: 3 },
        pf: { target: 60, reorder: 24, max: 120 },
        fs: { target: 90, reorder: 36, max: 160 },
        personality: 'brand_builder',
      }),
      // The city's hardware giant — an exporter that ships tools region-wide and
      // still holds the home shelf. Well-capitalized and hard to dislodge.
      toolsChain({
        firmName: 'Ironline Supply Co',
        producerName: 'Ironline Quarry',
        factoryName: 'Ironline Toolworks',
        retailName: 'Ironline Hardware',
        cash: dollars(64000),
        adBudget: dollars(20),
        brand: 26,
        stocks: { producerOut: 75, factoryIn: 36, factoryOut: 18, shopIn: 30 },
        staff: { producer: 3, factory: 3, retail: 2 },
        pf: { target: 45, reorder: 18, max: 90 },
        fs: { target: 60, reorder: 21, max: 120 },
        personality: 'exporter',
      }),
      // A thin, undercapitalized boutique clinging to the clothes trade. Its role
      // is structural: it keeps the third staple nominally supplied so the crowd
      // can spend and the cohort pool doesn't balloon (probed — a missing staple
      // pushed pool drift out of the City norms). It is also a weak incumbent the
      // player can displace, though the fatter opening is the underserved VOLUME
      // in the staples the giants can't fully reach (measured: bread is the
      // stronger entry than clothes, which this boutique keeps adequately fed).
      clothesChain({
        firmName: 'Thimble & Co',
        producerName: 'Thimble Cotton Plot',
        factoryName: 'Thimble Sewing Room',
        retailName: 'Thimble Corner',
        cash: dollars(26000),
        adBudget: dollars(6),
        brand: 10,
        stocks: { producerOut: 24, factoryIn: 12, factoryOut: 6, shopIn: 10 },
        staff: { producer: 1, factory: 1, retail: 1 },
        pf: { target: 20, reorder: 8, max: 40 },
        fs: { target: 24, reorder: 10, max: 50 },
        personality: 'price_fighter',
      }),
    ],
  },
};

export const DEFAULT_SCENARIO_ID = 'meadowbrook';

export function getScenario(id: string): ScenarioDef {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO_ID]!;
}

/**
 * The scenarios the New Game picker offers for a given world scale. Scenarios
 * and world scale are orthogonal choices, but a scenario authored FOR a
 * particular world (worldScale set) is only coherent there, so it is offered
 * only at that scale and a City-only town never surfaces in the Village flow. A
 * classic (untagged) scenario composes at any scale — the default Meadowbrook +
 * City IS the pinned City baseline — so it is always offered. Pure and UX-only:
 * the sim never reads worldScale; worldScaleConfig still owns every flag.
 */
export function scenariosForWorld(world: SizePreset): ScenarioDef[] {
  return Object.values(SCENARIOS).filter((sc) => !sc.worldScale || sc.worldScale === world);
}
