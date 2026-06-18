import type { Element } from './element.js';
import type { EnemyArchetype } from './enemy.js';

/**
 * Depth tier of a dungeon, 1–4 (research §3, §7.1).
 * Depth 4 requires all NRDCs; boss rooms 6/16/30/60 map to depths 1–4.
 */
export type Depth = 1 | 2 | 3 | 4;

/**
 * Within-depth difficulty slider, 0–10 (research §3, §7.1).
 * Each +1 adds +10% additive to boss multipliers.
 */
export type Difficulty = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * The standard named dungeons plus the Infinity Tower variant per element.
 * Research §2: Newbie Ground, Scrapyard (Neutral), Water Temple, Volcano, Mountain, Forest.
 * Research §2: Infinity Tower unlocks when top-50 pets exceed 3,000 total DL.
 *
 * Template literal `InfinityTower:${Element}` covers all five tower variants
 * (Neutral/Fire/Water/Wind/Earth) without enumerating them separately.
 */
export type DungeonId =
  | 'NewbieGround'
  | 'Scrapyard'
  | 'WaterTemple'
  | 'Volcano'
  | 'Mountain'
  | 'Forest'
  | `InfinityTower:${Element}`;

/**
 * A room-enemy table entry: one enemy type that may appear in a room, together
 * with the weight (relative probability) and the count range for how many of
 * that enemy may spawn.
 *
 * Research §XP-NOTE: the number and type of enemies in a room is partially random,
 * so XP accrues per-enemy-killed rather than per room. This table is the input
 * to the (future) room-rolling logic in WP-H.
 */
export interface RoomEnemyEntry {
  /** References `EnemyArchetype.id`. */
  readonly enemyId: string;
  /**
   * Relative weight for the weighted random draw when populating a room.
   * Higher weight = more likely to appear.
   */
  readonly weight: number;
  /** Minimum number of this enemy that spawn if selected. */
  readonly minCount: number;
  /** Maximum number of this enemy that spawn if selected. */
  readonly maxCount: number;
}

/**
 * Describes the pool of enemies that can appear in a dungeon's normal rooms.
 * A room is populated by drawing from this table (WP-H implements the draw logic).
 * Boss rooms use fixed archetypes and are NOT drawn from this table.
 *
 * Research XP-NOTE: enemy types and counts are partially random per room.
 */
export interface RoomEnemyTable {
  /**
   * Number of enemy-type draws per room (e.g. 1 = pick one archetype then roll count).
   * Exact mechanics are game-version dependent; this field captures the intent.
   */
  readonly drawsPerRoom: number;
  /** Weighted pool of possible enemies for this dungeon/depth/difficulty. */
  readonly entries: ReadonlyArray<RoomEnemyEntry>;
}

/**
 * A dungeon that pets can be sent to run.
 * Research §2: each dungeon has a fixed element; enemies are drawn from the table.
 *
 * Boss rooms (6/16/30/60) are modelled separately via fixed `EnemyArchetype` ids;
 * the enemy table covers non-boss rooms only.
 */
export interface Dungeon {
  /** Stable identifier. */
  readonly id: DungeonId;
  /**
   * Primary element of this dungeon. Determines enemy elements and the element
   * required for Depth-4 second-event bonuses (research §3).
   */
  readonly element: Element;
  /**
   * Weighted table of enemy archetypes that can appear in normal rooms.
   * Keyed by depth (1–4) because enemy pools differ across depths.
   * The combat resolver uses the matching entry for the chosen depth.
   */
  readonly enemyTable: Readonly<Partial<Record<Depth, RoomEnemyTable>>>;
  /**
   * Fixed boss archetype id for each depth that has a boss.
   * Keys: 1 (room 6), 2 (room 16), 3 (room 30), 4 (room 60).
   */
  readonly bossArchetypeId: Readonly<Partial<Record<Depth, string>>>;
  /**
   * Flat lookup map of every `EnemyArchetype` that can appear in this dungeon,
   * keyed by `EnemyArchetype.id`.
   *
   * Every `enemyId` in `enemyTable` entries and every value in `bossArchetypeId`
   * must resolve here.  The run executor uses exclusively this map — it never
   * scans `enemyTable` for embedded archetype objects.
   */
  readonly archetypes: Readonly<Record<string, EnemyArchetype>>;
}
