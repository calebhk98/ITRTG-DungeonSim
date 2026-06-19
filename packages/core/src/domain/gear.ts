/**
 * The four equipment slots available to each pet.
 */
export type GearSlot = 'weapon' | 'armor' | 'accessory' | 'trinket';

/**
 * Quality grades — 9 steps from F (lowest) to SSS (highest).
 * Each step is ±10% relative to the A baseline (A = 1.00×).
 * Source: itrtg.wiki.gg/wiki/Equip — high confidence.
 */
export type GearQuality = 'F' | 'E' | 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS';

/** Gem types that can be socketed into equipment. */
export type GemType = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Neutral';

/**
 * A single piece of equipment that can be assigned to a pet.
 *
 * ## Stat formula (research §12, source: itrtg.wiki.gg/wiki/Equip)
 *
 * Each item's contribution to a stat is multiplicative:
 *   effectiveStat = baseStatBonus × qualityMult × upgradeMult
 *
 * where:
 *   qualityMult  = GEAR_QUALITY_MULT[quality]         (F=0.50 … SSS=1.30)
 *   upgradeMult  = 1 + upgradeLevel × 0.05            (+5% per upgrade level)
 *   baseStatBonus = the item's inherent stat at quality A, upgrade +0
 *
 * The four EquipMods are then built per-stat:
 *   EquipModHP  = 1 + Σ(baseHpBonus  × qualMult × upgMult) + Σ(gemHpBonus)
 *   EquipModATK = 1 + Σ(baseAtkBonus × qualMult × upgMult) + Σ(gemAtkBonus)
 *   EquipModDEF = 1 + Σ(baseDefBonus × qualMult × upgMult) + Σ(gemDefBonus)
 *   EquipModSPD = 1 + Σ(baseSpdBonus × qualMult × upgMult) + Σ(gemSpdBonus)
 *
 * Neutral gems add to element levels (not stats); stored in `elementEnchant`.
 *
 * Items within the same tier/slot have different distributions — e.g. Fire Sword
 * has high ATK but negative DEF, while Mythril Shield has high DEF but negative ATK.
 * See `content/data/gear-items.json` for the per-item registry.
 */
export interface GearPiece {
  /** Unique identifier for this gear piece (e.g. from in-game export). */
  readonly id: string;
  /** Display name shown in UI. */
  readonly name: string;
  /** Which slot this piece occupies. */
  readonly slot: GearSlot;
  /** Gear tier 1–5 (tier 5 = special items like Ele Twin Dagger). */
  readonly tier: 1 | 2 | 3 | 4 | 5;

  // ── Per-stat base bonuses at quality A, upgrade +0 ─────────────────────────
  // These are the item's inherent stat distribution as fractions (0.20 = +20%).
  // Negative values are allowed (e.g. Fire Sword: baseDefBonus = -0.05).
  readonly baseHpBonus: number;
  readonly baseAtkBonus: number;
  readonly baseDefBonus: number;
  readonly baseSpdBonus: number;

  // ── Quality and upgrade (multiplicative on base stats) ─────────────────────
  readonly quality: GearQuality;
  readonly upgradeLevel: number;

  // ── Gem bonuses (additive on top of base×quality×upgrade) ─────────────────
  /**
   * Water gem: adds this fraction to the HP EquipMod only.
   * Formula: gemLevel × 0.01 × tier
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

  // ── Display / UI fields ────────────────────────────────────────────────────
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

// ── Gear formula helpers ──────────────────────────────────────────────────────

/**
 * Quality multipliers relative to A=1.00×.
 * Each step away from A changes the multiplier by ±0.10.
 * Source: itrtg.wiki.gg/wiki/Equip — high confidence.
 */
export const GEAR_QUALITY_MULT: Readonly<Record<GearQuality, number>> = {
  F:   0.50,
  E:   0.60,
  D:   0.70,
  C:   0.80,
  B:   0.90,
  A:   1.00,
  S:   1.10,
  SS:  1.20,
  SSS: 1.30,
};

/** +5% to upgradeMult per upgrade level. Max observed in-game: +20. */
export const GEAR_UPGRADE_STEP = 0.05;

/**
 * Compute the quality multiplier for a gear piece.
 * Example: SSS → 1.30, A → 1.00, F → 0.50
 */
export function computeGearQualityMult(quality: GearQuality): number {
  return GEAR_QUALITY_MULT[quality];
}

/**
 * Compute the upgrade multiplier for a gear piece.
 * Formula: 1 + upgradeLevel × 0.05
 * Example: +20 → 2.00, +0 → 1.00
 */
export function computeGearUpgradeMult(upgradeLevel: number): number {
  return 1 + upgradeLevel * GEAR_UPGRADE_STEP;
}

/**
 * Compute the combined quality × upgrade multiplier.
 * Use this for display purposes (e.g. "SSS+20 = 2.60×").
 */
export function computeGearCombinedMult(quality: GearQuality, upgradeLevel: number): number {
  return computeGearQualityMult(quality) * computeGearUpgradeMult(upgradeLevel);
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
