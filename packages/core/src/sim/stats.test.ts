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
//   dojoMod = 1, strategyRoomMod = 0
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
      // dojoMod defaults to 1, strategyRoomMod defaults to 0
    };

    const ctx = deriveCombatContext(input);
    expect(ctx.stats.def).toBeCloseTo(95.22, 0); // ±0.5 tolerance
  });
});

// ── Test 2: HP formula sanity ─────────────────────────────────────────────────
//
// Hand derivation (DL=10, growth=0, no gear, Adventurer, no dojo):
//   hpBase = 10 + 24 × 10 = 250
//   growthFactor = 1 + 0 / 200000 = 1.0
//   equipMod = 1.0, dojoMod = 1.0, stratMod = 0
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
      dojoMod: 1.1,
      strategyRoomMod: 5,
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
