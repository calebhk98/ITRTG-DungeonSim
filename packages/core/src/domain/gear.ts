/**
 * The four equipment slots available to each pet.
 * Exact slot names are not explicitly listed in the research doc but are
 * consistent with standard RPG conventions referenced in the wiki.
 */
export type GearSlot = 'weapon' | 'armor' | 'accessory' | 'trinket';

/** Quality grades as they appear in the in-game export (low → high). */
export type GearQuality = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS';

/** Gem types that can be socketed into equipment. */
export type GemType = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Neutral';

/**
 * A single piece of equipment that can be assigned to a pet.
 *
 * Research §6.1: `EquipMod` is gear multiplier — "gear pieces stack additively,
 * then multiply base". So `statMultiplierBonus` values across all equipped pieces
 * are summed first, then the total is applied as a multiplier to each stat.
 *
 * Gem bonuses are stat-specific and additive on top of the base EquipMod:
 *   EquipModHP  = 1 + Σ(statMultiplierBonus) + Σ(gemHpBonus)
 *   EquipModATK = 1 + Σ(statMultiplierBonus) + Σ(gemAtkBonus)
 *   EquipModDEF = 1 + Σ(statMultiplierBonus) + Σ(gemDefBonus)
 *   EquipModSPD = 1 + Σ(statMultiplierBonus) + Σ(gemSpdBonus)
 *
 * Neutral gems add to element levels (not stats); stored in `elementEnchant`.
 */
export interface GearPiece {
  /** Unique identifier for this gear piece (e.g. from in-game export). */
  readonly id: string;
  /** Display name shown in UI. */
  readonly name: string;
  /** Which slot this piece occupies. */
  readonly slot: GearSlot;
  /**
   * Uniform additive contribution to all four EquipMod values (quality + upgrades).
   * Formula: qualityBase + upgradeLevel × 0.05.
   */
  readonly statMultiplierBonus: number;
  /**
   * Water gem: adds this fraction to the HP EquipMod only.
   * Formula: gemLevel × 0.01 × tier  (e.g. lv15 tier4 → 0.60)
   */
  readonly gemHpBonus?: number;
  /**
   * Fire gem: adds this fraction to the ATK EquipMod only.
   * Formula: gemLevel × 0.01 × tier
   */
  readonly gemAtkBonus?: number;
  /**
   * Earth gem: adds this fraction to the DEF EquipMod only.
   * Formula: gemLevel × 0.01 × tier
   */
  readonly gemDefBonus?: number;
  /**
   * Wind gem: adds this fraction to the SPD EquipMod only.
   * Formula: gemLevel × 0.01 × tier
   */
  readonly gemSpdBonus?: number;
  /**
   * Neutral gem: values are ADDED to the pet's element levels for combat.
   * Formula per element: gemLevel × tier  (integer, not percentage).
   * Also used for off-element gear penalties (negative values).
   */
  readonly elementEnchant?: Partial<ElementLevels>;
  /** Gear tier 1–4, matching the dungeon material tiers (research §8.4). */
  readonly tier: 1 | 2 | 3 | 4;
  /** Upgrade level from the in-game export ("+N" suffix). Used for display and gear-swap UI. */
  readonly upgradeLevel?: number;
  /** Quality grade from the in-game export. Used for display and gear-swap UI. */
  readonly quality?: GearQuality;
  /** Gem type socketed into this piece. Used for display and gear-swap UI. */
  readonly gemType?: GemType;
  /** Gem level socketed into this piece. Used for display and gear-swap UI. */
  readonly gemLevel?: number;
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

/**
 * Compute a stat-specific gem bonus.
 * Colored gems (Fire/Water/Wind/Earth): gemLevel × 0.01 × tier
 * Neutral gem: returns 0 (Neutral gem adds to element levels, not stats).
 */
export function computeGemStatBonus(gemType: GemType, gemLevel: number, tier: number): number {
  if (gemType === 'Neutral') return 0;
  return gemLevel * 0.01 * tier;
}
