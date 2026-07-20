/**
 * Firm.ts — Firm entity.
 *
 * Firms own facilities, employ citizens, set prices and wages, and keep books.
 * `ownerType` distinguishes the player firm, AI competitors, the external
 * importer, and the special "world" firm that owns homes and acts as the sink
 * for external costs (maintenance, utilities) so total money is conserved.
 */

import type { FirmId, FacilityId, CitizenId, ProductId } from '../core/Id';
import type { Accounting } from './Accounting';

export type FirmOwnerType = 'player' | 'ai' | 'external' | 'world';

export type BankruptcyStatus = 'healthy' | 'distressed' | 'insolvent';

export interface WagePolicy {
  /** Default wage in cents paid per payday, per employee. */
  baseWage: number;
}

/** Lightweight AI strategy memory used by AIStrategySystem. */
export interface FirmStrategy {
  /** The chain's anchor product id, or 'none'/'retail' for the non-product
   * roles. A `ProductId` (open string) so a new product needs no type edit —
   * this classifier is set at founding and not branched on by product. */
  kind: ProductId | 'none' | 'retail';
  /** Per-product count of consecutive days the firm sold out (drives price up). */
  selloutStreak: Record<ProductId, number>;
  /** Per-product count of consecutive days of excess inventory (drives price down). */
  gluttStreak: Record<ProductId, number>;
  /** Consecutive days of negative operating profit. */
  lossStreak: number;
  /** The wage this firm started with — the floor its wage drifts back to. */
  startingWage?: number;
}

export function emptyStrategy(kind: FirmStrategy['kind']): FirmStrategy {
  return { kind, selloutStreak: {}, gluttStreak: {}, lossStreak: 0 };
}

export interface Firm {
  id: FirmId;
  name: string;
  ownerType: FirmOwnerType;
  cash: number; // cents
  facilities: FacilityId[];
  employees: CitizenId[];
  /** Retail price in cents per product this firm sets. */
  pricesByProduct: Record<ProductId, number>;
  wagePolicy: WagePolicy;
  accounting: Accounting;
  strategy: FirmStrategy;
  bankruptcyStatus: BankruptcyStatus;
  /** Consecutive days cash has been below zero. */
  daysInsolvent: number;
  marketShareByProduct: Record<ProductId, number>;
  createdAtTick: number;
  /** AI personality archetype id (see data/personalities). Null for the player. */
  personalityId: string | null;
  /** Flavor: the CEO's name shown in dashboards. Null for the player. */
  ceoName: string | null;

  // --- Strategic levers (the three Capitalism-Lab axes) ----------------
  /** Brand strength per product (0..100). Raised by advertising, decays. */
  brandByProduct: Record<ProductId, number>;
  /** Daily advertising budget (cents) per product. */
  adBudgetByProduct: Record<ProductId, number>;
  /** Quality (0..100) of the goods this firm produces, raised by R&D. */
  qualityByProduct: Record<ProductId, number>;
  /** Outstanding loan principal in cents. */
  debt: number;
  /** Daily interest rate on debt (e.g. 0.0008 ≈ ~30%/yr). */
  interestRatePerDay: number;
  /** Equity stakes in other firms: targetFirmId -> percent (0..49). */
  sharesHeld: Record<FirmId, number>;
  /** Cumulative cash paid for each stake (cents), released pro-rata on
   * sales — sells report realized gain/loss against this. */
  shareCostBasis: Record<FirmId, number>;
  /** Names of firms this firm has fully acquired (M&A history). */
  acquiredNames: string[];
  /** Products whose retail price the daily auto-pricer manages (player QoL). */
  autoPriceByProduct: Record<ProductId, boolean>;
  /** Lifetime revenue earned from trade-city exports (cents). */
  exportRevenue: number;
  /** Lifetime export revenue broken down by trade city id (cents). */
  exportRevenueByCity: Record<string, number>;
  /** Lifetime spend on wholesale purchases from other local firms (cents). */
  wholesaleSpend: number;
  /** Lifetime revenue earned selling wholesale to other local firms (cents). */
  wholesaleEarned: number;
  /** Hired managers running slices of this firm's operations (delegation —
   * see docs/design/managers.md). */
  managers: Manager[];
  /** Open forward contracts (commodity desk shorting — see
   * docs/design/commodity-market.md). */
  forwards: ForwardContract[];
  /** Lifetime forward deliveries locked at ≥1.3× base (achievement). */
  forwardWins: number;

  // --- B2B services (HD3; city-scale only, all optional/undefined in Village) --
  /**
   * This firm's listed price per service id (cents/seat/day) when it runs a
   * datacenter — walked daily by utilization (ServiceBillingSystem). Undefined
   * until the firm becomes a provider; Village firms never set it. */
  servicePriceByService?: Record<string, number>;
  /**
   * Firm-wide production multiplier from full service coverage this day
   * (SERVICE_BOOST_MULT when covered, 1 otherwise). Set daily by
   * ServiceBillingSystem; read by ProductionSystem. Undefined ⇒ no boost. */
  serviceBoost?: number;
  /** Consecutive days an AI subscriber's boost value has failed to cover its
   * seat bill — the cancel hysteresis counter. Undefined ⇒ 0. */
  serviceFailingDays?: number;
}

/** A promise to deliver goods to a trade city by a deadline at a price
 * locked when the contract was signed — shorting with a delivery truck. */
export interface ForwardContract {
  id: string;
  productId: ProductId;
  quantity: number;
  cityId: string;
  /** Gross city price per unit locked at signing (cents); settlement pays
   * this minus that day's freight. */
  lockedPrice: number;
  deliveryDay: number;
}

/** What a hired manager runs: one store, or a firm-wide function. */
export type ManagerRole = 'store' | 'logistics' | 'sales';

/** A named, salaried professional who runs one slice of a firm's ops.
 * Not a citizen — an off-map hire paid daily out of the firm's cash. */
export interface Manager {
  id: string;
  name: string;
  /** 'store' runs one retail store; 'logistics' sizes contracts and sources
   * wholesale firm-wide; 'sales' works the ports (rush orders, standing
   * exports). One store manager per store; one of each firm-wide role. */
  role: ManagerRole;
  /** 0.9–1.3 — sets which duties they cover and the salary they command. */
  skill: number;
  salaryPerDay: number;
  /** The store a 'store' manager runs; null for firm-wide roles. */
  facilityId: FacilityId | null;
  hiredAtTick: number;
}
