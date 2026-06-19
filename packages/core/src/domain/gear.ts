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
/** Quality grades as they appear in the in-game export (low → high). */
export type GearQuality = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS';

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
   * Negative values reduce element levels (from off-element gear penalties).
   */
  readonly elementEnchant?: Partial<ElementLevels>;
  /** Gear tier 1–4, matching the dungeon material tiers (research §8.4). */
  readonly tier: 1 | 2 | 3 | 4;
  /** Upgrade level from the in-game export ("+N" suffix). Used for display and gear-swap UI. */
  readonly upgradeLevel?: number;
  /** Quality grade from the in-game export. Used for display and gear-swap UI. */
  readonly quality?: GearQuality;
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

// ── Gear multiplier formula ────────────────────────────────────────────────────

/**
 * Community-estimated quality base values for `statMultiplierBonus`.
 * Scale: A=50% baseline, ±10% per tier. Source: ITRTG wiki; confidence: medium.
 * (Pet dungeon vs adventure-mode gear distinction is uncertain; reliable for
 * relative comparisons between gear options.)
 */
export const GEAR_QUALITY_BASE: Readonly<Record<GearQuality, number>> = {
  D: 0.20,
  C: 0.30,
  B: 0.40,
  A: 0.50,
  S: 0.60,
  SS: 0.70,
  SSS: 0.80,
};

/** +5% stat multiplier per upgrade level. */
export const GEAR_UPGRADE_STEP = 0.05;

/**
 * Compute `statMultiplierBonus` from quality and upgrade level.
 * Formula: max(0, qualityBase + upgradeLevel × 0.05)
 */
export function computeGearMultiplier(quality: GearQuality, upgradeLevel: number): number {
  return Math.max(0, GEAR_QUALITY_BASE[quality] + upgradeLevel * GEAR_UPGRADE_STEP);
}
