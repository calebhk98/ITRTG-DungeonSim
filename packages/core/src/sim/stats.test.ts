/**
 * Golden tests for the WP-B stat derivation pipeline (sim/stats.ts).
 *
 * Each test encodes a hand-computed expected value so regressions in the
 * formula order or constant look-up immediately show up as a test failure.
 */

import { describe, it, expect } from 'vitest';
import { deriveCombatContext } from './stats.js';
import type { StatDerivationInput } from './stats.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import type { Pet } from '../domain/pet.js';
import { asPetId } from '../domain/ids.js';

// ── Minimal pet factory ───────────────────────────────────────────────────────

/**
 * Build a minimal Pet with sensible defaults; override individual fields via
 * the second argument. This keeps test bodies terse without sacrificing clarity.
 */
function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: asPetId('test-pet'),
    displayName: 'Test Pet',
    primaryElement: 'Neutral',
    dungeonLevel: 1,
    classLevel: 1,
    evolvedClass: null,
    totalGrowth: 0,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'test', importerVersion: 0 },
    ...overrides,
  };
}

// ── Test 1: DL34 Assassin Defense ≈ 95.2 ─────────────────────────────────────
//
// Hand derivation:
//   adsBase = 1 + 2.4 × 34 = 82.6
//   growthFactor = 1 + 59337 / 200000 = 1.296685
//   equipMod = 1 + 0.27 = 1.27
//   statMultiplier = 1, statAdditive = 0   (globals omitted → identity)
//   inner = 82.6 × 1.296685 × 1.27 × 1 + 0
//         = 82.6 × 1.646749...
//         ≈ 136.022
//   def = 136.022 × 0.70 (Assassin def classMod) ≈ 95.22

describe('DL34 Assassin Defense golden test', () => {
  it('computes defense ≈ 95.2 (±0.5)', () => {
    const pet = makePet({
      dungeonLevel: 34,
      totalGrowth: 59_337,
      equipment: {
        weapon: {
          id: 'w1',
          name: 'Test Weapon',
          slot: 'weapon',
          statMultiplierBonus: 0.27,
          tier: 1,
        },
      },
    });

    const input: StatDerivationInput = {
      pet,
      assignedClass: 'Assassin',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      // globals omitted → statMultiplier=1, statAdditive=0 (identity)
    };

    const ctx = deriveCombatContext(input);
    expect(ctx.stats.def).toBeCloseTo(95.22, 0); // ±0.5 tolerance
  });
});

// ── Test 2: HP formula sanity ─────────────────────────────────────────────────
//
// Hand derivation (DL=10, growth=0, no gear, Adventurer, no globals):
//   hpBase = 10 + 24 × 10 = 250
//   growthFactor = 1 + 0 / 200000 = 1.0
//   equipMod = 1.0, statMultiplier = 1.0, statAdditive = 0
//   classMod_hp (Adventurer) = 1.0
//   hp = 250 × 1.0 × 1.0 × 1.0 × 1.0 = 250.0

describe('HP formula sanity (DL=10, no growth, Adventurer)', () => {
  it('computes HP = 250 exactly', () => {
    const pet = makePet({ dungeonLevel: 10, totalGrowth: 0 });

    const input: StatDerivationInput = {
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    };

    const ctx = deriveCombatContext(input);
    expect(ctx.stats.hp).toBeCloseTo(250, 6);
  });

  it('HP scales correctly with growth (DL=10, growth=200000 → ×2)', () => {
    // growthFactor = 1 + 200000/200000 = 2.0 → hp = 250 × 2.0 = 500
    const pet = makePet({ dungeonLevel: 10, totalGrowth: 200_000 });

    const input: StatDerivationInput = {
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    };

    const ctx = deriveCombatContext(input);
    expect(ctx.stats.hp).toBeCloseTo(500, 6);
  });
});

// ── Test 3: Element levels ────────────────────────────────────────────────────
//
// Research §5.3:
//   Neutral at DL=100 → all four elements = 0.75 × 100 = 75
//   Fire   at DL=100 → Fire=50+300=350, Water(weakness)=−50, Wind=0, Earth=0

