/**
 * WP-B: Stat derivation pipeline.
 *
 * Converts a raw `Pet` record + slot configuration into a fully-resolved
 * `CombatContext` ready for the combat resolver (WP-F).
 *
 * All formula steps follow research §6.1 exactly (in order), with Defender HP
 * ramp from §6.2b and element levels from §5.3.
 */

import { resolve } from '../constants/types.js';
import type { GameConstants } from '../constants/types.js';
import type { CombatContext } from '../domain/combat.js';
import type { ElementLevels } from '../domain/gear.js';
import type { Pet } from '../domain/pet.js';
import type { Row } from '../domain/team.js';
import type { PetClassName } from '../domain/class.js';
import { WEAKNESS_OF } from '../domain/element.js';

// ── GlobalModifiers ───────────────────────────────────────────────────────────

/**
 * A single extensible bag of all global (roster-level / account-level) modifier
 * values that feed into the stat pipeline.  All fields are OPTIONAL; omitting a
 * field (or passing an empty `{}`) reproduces the exact behaviour of the original
 * two-parameter API, so migration is backward-compatible.
 *
 * ## Design intent
 * Callers are responsible for collapsing multiple real-game sources into the
 * appropriate category field before passing `GlobalModifiers` in.  For example,
 * if both the Dojo and a future "Colosseum" building contribute multiplicative
 * bonuses they should be multiplied together by the caller and supplied as a
 * single `statMultiplier` value.  This keeps the pipeline simple and ensures that
 * adding a new source never requires touching `deriveCombatContext`.
 *
 * ## Source → field mapping (from data/modifiers/buildings.json and globals.json)
 *
 * | Real-game source                    | Field                  | How it combines   |
 * |-------------------------------------|------------------------|-------------------|
 * | **Dojo** stat buffs (§6.1 DojoMod)  | `statMultiplier`       | multiply together |
 * | **Strategy Room** main stats        | `statAdditive`         | add together      |
 * | **PGC** growth multiplier           | `growthMultiplier`     | multiply together |
 * | **Magic Egg** growth multiplier     | `growthMultiplier`     | multiply together |
 * | **Dojo** element buffs              | `elementLevelBonus`    | add per-element   |
 * | Neutral-equipment **gems/enchants** | `elementLevelBonus`    | add per-element   |
 * | **Strategy Room** element slots     | `elementLevelMultiplier` | multiply together |
 */
export interface GlobalModifiers {
  /**
   * Multiplicative bonus applied inside the stat formula (research §6.1: `DojoMod`).
   * Product of all multiplicative combat-stat sources.
   *
   * Sources: **Dojo** stat-buff levels → `DojoMod = 1 + (sum_of_buff_levels / 100)`
   *   (buildings.json id="dojo", effectCategory="combat-stat-multiplicative").
   *
   * Default: `1` (identity — no net change).
   */
  statMultiplier?: number;

  /**
   * Additive bonus added inside the stat formula before `ClassMod` is applied
   * (research §6.1: `StratRoomMod`).
   * Sum of all additive combat-stat sources.
   *
   * Sources: **Strategy Room** main-stat slots →
   *   `SRMod = (0.1 + Growth4th/5000) × (1 + Books/0.48)`
   *   (buildings.json id="strategy_room"; globals.json id="strategy-room-stat-bonus").
   *
   * Default: `0` (identity — no net change).
   */
  statAdditive?: number;

  /**
   * Multiplier applied to `pet.totalGrowth` before the `growthFactor` is computed:
   *   `effectiveGrowth = pet.totalGrowth × growthMultiplier`
   *   `growthFactor    = 1 + effectiveGrowth / growthDivisor`
   *
   * Product of all growth-multiplying sources.
   *
   * Sources:
   *   - **PGC** (Patreon Gods Challenge): up to 1.5× (globals.json id="pgc-growth-multiplier")
   *   - **Magic Egg** (Tier-4 weapon): 1.3× per pet (globals.json id="magic-egg-growth-multiplier")
   *   Combined example: `1.5 × 1.3 = 1.95`
   *
   * NOTE: If `pet.totalGrowth` is already stored post-multiplier (i.e. growth was
   * baked in at import time), leave this at `1` to avoid double-counting.
   *
   * Default: `1` (identity — no net change).
   */
  growthMultiplier?: number;

  /**
   * Per-element additive bonus applied to element levels AFTER base + gear enchants,
   * but BEFORE `elementLevelMultiplier`.
   *
   * Sources:
   *   - **Dojo element buffs** (Water/Fire/Wind/Earth): additive level bonuses
   *     (globals.json id="dojo-element-buffs"; buildings.json effectCategory="element-level")
   *   - Neutral-equipment **gems** (globals.json id="equipment-gems-element-stats")
   *   - Neutral-equipment **enchants** beyond gear (globals.json id="enchantment-neutral-element-bonus")
   *
   * Default: `{}` (identity — no net change for any element).
   */
  elementLevelBonus?: Partial<ElementLevels>;

