/**
 * Pet class names available after evolution. See research §5.5.
 * Class is assigned at run-time via `TeamSlot.assignedClass`; a pet's `evolvedClass`
 * records which class it unlocked at evolution (or null if not yet evolved).
 */
export type PetClassName =
  | 'Adventurer'
  | 'Mage'
  | 'Assassin'
  | 'Rogue'
  | 'Defender'
  | 'Supporter'
  | 'Blacksmith'
  | 'Alchemist';

/**
 * Per-class stat multipliers applied after the base stat formula (research §6.1).
 * All values are fractions of 1.0 (e.g. 1.5 = 150%). The `ClassMod` in the
 * formula `= ClassModifiers.hp` for HP, `.atk` for Attack, etc.
 *
 * `ignoresBackRowPenalty`: when true, the 0.80× position modifier (research §6.2
 * Step 5) is NOT applied — currently only Mage (and Sniper, treated as Mage in
 * this sim because no separate class exists yet).
 */
export interface ClassModifiers {
  /** HP class multiplier (research §5.5). */
  hp: number;
  /** Attack class multiplier. */
  atk: number;
  /** Defense class multiplier. */
  def: number;
  /** Speed class multiplier. */
  spd: number;
  /**
   * If true this class is exempt from the back-row 0.80× damage penalty.
   * Research §3: "except Mages and Snipers".
   */
  ignoresBackRowPenalty: boolean;
}