describe('Element levels', () => {
  it('Neutral pet at DL=100 → all elements = 75', () => {
    const pet = makePet({ primaryElement: 'Neutral', dungeonLevel: 100 });

    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    expect(ctx.elementLevels.Fire).toBeCloseTo(75, 6);
    expect(ctx.elementLevels.Water).toBeCloseTo(75, 6);
    expect(ctx.elementLevels.Wind).toBeCloseTo(75, 6);
    expect(ctx.elementLevels.Earth).toBeCloseTo(75, 6);
  });

  it('Fire pet at DL=100 → Fire=350, Water=−50, Wind=0, Earth=0', () => {
    const pet = makePet({ primaryElement: 'Fire', dungeonLevel: 100 });

    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    expect(ctx.elementLevels.Fire).toBeCloseTo(350, 6);
    expect(ctx.elementLevels.Water).toBeCloseTo(-50, 6); // weakness of Fire
    expect(ctx.elementLevels.Wind).toBeCloseTo(0, 6);
    expect(ctx.elementLevels.Earth).toBeCloseTo(0, 6);
  });
});

// ── Test 4: Defender HP CL ramp (§6.2b) ──────────────────────────────────────
//
// Hand derivation (DL=10, growth=0, no gear, Defender):
//   hpBase = 10 + 24 × 10 = 250
//   CL=55: classModHp = 1.2 + max(0, (55−25) × 0.01) = 1.2 + 0.30 = 1.50 → hp = 375
//   CL=10: classModHp = 1.2 + max(0, (10−25) × 0.01) = 1.2 + 0     = 1.20 → hp = 300

describe('Defender HP CL ramp (§6.2b)', () => {
  const basePet = makePet({ dungeonLevel: 10, totalGrowth: 0 });

  it('Defender at CL=10 → classModHp = 1.20 → HP = 300', () => {
    const pet = { ...basePet, classLevel: 10 };
    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Defender',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });
    expect(ctx.stats.hp).toBeCloseTo(300, 6);
  });

  it('Defender at CL=55 → classModHp = 1.50 → HP = 375', () => {
    const pet = { ...basePet, classLevel: 55 };
    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Defender',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });
    expect(ctx.stats.hp).toBeCloseTo(375, 6);
  });

  it('Defender HP scales correctly with CL above breakpoint', () => {
    // At CL=25 (exactly at breakpoint): no ramp yet → 1.20
    const petAt25 = { ...basePet, classLevel: 25 };
    const ctxAt25 = deriveCombatContext({
      pet: petAt25,
      assignedClass: 'Defender',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });
    expect(ctxAt25.stats.hp).toBeCloseTo(300, 6); // 250 × 1.20

    // At CL=125: 1.2 + (125-25) × 0.01 = 1.2 + 1.0 = 2.2 → 250 × 2.2 = 550
    const petAt125 = { ...basePet, classLevel: 125 };
    const ctxAt125 = deriveCombatContext({
      pet: petAt125,
      assignedClass: 'Defender',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });
    expect(ctxAt125.stats.hp).toBeCloseTo(550, 6);
  });
});

// ── Test 5: Determinism ───────────────────────────────────────────────────────
//
// Same input must always produce identical output (no internal randomness).
// Uses the new `globals` field; values chosen to match the old dojoMod=1.1,
// strategyRoomMod=5 pair so the determinism invariant is preserved.

