/**
 * Element union and the elemental weakness cycle used throughout combat.
 * See research §5.3 — "Weakness cycle: Water > Fire > Wind > Earth > Water".
 * Neutral is used by generic pets and the Scrapyard dungeon.
 */
export type Element = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Neutral';

/**
 * Maps each element to the element it is *weak against* (i.e. takes extra damage from).
 * Neutral has no weakness.
 *
 * Research §5.3: Water > Fire > Wind > Earth > Water.
 *   - Fire is weak to Water
 *   - Water is weak to Wind   (Water loses to Wind)
 *   - Wind is weak to Earth
 *   - Earth is weak to Fire   (completes the cycle)
 */
export const WEAKNESS_OF: Readonly<Record<Exclude<Element, 'Neutral'>, Element>> = {
  Fire: 'Water',
  Water: 'Wind',
  Wind: 'Earth',
  Earth: 'Fire',
} as const;
