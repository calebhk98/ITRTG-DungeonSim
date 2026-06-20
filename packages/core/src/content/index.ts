/**
 * Content registry barrel.
 *
 * Exports all concrete `Dungeon` and `EnemyArchetype` instances and provides
 * a `getDungeon(id)` helper for the run executor to look up dungeons by id.
 *
 * All six standard dungeons (NewbieGround, Scrapyard, WaterTemple, Volcano,
 * Mountain, Forest) are now built from the data-driven builder in
 * `buildFromData.ts`, which reads `./data/enemies.json` and
 * `./data/dungeon-rosters.json`.
 *
 * The legacy hand-authored `scrapyard.ts` module is retained for its
 * individually-named archetype exports (used by older tests and external code
 * that imports named constants). It is no longer the source of the registered
 * Scrapyard dungeon — `scrapyardDungeon` below now comes from `buildFromData.ts`.
 *
 * To add a new dungeon:
 *   1. Add its depth roster keys to dungeon-rosters.json.
 *   2. Add its enemy stats to enemies.json.
 *   3. Add a `buildDungeon(...)` call in buildFromData.ts.
 *   4. Export it and register it here.
 */

import type { Dungeon } from '../domain/dungeon.js';
import type { DungeonId } from '../domain/dungeon.js';

// ── Data-driven dungeons ───────────────────────────────────────────────────────

export {
  newbieGroundDungeon,
  scrapyardDungeon,
  waterTempleDungeon,
  volcanoDungeon,
  mountainDungeon,
  forestDungeon,
  ALL_DUNGEONS,
  ALL_ARCHETYPES,
  ALL_ARCHETYPES_LIST,
} from './buildFromData.js';

import {
  newbieGroundDungeon,
  scrapyardDungeon,
  waterTempleDungeon,
  volcanoDungeon,
  mountainDungeon,
  forestDungeon,
} from './buildFromData.js';

// ── Legacy scrapyard named exports (kept for backward compatibility) ────────────
//
// The hand-authored scrapyard.ts archetypes are retained so external code that
// imports named constants (chameleonD1, nothingBoss, railgunTrap, etc.) keeps
// working.  They are NOT the source of the registered scrapyard dungeon.

export {
  // All Scrapyard EnemyArchetype instances (hand-authored, placeholder stats)
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

/**
 * Registry of all available dungeons, keyed by `DungeonId`.
 *
 * All six standard dungeons are now registered:
 *   - 'NewbieGround' → newbieGroundDungeon
 *   - 'Scrapyard'    → scrapyardDungeon   (data-driven)
 *   - 'WaterTemple'  → waterTempleDungeon
 *   - 'Volcano'      → volcanoDungeon
 *   - 'Mountain'     → mountainDungeon
 *   - 'Forest'       → forestDungeon
 */
export const DUNGEON_REGISTRY: ReadonlyMap<DungeonId, Dungeon> = new Map<DungeonId, Dungeon>([
  ['NewbieGround', newbieGroundDungeon],
  ['Scrapyard',    scrapyardDungeon],
  ['WaterTemple',  waterTempleDungeon],
  ['Volcano',      volcanoDungeon],
  ['Mountain',     mountainDungeon],
  ['Forest',       forestDungeon],
]);

/**
 * Look up a dungeon by its stable `DungeonId`.
 * Returns `undefined` if the id is not registered (e.g. InfinityTower variants,
 * which are not yet implemented — see buildFromData.ts TODO).
 */
export function getDungeon(id: DungeonId): Dungeon | undefined {
  return DUNGEON_REGISTRY.get(id);
}

// ── Gear item registry ────────────────────────────────────────────────────────

export {
  GEAR_ITEM_REGISTRY,
  lookupGearItem,
  getGearItemFallback,
} from './gearRegistry.js';
export type { GearItemSpec } from './gearRegistry.js';