describe('Determinism', () => {
  it('identical inputs → identical output', () => {
    const pet = makePet({
      primaryElement: 'Earth',
      dungeonLevel: 47,
      classLevel: 33,
      totalGrowth: 123_456,
      equipment: {
        armor: {
          id: 'a1',
          name: 'Test Armor',
          slot: 'armor',
          statMultiplierBonus: 0.15,
          tier: 2,
          elementEnchant: { Earth: 20 },
        },
      },
      abilities: ['luckyCoin'],
    });

    const input: StatDerivationInput = {
      pet,
      assignedClass: 'Rogue',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
      globals: {
        statMultiplier: 1.1,
        statAdditive: 5,
      },
    };

    const ctx1 = deriveCombatContext(input);
    const ctx2 = deriveCombatContext(input);

    expect(ctx1.stats).toEqual(ctx2.stats);
    expect(ctx1.elementLevels).toEqual(ctx2.elementLevels);
    expect(ctx1.currentHp).toBe(ctx2.currentHp);
    expect(ctx1.assignedClass).toBe(ctx2.assignedClass);
    expect(ctx1.row).toBe(ctx2.row);
    expect(ctx1.element).toBe(ctx2.element);
  });
});

// ── Test 6: GlobalModifiers — statMultiplier ──────────────────────────────────
//
// statMultiplier=2 should double the multiplicative part of the inner stat value
// (everything inside the formula before ClassMod, excluding the additive term).
//
// Setup: DL=10, growth=0, no gear, Adventurer (classMod all 1.0)
//   baseline: hpBase=250, growthFactor=1.0, equipMod=1.0
//   baseline inner = 250 × 1.0 × 1.0 × 1   + 0 = 250  → hp = 250
//   doubled  inner = 250 × 1.0 × 1.0 × 2   + 0 = 500  → hp = 500

describe('GlobalModifiers — statMultiplier', () => {
  it('statMultiplier=2 doubles the multiplicative part of the stat formula', () => {
    const pet = makePet({ dungeonLevel: 10, totalGrowth: 0 });

    const base = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    const doubled = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { statMultiplier: 2 },
    });

    // With no additive term, doubling statMultiplier doubles the stat.
    expect(doubled.stats.hp).toBeCloseTo(base.stats.hp * 2, 6);
    expect(doubled.stats.atk).toBeCloseTo(base.stats.atk * 2, 6);
    expect(doubled.stats.def).toBeCloseTo(base.stats.def * 2, 6);
    expect(doubled.stats.spd).toBeCloseTo(base.stats.spd * 2, 6);
  });

  it('statMultiplier=1 is identity (same as omitting globals)', () => {
    const pet = makePet({ dungeonLevel: 20, totalGrowth: 50_000 });

    const noGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Mage',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
    });

    const withOne = deriveCombatContext({
      pet,
      assignedClass: 'Mage',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
      globals: { statMultiplier: 1 },
    });

    expect(withOne.stats).toEqual(noGlobals.stats);
  });
});

// ── Test 7: GlobalModifiers — statAdditive ────────────────────────────────────
//
// statAdditive is added BEFORE ClassMod, so the net effect on the final stat is
// statAdditive × ClassMod.
//
// Setup: DL=10, growth=0, no gear, Adventurer (classMod.hp = 1.0)
//   baseline inner = 250 × 1.0 × 1.0 × 1 + 0   = 250  → hp = 250
//   additive  inner = 250 × 1.0 × 1.0 × 1 + 100 = 350  → hp = 350
//
// For Assassin (classMod.def = 0.7), same additive shifts def by +100 × 0.7 = +70.

describe('GlobalModifiers — statAdditive', () => {
  it('statAdditive=100 shifts HP by +100 for Adventurer (ClassMod=1.0)', () => {
    const pet = makePet({ dungeonLevel: 10, totalGrowth: 0 });

    const base = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    const shifted = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { statAdditive: 100 },
    });

    expect(shifted.stats.hp).toBeCloseTo(base.stats.hp + 100, 6);
  });

  it('statAdditive is multiplied by ClassMod (Assassin def ClassMod=0.7)', () => {
    // additive=100 → net def shift = 100 × 0.7 = 70
    const pet = makePet({ dungeonLevel: 10, totalGrowth: 0 });

    const base = deriveCombatContext({
      pet,
      assignedClass: 'Assassin',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    const shifted = deriveCombatContext({
      pet,
      assignedClass: 'Assassin',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { statAdditive: 100 },
    });

    expect(shifted.stats.def).toBeCloseTo(base.stats.def + 100 * 0.7, 6);
  });

  it('statAdditive=0 is identity (same as omitting globals)', () => {
    const pet = makePet({ dungeonLevel: 5, totalGrowth: 10_000 });

    const noGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Defender',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    const withZero = deriveCombatContext({
      pet,
      assignedClass: 'Defender',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { statAdditive: 0 },
    });

    expect(withZero.stats).toEqual(noGlobals.stats);
  });
});

