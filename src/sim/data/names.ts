/**
 * names.ts — Name pools for deterministic naming.
 *
 * Names are picked using the seeded Rng, so the same seed always produces the
 * same town. Pools are intentionally small but combine for variety.
 */

export const FIRST_NAMES: readonly string[] = [
  'Ada', 'Ben', 'Cara', 'Dane', 'Elsa', 'Finn', 'Greta', 'Hugo', 'Ivy', 'Jonas',
  'Kira', 'Liam', 'Mira', 'Nils', 'Olga', 'Pavel', 'Quinn', 'Rosa', 'Sven', 'Tess',
  'Uma', 'Vera', 'Wade', 'Xena', 'Yuri', 'Zoe', 'Mara', 'Otto', 'Pia', 'Rolf',
];

export const LAST_NAMES: readonly string[] = [
  'Holt', 'Vance', 'Mercer', 'Cole', 'Frost', 'Hale', 'Pike', 'Reed', 'Stone', 'Voss',
  'Aldon', 'Brandt', 'Crane', 'Dern', 'Ekberg', 'Falk', 'Garin', 'Hoff', 'Ingmar', 'Juhl',
];

export const FIRM_PREFIXES: readonly string[] = [
  'Golden', 'Iron', 'Sunrise', 'Harbor', 'Granite', 'Meadow', 'Summit', 'Quill',
];

export const FIRM_SUFFIXES: readonly string[] = [
  'Foods', 'Industries', 'Goods', 'Supply Co.', 'Mills', 'Trading', 'Works', 'Mart',
];
