import type { PetId } from './ids.js';
import type { PetClassName } from './class.js';

/**
 * The two rows of a dungeon team (research §3).
 * Front row: attacked more often, gains +20% Speed (feeds SpeedDamage bonus).
 * Back row: deals 80% damage unless the assigned class ignores the penalty.
 */
export type Row = 'front' | 'back';

/**
 * One slot in a dungeon team. Links a pet to its row position and chosen class.
 *
 * `assignedClass` may differ from `Pet.evolvedClass`: players can assign any
 * class to any pet (subject to in-game unlock rules), so both are tracked.
 * If null, the pet fights without class bonuses (pre-evolution).
 */
export interface TeamSlot {
  /** The pet occupying this slot. */
  readonly petId: PetId;
  /** Which row the pet is placed in (research §3). */
  readonly row: Row;
  /**
   * Class assigned for this run. Null means no class / pre-evolution pet.
   * The combat resolver reads `ClassModifiers` from `GameConstants.classMods`
   * using this value.
   */
  readonly assignedClass: PetClassName | null;
}

/**
 * A dungeon team: up to 6 pets arranged across front and back rows (max 3 per row).
 * Research §3: "Assemble a team of up to 6 pets in two rows of 3."
 *
 * Invariant (enforced at runtime, not in the type): `slots.length <= 6`,
 * at most 3 slots with `row === 'front'`, at most 3 with `row === 'back'`.
 */
export interface Team {
  readonly slots: ReadonlyArray<TeamSlot>;
}