  /**
   * Multiplicative scalar applied to element levels after all additive bonuses have
   * been summed (base + gear + `elementLevelBonus`).
   *
   * Sources:
   *   - **Strategy Room** element slots:
   *     element multiplier ≈ `1 + sqrt(elementLevel)/30 × SRMod`
   *     (buildings.json id="strategy_room"; globals.json id="strategy-room-stat-bonus")
   *
   * Default: `1` (identity — no net change).
   *
   * CHANGE NOTE: In the original implementation `dojoMod` was applied to element
   * levels multiplicatively as a proxy.  The refactor splits this into two orthogonal
   * fields: Dojo contributions go into `elementLevelBonus` (additive per-element
   * level) and Strategy Room contributions go into `elementLevelMultiplier`.  Pass
   * the old `dojoMod` value as `statMultiplier` (for main stats) and separately
   * compute per-element Dojo level bonuses for `elementLevelBonus`.  Code that
   * previously set `dojoMod=1` and `strategyRoomMod=0` can pass `{}` (or omit
   * `globals` entirely) and will get identical results.
   */
  elementLevelMultiplier?: number;
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * All inputs required to derive a pet's `CombatContext` for one dungeon slot.
 *
 * `assignedClass` is taken from the `TeamSlot` rather than `pet.evolvedClass`
 * because players may assign a different class at run time.
 */
export interface StatDerivationInput {
  /** The pet to derive stats for. */
  pet: Pet;
  /**
   * Class assigned for this run slot.
   * May differ from `pet.evolvedClass` (research §team).
   */
  assignedClass: PetClassName;
  /** Row the pet occupies (front/back). Stored on the context for the combat resolver. */
  row: Row;
  /** Authoritative game constants — always pass `DEFAULT_CONSTANTS` in production. */
  constants: GameConstants;
  /**
   * All global/roster-level modifiers that affect this pet's stats.
   * Omitting this field (or passing `{}`) is equivalent to the original
   * `dojoMod = 1, strategyRoomMod = 0` defaults — behaviour is identical.
   *
   * See {@link GlobalModifiers} for the full source → field mapping.
   */
  globals?: GlobalModifiers;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Derives a fully-resolved `CombatContext` from a pet and its run-slot configuration.
 *
 * Formula order follows research §6.1 exactly:
 *   1. EquipMod = 1 + Σ(statMultiplierBonus) across equipped gear
 *   2. effectiveGrowth = totalGrowth × (globals.growthMultiplier ?? 1)
 *      growthFactor = 1 + effectiveGrowth / growthDivisor
 *   3. Base stats: HP = hpBase + hpPerDL × DL; ADS = adsBase + adsPerDL × DL
 *   4. stat = (base × growthFactor × EquipMod × statMultiplier + statAdditive) × ClassMod
 *   5. Defender HP gets the CL>25 ramp (§6.2b)
 *   6. Element levels per §5.3:
 *      a. Base from pet element + gear enchants (additive)
 *      b. Add globals.elementLevelBonus (per-element additive, e.g. Dojo element buffs)
 *      c. Multiply by globals.elementLevelMultiplier (e.g. Strategy Room element slots)
 */
export function deriveCombatContext(input: StatDerivationInput): CombatContext {
  const { pet, assignedClass, row, constants } = input;
  const globals = input.globals ?? {};

  const statMultiplier      = globals.statMultiplier      ?? 1;
  const statAdditive        = globals.statAdditive        ?? 0;
  const growthMultiplier    = globals.growthMultiplier    ?? 1;
  const elementLevelBonus   = globals.elementLevelBonus   ?? {};
  const elementLevelMultiplier = globals.elementLevelMultiplier ?? 1;

  const DL = pet.dungeonLevel;
  const CL = pet.classLevel;

  // ── Step 1: EquipMod ────────────────────────────────────────────────────────
  // Research §6.1: gear pieces stack additively, then the total multiplies base.
  // TODO: per-stat gear bonuses — currently `statMultiplierBonus` is a single
  //       scalar that applies uniformly to all stats. Future refinement will add
  //       per-stat enchant fields (e.g. atkBonus, defBonus) to GearPiece.
  let equipBonusSum = 0;
  for (const piece of Object.values(pet.equipment)) {
    if (piece !== undefined) {
      equipBonusSum += piece.statMultiplierBonus;
    }
  }
  const equipMod = 1 + equipBonusSum;

  // ── Step 2: growthFactor ────────────────────────────────────────────────────
  // Research §5.4 / §6.1: `(1 + TotalGrowth / 200,000)`.
  // globals.growthMultiplier scales totalGrowth before the divisor (PGC, Magic Egg).
  const effectiveGrowth = pet.totalGrowth * growthMultiplier;
  const growthFactor = 1 + effectiveGrowth / resolve(constants.growthDivisor);

  // ── Step 3: Base stats ──────────────────────────────────────────────────────
  // Research §6.1:
  //   HP  base = hpBase(10)  + hpPerDL(24)  × DL
  //   ADS base = adsBase(1)  + adsPerDL(2.4) × DL
  const hpBase =
    resolve(constants.statBases.hpBase) +
    resolve(constants.statBases.hpPerDL) * DL;
  const adsBase =
    resolve(constants.statBases.adsBase) +
    resolve(constants.statBases.adsPerDL) * DL;

  // ── Step 4: Class modifiers ─────────────────────────────────────────────────
  // Research §5.5: look up the assigned class from constants.classMods.
  const classMods = resolve(constants.classMods);
  const classMod = classMods[assignedClass];

  // ── Step 4a: Defender HP ramp (§6.2b) ──────────────────────────────────────
  // ClassMod_HP = 1.20 + max(0, (CL − 25) × 0.01) for Defender.
  // For all other classes, use the table value directly.
  let classModHp: number;
  if (assignedClass === 'Defender') {
    const breakpointCL = resolve(constants.defenderHpScale.breakpointCL);
    const perCLAbove = resolve(constants.defenderHpScale.perCLAbove);
    // Base from table is 1.20; the ramp replaces it entirely for Defenders so
    // we don't stack the table value with the ramp — §6.2b defines the full formula.
    classModHp = 1.2 + Math.max(0, (CL - breakpointCL) * perCLAbove);
  } else {
    classModHp = classMod.hp;
  }

  // ── Step 5: Stat derivation ─────────────────────────────────────────────────
  // Research §6.1 formula (same structure for all four stats):
  //   stat = (base × growthFactor × EquipMod × statMultiplier + statAdditive) × ClassMod
  const innerHp  = hpBase  * growthFactor * equipMod * statMultiplier + statAdditive;
  const innerAds = adsBase * growthFactor * equipMod * statMultiplier + statAdditive;

  const hp  = innerHp  * classModHp;
  const atk = innerAds * classMod.atk;
  const def = innerAds * classMod.def;
  const spd = innerAds * classMod.spd;

  // ── Step 6: Element levels (§5.3) ──────────────────────────────────────────
  // Step 6a: Base element levels from pet type.
  //   Neutral pets: each element = 0.75 × DL.
  //   Non-neutral: primary = 50 + 3 × DL; weakness = -50; others = 0.
  let fireLvl  = 0;
  let waterLvl = 0;
  let windLvl  = 0;
  let earthLvl = 0;

  if (pet.primaryElement === 'Neutral') {
    const neutralLvl = 0.75 * DL;
    fireLvl  = neutralLvl;
    waterLvl = neutralLvl;
    windLvl  = neutralLvl;
    earthLvl = neutralLvl;
  } else {
    // Primary element gets the bonus; weakness element gets the penalty.
    const primaryLvl = 50 + 3 * DL;
    const weaknessElement = WEAKNESS_OF[pet.primaryElement];

    // Set primary
    switch (pet.primaryElement) {
      case 'Fire':  fireLvl  = primaryLvl; break;
      case 'Water': waterLvl = primaryLvl; break;
      case 'Wind':  windLvl  = primaryLvl; break;
      case 'Earth': earthLvl = primaryLvl; break;
    }

    // Set weakness (−50; others remain 0)
    switch (weaknessElement) {
      case 'Fire':  fireLvl  = -50; break;
      case 'Water': waterLvl = -50; break;
      case 'Wind':  windLvl  = -50; break;
      case 'Earth': earthLvl = -50; break;
      // Neutral is not in WEAKNESS_OF; unreachable for non-neutral pets.
    }
  }

  // Step 6b: Add gear elementEnchant additively (research §5.3).
  for (const piece of Object.values(pet.equipment)) {
    if (piece?.elementEnchant !== undefined) {
      const enc = piece.elementEnchant;
      fireLvl  += enc.Fire  ?? 0;
      waterLvl += enc.Water ?? 0;
      windLvl  += enc.Wind  ?? 0;
      earthLvl += enc.Earth ?? 0;
    }
  }

  // Step 6c: Add globals.elementLevelBonus additively.
  // Sources: Dojo element buffs (buildings.json id="dojo-element-buffs"),
  //          neutral-equipment gems/enchants (globals.json id="equipment-gems-element-stats",
  //          id="enchantment-neutral-element-bonus").
  fireLvl  += elementLevelBonus.Fire  ?? 0;
  waterLvl += elementLevelBonus.Water ?? 0;
  windLvl  += elementLevelBonus.Wind  ?? 0;
  earthLvl += elementLevelBonus.Earth ?? 0;

  // Step 6d: Apply globals.elementLevelMultiplier multiplicatively.
  // Sources: Strategy Room element slots (buildings.json id="strategy_room",
  //          globals.json id="strategy-room-stat-bonus" element formula).
  fireLvl  *= elementLevelMultiplier;
  waterLvl *= elementLevelMultiplier;
  windLvl  *= elementLevelMultiplier;
  earthLvl *= elementLevelMultiplier;

  const elementLevels: ElementLevels = {
    Fire:  fireLvl,
    Water: waterLvl,
    Wind:  windLvl,
    Earth: earthLvl,
  };

  // ── Assemble CombatContext ──────────────────────────────────────────────────
  return {
    petId: pet.id,
    stats: { hp, atk, def, spd },
    elementLevels,
    element: pet.primaryElement,
    assignedClass,
    row,
    abilities: pet.abilities,
    currentHp: hp,
  };
}
