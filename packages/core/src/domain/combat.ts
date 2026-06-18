import type { PetId } from './ids.js';
import type { Element } from './element.js';
import type { PetClassName } from './class.js';
import type { Row } from './team.js';
import type { AbilityFlag } from './pet.js';
import type { ElementLevels } from './gear.js';

/**
 * The four core dungeon combat statistics (research §5.2).
 * Derived from the stat formulas in research §6.1 before class modifiers are applied.
 */
export interface CombatStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

/**
 * The fully-resolved, simulation-ready snapshot of one combatant for a single room.
 * The combat resolver (WP-F) consumes this — it never re-derives stats from Pet fields
 * mid-fight, ensuring the stat pipeline (WP-B) is the single source of truth.
 *
 * Produced by `sim/stats.ts` from `Pet + TeamSlot + GameConstants + DojoMod + SRMod`.
 * Research §6.1–§6.3.
 */
export interface CombatContext {
  /**
   * Reference back to the originating pet for bookkeeping in `RunResult`.
   * May be undefined for enemy combatants.
   */
  readonly petId?: PetId;
  /**
   * Arbitrary identifier for enemy combatants (EnemyArchetype.id).
   * Undefined for pet combatants.
   */
  readonly enemyId?: string;

  /** Fully-derived stats AFTER all modifiers (DL, growth, equip, dojo, strat, class). */
  readonly stats: CombatStats;

  /**
   * Element levels for all four elements, computed per research §5.3.
   * Neutral pets: each element = 0.75 × DL.
   * Non-neutral: primary = 50 + 3 × DL; weakness = -50; others = 0.
   * Gear enchants and Dojo/Strategy multipliers are baked in at this stage.
   */
  readonly elementLevels: ElementLevels;

  /** Native element — used for elemental factor calculation in research §6.2 Step 2. */
  readonly element: Element;

  /**
   * The class used in this run slot (may be null for pre-evolution pets or enemies).
   * The combat resolver uses this to look up ignoresBackRowPenalty.
   */
  readonly assignedClass: PetClassName | null;

  /** Row determines the back-row damage penalty (research §6.2 Step 5, §3). */
  readonly row: Row;

  /**
   * Active ability flags for this combatant. The combat resolver checks these
   * to apply modifiers (e.g. supporterDmgReduction, luckyCoin) per research §5.6.
   */
  readonly abilities: ReadonlyArray<AbilityFlag>;

  /**
   * Current HP during combat. Starts equal to `stats.hp`; decremented by damage.
   * Tracked here so the combat resolver can mutate a working copy.
   */
  currentHp: number;
}