// ── Test 8: GlobalModifiers — growthMultiplier ────────────────────────────────
//
// growthMultiplier=2 with growth G must equal omitting it (growthMultiplier=1) with growth 2G.
//
// Formula: effectiveGrowth = totalGrowth × growthMultiplier
//          growthFactor = 1 + effectiveGrowth / 200000
//
// Example: growth=100000, multiplier=2 → effectiveGrowth=200000 → growthFactor=2.0
//          equivalent to growth=200000, multiplier=1 → growthFactor=2.0

describe('GlobalModifiers — growthMultiplier', () => {
  it('growthMultiplier=2 with growth G equals multiplier=1 with growth 2G', () => {
    const G = 100_000;

    const petHalfGrowth = makePet({ dungeonLevel: 10, totalGrowth: G });
    const petFullGrowth = makePet({ dungeonLevel: 10, totalGrowth: G * 2 });

    const withMultiplier = deriveCombatContext({
      pet: petHalfGrowth,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { growthMultiplier: 2 },
    });

    const withoutMultiplier = deriveCombatContext({
      pet: petFullGrowth,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    expect(withMultiplier.stats.hp).toBeCloseTo(withoutMultiplier.stats.hp, 6);
    expect(withMultiplier.stats.atk).toBeCloseTo(withoutMultiplier.stats.atk, 6);
    expect(withMultiplier.stats.def).toBeCloseTo(withoutMultiplier.stats.def, 6);
    expect(withMultiplier.stats.spd).toBeCloseTo(withoutMultiplier.stats.spd, 6);
  });

  it('growthMultiplier=1 is identity (same as omitting globals)', () => {
    const pet = makePet({ dungeonLevel: 15, totalGrowth: 75_000 });

    const noGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Rogue',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
    });

    const withOne = deriveCombatContext({
      pet,
      assignedClass: 'Rogue',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
      globals: { growthMultiplier: 1 },
    });

    expect(withOne.stats).toEqual(noGlobals.stats);
  });
});

// ── Test 9: GlobalModifiers — elementLevelBonus ───────────────────────────────
//
// elementLevelBonus adds per-element flat values AFTER gear enchants.
//
// Neutral pet at DL=100 → base elements all = 75.
// Adding { Fire: 50, Water: 25 } → Fire=125, Water=100, Wind=75, Earth=75.

describe('GlobalModifiers — elementLevelBonus', () => {
  it('elementLevelBonus adds per-element flat bonuses (Neutral DL=100)', () => {
    const pet = makePet({ primaryElement: 'Neutral', dungeonLevel: 100 });

    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { elementLevelBonus: { Fire: 50, Water: 25 } },
    });

    expect(ctx.elementLevels.Fire).toBeCloseTo(75 + 50, 6);   // 125
    expect(ctx.elementLevels.Water).toBeCloseTo(75 + 25, 6);  // 100
    expect(ctx.elementLevels.Wind).toBeCloseTo(75, 6);        // unchanged
    expect(ctx.elementLevels.Earth).toBeCloseTo(75, 6);       // unchanged
  });

  it('empty elementLevelBonus ({}) is identity', () => {
    const pet = makePet({ primaryElement: 'Fire', dungeonLevel: 50 });

    const noGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    const withEmpty = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { elementLevelBonus: {} },
    });

    expect(withEmpty.elementLevels).toEqual(noGlobals.elementLevels);
  });

  it('elementLevelBonus works correctly on non-neutral pets (Fire DL=100)', () => {
    // Fire pet base: Fire=350, Water=-50, Wind=0, Earth=0
    // Add Earth=100 → Earth should become 100
    const pet = makePet({ primaryElement: 'Fire', dungeonLevel: 100 });

    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { elementLevelBonus: { Earth: 100 } },
    });

    expect(ctx.elementLevels.Fire).toBeCloseTo(350, 6);
    expect(ctx.elementLevels.Water).toBeCloseTo(-50, 6);
    expect(ctx.elementLevels.Wind).toBeCloseTo(0, 6);
    expect(ctx.elementLevels.Earth).toBeCloseTo(100, 6);
  });
});

