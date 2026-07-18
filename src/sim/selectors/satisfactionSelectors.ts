/**
 * satisfactionSelectors — the anatomy of town happiness.
 *
 * Satisfaction gates immigration, which is the growth ceiling — so this
 * decomposes the equilibrium target citizens drift toward into its terms,
 * using the exact same math as SatisfactionSystem (shared pressureOf), and
 * ranks which products' shortages drag the town most.
 */

import type { GameState } from '../core/GameState';
import { pressureOf } from '../systems/SatisfactionSystem';
import { getProduct } from '../data/products';
import { clamp } from '../../utils/clamp';
import { APARTMENT_SATISFACTION_BONUS } from '../data/constants';

export interface ProductDrag {
  productId: string;
  name: string;
  /** Equilibrium points this product's unmet pressure costs (pre-floor). */
  points: number;
}

export interface SatisfactionAnatomy {
  average: number;
  equilibrium: number;
  base: number; // always 50
  employmentTerm: number;
  housingTerm: number;
  provisioningTerm: number;
  productDrag: ProductDrag[];
}

export function satisfactionAnatomy(state: GameState): SatisfactionAnatomy {
  const citizens = Object.values(state.citizens);
  if (citizens.length === 0) {
    return { average: 0, equilibrium: 0, base: 50, employmentTerm: 0, housingTerm: 0, provisioningTerm: 0, productDrag: [] };
  }

  let satisfaction = 0;
  let employment = 0;
  let housing = 0;
  let provisioning = 0;
  let equilibrium = 0;
  const dragByProduct: Record<string, number> = {};

  for (const cit of citizens) {
    satisfaction += cit.satisfaction;
    const emp = cit.employmentStatus === 'employed' ? 20 : -5;
    employment += emp;
    const house = state.facilities[cit.homeFacilityId]?.defId === 'apartment' ? APARTMENT_SATISFACTION_BONUS : 0;
    housing += house;
    let pressure = 0;
    for (const need of cit.needs) {
      const p = pressureOf(state, state.config, need);
      pressure += p;
      if (p > 0) dragByProduct[need.productId] = (dragByProduct[need.productId] ?? 0) + p * 12;
    }
    const prov = clamp(15 - pressure * 12, -30, 15);
    provisioning += prov;
    equilibrium += clamp(50 + emp + house + prov, 0, 100);
  }

  const n = citizens.length;
  const productDrag: ProductDrag[] = Object.entries(dragByProduct)
    .map(([pid, total]) => ({ productId: pid, name: getProduct(pid).name, points: total / n }))
    .sort((a, b) => b.points - a.points);

  return {
    average: satisfaction / n,
    equilibrium: equilibrium / n,
    base: 50,
    employmentTerm: employment / n,
    housingTerm: housing / n,
    provisioningTerm: provisioning / n,
    productDrag,
  };
}
