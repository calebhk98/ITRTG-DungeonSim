/**
 * Element union and the elemental weakness cycle used throughout combat.
 * Confirmed from ITRTG wiki: Fire weak to Water, Water weak to Earth,
 * Earth weak to Wind, Wind weak to Fire.
 * Neutral is used by generic pets and the Scrapyard dungeon.
 */
export type Element = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Neutral';

/**
 * Maps each element to the element it is *weak against* (i.e. takes extra damage from).
 * Neutral has no weakness.
 *
 * Confirmed from wiki: Fire→Water→Earth→Wind→Fire (each is weak to the previous).
 *   - Fire  is weak to Water
 *   - Water is weak to Earth
 *   - Earth is weak to Wind
 *   - Wind  is weak to Fire
 */
export const WEAKNESS_OF: Readonly<Record<Exclude<Element, 'Neutral'>, Element>> = {
  Fire:  'Water',
  Water: 'Earth',
  Earth: 'Wind',
  Wind:  'Fire',
} as const;