// ── Test 10: GlobalModifiers — elementLevelMultiplier ────────────────────────
//
// elementLevelMultiplier scales all element levels multiplicatively after additive steps.
//
// Neutral pet at DL=100 → base = 75 per element.
// Multiplier=2 → all elements = 150.

describe('GlobalModifiers — elementLevelMultiplier', () => {
  it('elementLevelMultiplier=2 doubles all element levels (Neutral DL=100)', () => {
    const pet = makePet({ primaryElement: 'Neutral', dungeonLevel: 100 });

    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { elementLevelMultiplier: 2 },
    });

    expect(ctx.elementLevels.Fire).toBeCloseTo(150, 6);
    expect(ctx.elementLevels.Water).toBeCloseTo(150, 6);
    expect(ctx.elementLevels.Wind).toBeCloseTo(150, 6);
    expect(ctx.elementLevels.Earth).toBeCloseTo(150, 6);
  });

  it('elementLevelMultiplier=1 is identity', () => {
    const pet = makePet({ primaryElement: 'Neutral', dungeonLevel: 50 });

    const noGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
    });

    const withOne = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: { elementLevelMultiplier: 1 },
    });

    expect(withOne.elementLevels).toEqual(noGlobals.elementLevels);
  });

  it('elementLevelMultiplier applies AFTER elementLevelBonus (combined)', () => {
    // Neutral DL=100 → base = 75 per element
    // Add bonus Fire=25 → Fire=100, others=75
    // Multiply by 2 → Fire=200, others=150
    const pet = makePet({ primaryElement: 'Neutral', dungeonLevel: 100 });

    const ctx = deriveCombatContext({
      pet,
      assignedClass: 'Adventurer',
      row: 'front',
      constants: DEFAULT_CONSTANTS,
      globals: {
        elementLevelBonus: { Fire: 25 },
        elementLevelMultiplier: 2,
      },
    });

    expect(ctx.elementLevels.Fire).toBeCloseTo((75 + 25) * 2, 6);  // 200
    expect(ctx.elementLevels.Water).toBeCloseTo(75 * 2, 6);         // 150
    expect(ctx.elementLevels.Wind).toBeCloseTo(75 * 2, 6);          // 150
    expect(ctx.elementLevels.Earth).toBeCloseTo(75 * 2, 6);         // 150
  });
});

// ── Test 11: Identity guarantee — empty globals equals omitted globals ─────────
//
// The most important regression guard: passing `globals: {}` must produce
// bit-for-bit identical results to omitting `globals` entirely.

describe('Identity guarantee', () => {
  it('globals={} produces identical output to omitting globals', () => {
    const pet = makePet({
      primaryElement: 'Earth',
      dungeonLevel: 47,
      classLevel: 33,
      totalGrowth: 123_456,
      equipment: {
        armor: {
          id: 'a1',
          name: 'Test Armor',
          slot: 'armor',
          statMultiplierBonus: 0.15,
          tier: 2,
          elementEnchant: { Earth: 20 },
        },
      },
    });

    const noGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Blacksmith',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
    });

    const emptyGlobals = deriveCombatContext({
      pet,
      assignedClass: 'Blacksmith',
      row: 'back',
      constants: DEFAULT_CONSTANTS,
      globals: {},
    });

    expect(emptyGlobals.stats).toEqual(noGlobals.stats);
    expect(emptyGlobals.elementLevels).toEqual(noGlobals.elementLevels);
    expect(emptyGlobals.currentHp).toBe(noGlobals.currentHp);
  });
});
