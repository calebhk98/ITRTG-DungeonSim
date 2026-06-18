/**
 * Content registry barrel.
 *
 * Exports all concrete `Dungeon` and `EnemyArchetype` instances and provides
 * a `getDungeon(id)` helper for the run executor to look up dungeons by id.
 *
 * To add a new dungeon:
 *   1. Create `packages/core/src/content/<name>.ts` with the Dungeon + archetypes.
 *   2. Export everything from this file.
 *   3. Add the dungeon to the `DUNGEON_REGISTRY` map below.
 */

import type { Dungeon } from '../domain/dungeon.js';
import type { DungeonId } from '../domain/dungeon.js';

export {
  // Scrapyard dungeon object
  scrapyardDungeon,
  // All Scrapyard EnemyArchetype instances
  ALL_SCRAPYARD_ARCHETYPES,
  // Individual archetypes — D1
  metalSlimy,
  angelSlimy,
  ninjaSlimy,
  roboSlimy,
  cyborgSlimy,
  ghostSlimy,
  unstableSlimy,
  chameleonD1,
  // Individual archetypes — D2
  scrapWorm,
  sentry,
  scavenger,
  roboHound,
  microbots,
  bulwarkGolem,
  displacer,
  swordSoldier,
  chameleonD2,
  nothingBoss,
  // Individual archetypes — D3
  constructor_ as scrapyardConstructor,
  compactor,
  replacer,
  slayer,
  arbiter,
  reclaimer,
  repurposer,
  sanitizer,
  chameleonD3,
  // Individual archetypes — D4
  nanobot,
  alienDrone,
  restorationBot,
  cyberBears,
  terraformer,
  shieldGenerator,
  landBattleship,
  obliterator,
  chameleonD4,
  railgunTrap,
} from './scrapyard.js';

// ── Dungeon registry ──────────────────────────────────────────────────────────

import { scrapyardDungeon } from './scrapyard.js';

/**
 * Registry of all available dungeons.  Add new dungeons here as content modules
 * are created (one entry per `DungeonId`).
 *
 * Currently registered:
 *   - 'Scrapyard' → scrapyardDungeon
 */
export const DUNGEON_REGISTRY: ReadonlyMap<DungeonId, Dungeon> = new Map<DungeonId, Dungeon>([
  ['Scrapyard', scrapyardDungeon],
]);

/**
 * Look up a dungeon by its stable `DungeonId`.
 * Returns `undefined` if the id is not registered (e.g. a future dungeon
 * whose content module has not yet been added).
 */
export function getDungeon(id: DungeonId): Dungeon | undefined {
  return DUNGEON_REGISTRY.get(id);
}
