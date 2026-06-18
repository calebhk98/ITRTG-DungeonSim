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
   * Multiplicative Dojo bonus (research §6.1: `DojoMod`).
   * Defaults to 1 (no Dojo bonus).
   */
  dojoMod?: number;
  /**
   * Additive Strategy Room modifier (research §6.1: `StratRoomMod`).
   * Pre-computed at roster level (§6.2a). Defaults to 0.
   */
  strategyRoomMod?: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Derives a fully-resolved `CombatContext` from a pet and its run-slot configuration.
 *
 * Formula order follows research §6.1 exactly:
 *   1. EquipMod = 1 + Σ(statMultiplierBonus) across equipped gear
 *   2. growthFactor = 1 + totalGrowth / growthDivisor
 *   3. Base stats: HP = hpBase + hpPerDL × DL; ADS = adsBase + adsPerDL × DL
 *   4. stat = (base × growthFactor × EquipMod × dojoMod + strategyRoomMod) × ClassMod
 *   5. Defender HP gets the CL>25 ramp (§6.2b)
 *   6. Element levels per §5.3, with gear enchants added additively, then dojoMod applied
 */
export function deriveCombatContext(input: StatDerivationInput): CombatContext {
  const { pet, assignedClass, row, constants } = input;
  const dojoMod = input.dojoMod ?? 1;
  const strategyRoomMod = input.strategyRoomMod ?? 0;

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
  const growthFactor = 1 + pet.totalGrowth / resolve(constants.growthDivisor);

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
  //   stat = (base × growthFactor × EquipMod × dojoMod + strategyRoomMod) × ClassMod
  const innerHp = hpBase * growthFactor * equipMod * dojoMod + strategyRoomMod;
  const innerAds = adsBase * growthFactor * equipMod * dojoMod + strategyRoomMod;

  const hp = innerHp * classModHp;
  const atk = innerAds * classMod.atk;
  const def = innerAds * classMod.def;
  const spd = innerAds * classMod.spd;

  // ── Step 6: Element levels (§5.3) ──────────────────────────────────────────
  // Neutral pets: each element = 0.75 × DL.
  // Non-neutral: primary = 50 + 3 × DL; weakness = -50; others = 0.
  // Then add gear elementEnchant additively.
  // Finally apply dojoMod multiplicatively (for consistency — see comment below).
  let fireLvl = 0;
  let waterLvl = 0;
  let windLvl = 0;
  let earthLvl = 0;

  if (pet.primaryElement === 'Neutral') {
    const neutralLvl = 0.75 * DL;
    fireLvl = neutralLvl;
    waterLvl = neutralLvl;
    windLvl = neutralLvl;
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

  // Add gear elementEnchant additively (research §5.3).
  for (const piece of Object.values(pet.equipment)) {
    if (piece?.elementEnchant !== undefined) {
      const enc = piece.elementEnchant;
      fireLvl  += enc.Fire  ?? 0;
      waterLvl += enc.Water ?? 0;
      windLvl  += enc.Wind  ?? 0;
      earthLvl += enc.Earth ?? 0;
    }
  }

  // Apply dojoMod to element levels multiplicatively.
  // The research doc (§6.1) defines DojoMod as a multiplicative bonus on the
  // stat formula; by analogy we apply it to elements as well so Dojo upgrades
  // uniformly scale both stats and elemental effectiveness.
  // Note: the doc does not explicitly confirm this for elements — mark with TODO
  // if game evidence suggests a different handling.
  fireLvl  *= dojoMod;
  waterLvl *= dojoMod;
  windLvl  *= dojoMod;
  earthLvl *= dojoMod;

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
