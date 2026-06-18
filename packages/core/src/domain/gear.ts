/**
 * The four equipment slots available to each pet.
 * Exact slot names are not explicitly listed in the research doc but are
 * consistent with standard RPG conventions referenced in the wiki.
 */
export type GearSlot = 'weapon' | 'armor' | 'accessory' | 'trinket';

/**
 * A single piece of equipment that can be assigned to a pet.
 *
 * Research §6.1: `EquipMod` is gear multiplier — "gear pieces stack additively,
 * then multiply base". So `statMultiplierBonus` values across all equipped pieces
 * are summed first, then the total is applied as a multiplier.
 *
 * Research §5.3: Equipment enchantments add to element levels.
 */
export interface GearPiece {
  /** Unique identifier for this gear piece (e.g. from in-game export). */
  readonly id: string;
  /** Display name shown in UI. */
  readonly name: string;
  /** Which slot this piece occupies. */
  readonly slot: GearSlot;
  /**
   * Additive contribution to `EquipMod` in the stat formula (research §6.1).
   * Multiple pieces stack additively: total EquipMod = 1 + Σ(statMultiplierBonus).
   */
  readonly statMultiplierBonus: number;
  /**
   * Optional elemental enchantment. Values are ADDED to the pet's computed
   * elemental levels before Dojo/Strategy modifiers apply (research §5.3).
   */
  readonly elementEnchant?: Partial<ElementLevels>;
  /** Gear tier 1–4, matching the dungeon material tiers (research §8.4). */
  readonly tier: 1 | 2 | 3 | 4;
}

/**
 * Elemental levels for Fire/Water/Wind/Earth. Used both on pets (§5.3) and
 * as a type for gear enchantments. Neutral element has no level in the system.
 */
export interface ElementLevels {
  Fire: number;
  Water: number;
  Wind: number;
  Earth: number;
}

/**
 * The full set of gear a single pet is wearing, keyed by slot.
 * A slot may be empty (undefined with exactOptionalPropertyTypes).
 */
export type EquipmentLoadout = {
  [S in GearSlot]?: GearPiece;
};

/**
 * A pool of gear pieces available to allocate across pets. Each piece is
 * assignable to at most one (pet, slot) at a time. Used by the gear-allocation
 * optimizer dimension; candidate assignments reference pieces by `GearPiece.id`.
 */
export type GearInventory = ReadonlyArray<GearPiece>;
