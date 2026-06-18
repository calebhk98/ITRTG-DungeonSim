import type { Element } from './element.js';
import type { CombatStats } from './combat.js';
import type { ElementLevels } from './gear.js';

/**
 * Discriminated union describing how an enemy's stats scale with game variables.
 * Research §7 shows that different enemies use fundamentally different scaling
 * functions, so a uniform formula would be wrong.
 *
 * Resolved by WP-G (enemy archetype database) and consumed by WP-H (run executor).
 */
export type ScalingSpec =
  | {
      /** Linear additive scaling per difficulty level (research §7.2, Cosmic Gnome). */
      readonly kind: 'linear';
      /** Stat delta added for each +1 difficulty. May omit stats that don't scale. */
      readonly perDiff: Partial<CombatStats>;
    }
  | {
      /**
       * Exponential scaling per difficulty level (research §7.2, Ancient Mimic:
       * `Stat(d) = base × 1.4^d`).
       */
      readonly kind: 'expDiff';
      /** Base of the exponent per difficulty step (e.g. 1.4 for Ancient Mimic). */
      readonly factor: number;
    }
  | {
      /**
       * Square-root exponential per difficulty (research §7.2, Scrapyard Railgun:
       * `dmg(d) = base × (√2)^d`).
       */
      readonly kind: 'expSqrtDiff';
    }
  | {
      /**
       * Infinity Tower floor-based additive scaling with per-50-floor doubling
       * (research §7.4): `Stat(f) = base × (1 + increment × f)` where increment
       * doubles every 50 floors.
       */
      readonly kind: 'towerFloor';
    }
  | {
      /**
       * Boss multiplier applied to standard enemy stats at difficulty 0, with
       * +10% per difficulty step additive on top (research §7.1).
       * `effectiveMult = base × (1 + 0.10 × difficulty)`.
       */
      readonly kind: 'bossMult';
      /** Base multiplier at Difficulty 0 (research §7.1: depth1=2, depth2=12, depth3=70). */
      readonly base: number;
    };

/**
 * A special mechanic that an enemy can bring to combat. Kept minimal and extensible
 * so WP-G can enumerate known specials without a type-breaking expansion.
 *
 * Known examples from research §7.2:
 *   - frozenAura (Ancient Mimic): deals 20% of its Atk as bonus frost damage.
 *   - railgun (Scrapyard trap): unblockable exponential damage.
 *   - poison: periodic HP drain (exact formula unconfirmed).
 */
export type EnemySpecial =
  | { readonly kind: 'frozenAura'; readonly attackFraction: number }
  | { readonly kind: 'railgun'; readonly baseDamage: number }
  | { readonly kind: 'poison'; readonly damagePerRound: number }
  | { readonly kind: string; readonly [key: string]: unknown }; // open catch-all

/**
 * A template describing a class of enemies in the dungeon.
 * Instantiated at run time by the room-population logic (WP-H) using the
 * `RoomEnemyTable` in `Dungeon.enemyTable`.
 *
 * Research XP-NOTE: `xpValue` is granted **per enemy killed**; the number of
 * enemies per room is partially random, so total room XP is stochastic.
 * See research §6.4 for the DL/CL experience curves that consume this XP.
 */
export interface EnemyArchetype {
  /**
   * Stable string identifier (e.g. 'ancient-mimic', 'cosmic-gnome', 'railgun-trap').
   * Referenced by `RoomEnemyEntry.enemyId` and `Dungeon.bossArchetypeId`.
   */
  readonly id: string;
  /**
   * Base stats at Difficulty 0 (before `ScalingSpec` is applied).
   * Research §7.4 gives exact Infinity Tower base stats; standard dungeon bases
   * are community-estimated (confidence 'community' | 'estimated').
   */
  readonly baseStats: CombatStats;
  /** Element of this enemy — determines elemental factor in the damage formula (research §6.2). */
  readonly element: Element;
  /**
   * Elemental levels for this enemy — used in the damage formula when present.
   *
   * When set (e.g. from the data-driven enemy table), `scaleEnemyToContext` uses
   * these literal values instead of estimating them from `effectiveLevel`.
   * Each value is a signed integer: positive = strength, negative = weakness.
   *
   * Optional because legacy hand-authored archetypes do not carry element levels;
   * those fall back to the formula-estimated values in `scaleEnemyToContext`.
   */
  readonly elementLevels?: ElementLevels;
  /**
   * How this enemy's stats scale with difficulty or tower floor.
   * Discriminated union because no single formula covers all enemies (research §7).
   */
  readonly scaling: ScalingSpec;
  /** True if this archetype is a depth boss (appears in boss rooms 6/16/30/60). */
  readonly isBoss: boolean;
  /**
   * Optional special mechanics this enemy possesses. Empty / absent = no specials.
   * Research §7.2: Ancient Mimic has Frozen Aura; Scrapyard has Railgun.
   */
  readonly specials?: ReadonlyArray<EnemySpecial>;
  /**
   * XP granted to each pet in the team when this enemy is killed.
   * Research §6.4: DL XP is per-enemy-killed, not per-room flat.
   * The DL curve: n < 10 → 10×(n-1)²; n ≥ 10 → 10×(n-1)^2.25.
   */
  readonly xpValue: number;
}
