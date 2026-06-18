/**
 * Tests for sim/combat.ts — resolveRound and the damage pipeline.
 *
 * Hand-computed examples verify every step of §6.2 in isolation.
 */

import { describe, it, expect } from 'vitest';
import { resolveRound } from './combat.js';
import { DeterministicExpectedStrategy, MonteCarloStrategy } from './strategies.js';
import { mulberry32 } from './rng.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import type { CombatContext } from '../domain/combat.js';
import type { Element } from '../domain/element.js';
import type { PetId } from '../domain/ids.js';

// ── Helper factories ──────────────────────────────────────────────────────────

let _idCounter = 0;

function makeAlly(overrides: Partial<CombatContext> = {}): CombatContext {
  const id = `pet-${++_idCounter}`;
  const hp = overrides.stats?.hp ?? 500;
  const base: CombatContext = {
    petId: id as unknown as PetId,
    stats: { hp, atk: 200, def: 100, spd: 300 },
    elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    element: 'Neutral' as Element,
    assignedClass: null,
    row: 'front',
    abilities: [],
    currentHp: hp,
  };
  const merged = { ...base, ...overrides };
  // Ensure currentHp tracks the stats.hp if not explicitly overridden
  merged.currentHp = overrides.currentHp ?? merged.stats.hp;
  return merged;
}

function makeEnemy(overrides: Partial<CombatContext> = {}): CombatContext {
  const id = `enemy-${++_idCounter}`;
  const hp = overrides.stats?.hp ?? 500;
  const base: CombatContext = {
    enemyId: id,
    stats: { hp, atk: 100, def: 100, spd: 200 },
    elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    element: 'Neutral' as Element,
    assignedClass: null,
    row: 'front',
    abilities: [],
    currentHp: hp,
  };
  const merged = { ...base, ...overrides };
  merged.currentHp = overrides.currentHp ?? merged.stats.hp;
  return merged;
}

const C = DEFAULT_CONSTANTS;
const evRng = mulberry32(0);

// ── Test 1: Full pipeline — hand-computed single hit ─────────────────────────
//
// Setup:
//   Attacker (ally, front row, Neutral, no class):
//     atk=200, spd=300, elementLevels all=75
//   Defender (enemy, front row, Neutral, no class):
//     def=100, spd=200, hp=1000, elementLevels all=75
//
// Pipeline:
//   Step 1: BaseDmg = 200 − 100/2 = 150
//   Step 2: Neutral→pick best (A−D); all = 75−75=0, pick Fire.
//           elemFactor = (1+75/100)/(1+75/100) = 1.75/1.75 = 1.0
//   Step 3: defFactor = 1 − 100/(100+200) = 1 − 1/3 ≈ 0.66667
//   Step 4: effAtkSpd = 300 × 1.20 = 360 (front row +20%)
//           speedDmg = max(0, (360−200)/2) = 160/2 = 80
//   Step 5: front row attacker → backRowMod = 1.0
//
//   perHit = (150 × 1.0 × 0.66667 + 80) × 1.0 = (100 + 80) = 180
//   clamp: BaseDmg>0 → min(1,180) = 180 ✓
//
//   hitChance = min(1, max(0.05, 360/(200×1.2))) = min(1, 360/240) = min(1, 1.5) = 1.0
//   (raw ratio 1.5 is capped to 1.0)
//
//   EV actions at spd=300: 1 + clamp(300/500,0,1) + 0 = 1 + 0.6 = 1.6
//   EV total = 180 × 1.0 × 1.6 = 288

describe('Full damage pipeline — hand-computed single attacker (EV mode)', () => {
  it('computes total damage ≈ 288 for the documented pair (hitChance capped at 1.0)', () => {
    const ally = makeAlly({
      stats: { hp: 500, atk: 200, def: 50, spd: 300 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const enemy = makeEnemy({
      stats: { hp: 1000, atk: 1, def: 100, spd: 200 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([ally], [enemy], C, ev, evRng);

    const allyKey = ally.petId as unknown as string;
    const dmg = outcome.damageByAttacker.get(allyKey);
    expect(dmg).toBeCloseTo(288, 0);

    const enemyKey = enemy.enemyId!;
    expect(outcome.enemyHpAfter.get(enemyKey)).toBeCloseTo(1000 - 288, 0);
  });
});

// ── Test 2: D_elem < 0 rule ──────────────────────────────────────────────────
//
// Water attacker (A_water=200) vs Fire defender (D_water=−50).
// Rule: D < 0 → A += |D|, D = 0.
//   Adjusted: A=250, D=0 → elemFactor = (1+250/100)/(1+0/100) = 3.5
//
// Worked values:
//   atk=300, def=0, atkSpd=100, defSpd=100
//   BaseDmg = 300 − 0 = 300
//   elemFactor = 3.5
//   defFactor = 1 − 0/(0+200) = 1.0
//   effAtkSpd (front) = 100 × 1.2 = 120
//   speedDmg = (120−100)/2 = 10
//   perHit = (300 × 3.5 × 1.0 + 10) × 1.0 = 1060
//   EV actions at spd=100: 1 + 100/500 = 1.2
//   hitChance = max(0.05, 120/120) = 1.0
//   totalDmg = 1060 × 1.0 × 1.2 = 1272

describe('D_elem < 0 rule (§6.2 Step 2)', () => {
  it('adjusts A and D when D_elem < 0, giving elemFactor=3.5', () => {
    const attacker = makeAlly({
      stats: { hp: 500, atk: 300, def: 50, spd: 100 },
      element: 'Water',
      elementLevels: { Fire: 0, Water: 200, Wind: 0, Earth: 0 },
      row: 'front',
    });
    const defender = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 0, spd: 100 },
      element: 'Fire',
      // Fire pet: weakness is Water → Water element level = −50
      elementLevels: { Fire: 350, Water: -50, Wind: 0, Earth: 0 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([attacker], [defender], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(attacker.petId as unknown as string)!;
    expect(dmg).toBeCloseTo(1272, 0);
  });
});

// ── Test 3: Back-row penalty applied (non-Mage) ───────────────────────────────

describe('Back-row penalty — Assassin vs Mage (§6.2 Step 5)', () => {
  it('Assassin back-row attacker suffers 0.80 penalty', () => {
    // atk=200, def=0, spd=100 (back row, no front bonus)
    // BaseDmg = 200; defFactor=1.0; effAtkSpd=100 (no front bonus)
    // speedDmg = (100−100)/2 = 0
    // backRowMod = 0.80
    // perHit = (200 × 1.0 × 1.0 + 0) × 0.80 = 160
    // EV actions at spd=100: 1.2; hitChance = max(0.05, 100/120) ≈ 0.833
    // totalDmg = 160 × 0.833 × 1.2 = 160
    const attacker = makeAlly({
      stats: { hp: 500, atk: 200, def: 50, spd: 100 },
      assignedClass: 'Assassin',
      row: 'back',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const defender = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 0, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([attacker], [defender], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(attacker.petId as unknown as string)!;
    expect(dmg).toBeCloseTo(160, 0);
  });

  it('Mage back-row attacker is exempt from penalty (backRowMod=1.0)', () => {
    // Same stats as Assassin above but Mage → no penalty
    // perHit = 200 × 1.0 = 200 (no 0.80 reduction)
    // totalDmg = 200 × 0.833 × 1.2 = 200
    const attacker = makeAlly({
      stats: { hp: 500, atk: 200, def: 50, spd: 100 },
      assignedClass: 'Mage',
      row: 'back',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const defender = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 0, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([attacker], [defender], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(attacker.petId as unknown as string)!;
    expect(dmg).toBeCloseTo(200, 0);
  });

  it('Mage deals exactly 1/0.80 = 1.25× more than Assassin in back row (same stats)', () => {
    const makeBack = (cls: 'Mage' | 'Assassin'): CombatContext =>
      makeAlly({
        stats: { hp: 500, atk: 200, def: 50, spd: 100 },
        assignedClass: cls,
        row: 'back',
        element: 'Neutral',
        elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
      });

    const mage     = makeBack('Mage');
    const assassin = makeBack('Assassin');

    const mageDef     = makeEnemy({ stats: { hp: 10000, atk: 1, def: 0, spd: 100 } });
    const assassinDef = makeEnemy({ stats: { hp: 10000, atk: 1, def: 0, spd: 100 } });

    const ev = new DeterministicExpectedStrategy();
    const mageDmg     = resolveRound([mage],     [mageDef],     C, ev, evRng)
      .damageByAttacker.get(mage.petId     as unknown as string)!;
    const assassinDmg = resolveRound([assassin], [assassinDef], C, ev, evRng)
      .damageByAttacker.get(assassin.petId as unknown as string)!;

    expect(mageDmg).toBeGreaterThan(assassinDmg);
    expect(mageDmg / assassinDmg).toBeCloseTo(1 / 0.80, 5);
  });
});

// ── Test 4: SpeedDamage bypasses defense ─────────────────────────────────────

describe('SpeedDamage bypasses defense (§6.2 Step 4)', () => {
  it('fast attacker deals speed damage even against very high defense', () => {
    // atk=100, def=99900 → BaseDmg = 100 − 49950 < 0 → max(0, ...) = 0 base component
    // effAtkSpd (front) = 1000 × 1.2 = 1200
    // speedDmg = (1200 − 100) / 2 = 550
    // perHit = (0 + 550) × 1.0 = 550 (baseDmg<0 → clamp is 0, not 1)
    // EV actions at spd=1000: 1+1+0.5=2.5
    // hitChance = min(1, max(0.05, 1200/(100×1.2))) = min(1, 10.0) = 1.0
    //   (raw ratio 10.0 is capped to 1.0)
    // totalDmg = 550 × 1.0 × 2.5 = 1375
    const attacker = makeAlly({
      stats: { hp: 500, atk: 100, def: 50, spd: 1000 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const heavyDef = makeEnemy({
      stats: { hp: 99999, atk: 1, def: 99900, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([attacker], [heavyDef], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(attacker.petId as unknown as string)!;

    // Speed damage gets through even with near-infinite defense
    expect(dmg).toBeGreaterThan(0);
    expect(dmg).toBeCloseTo(1375, 0);
  });

  it('SpeedDamage is 0 when attacker is slower than defender', () => {
    // effAtkSpd = 50 × 1.2 = 60; defSpd = 500 → speedDmg = max(0, −220) = 0
    // BaseDmg = 300; defFactor=1.0; perHit = 300
    // EV actions at spd=50: 1.1; hitChance = max(0.05, 60/600) = max(0.05, 0.1) = 0.1
    // totalDmg = 300 × 0.1 × 1.1 = 33
    const slowAttacker = makeAlly({
      stats: { hp: 500, atk: 300, def: 50, spd: 50 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const fastEnemy = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 0, spd: 500 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([slowAttacker], [fastEnemy], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(slowAttacker.petId as unknown as string)!;
    expect(dmg).toBeCloseTo(33, 0);
  });
});

// ── Test 5: Determinism — same seed → identical RoundOutcome ─────────────────

describe('Determinism (MC strategy, fixed seed)', () => {
  it('same seed → identical RoundOutcome', () => {
    const makeInputs = (): [CombatContext[], CombatContext[]] => {
      const ally = makeAlly({
        stats: { hp: 500, atk: 200, def: 50, spd: 600 },
        row: 'front',
        element: 'Fire',
        elementLevels: { Fire: 200, Water: -50, Wind: 0, Earth: 0 },
        abilities: ['luckyCoin'],
      });
      const enemy = makeEnemy({
        stats: { hp: 1000, atk: 100, def: 80, spd: 300 },
        row: 'front',
        element: 'Neutral',
        elementLevels: { Fire: 60, Water: 60, Wind: 60, Earth: 60 },
      });
      return [[ally], [enemy]];
    };

    const runWithSeed = (seed: number): { dmg: number | undefined; deaths: ReadonlyArray<string> } => {
      const [allies, enemies] = makeInputs();
      const rng = mulberry32(seed);
      const mc = new MonteCarloStrategy(rng);
      const outcome = resolveRound(allies, enemies, C, mc, rng);
      const allyKey = allies[0]!.petId as unknown as string;
      return { dmg: outcome.damageByAttacker.get(allyKey), deaths: outcome.deaths };
    };

    const run1 = runWithSeed(0xdeadbeef);
    const run2 = runWithSeed(0xdeadbeef);

    expect(run1.dmg).toEqual(run2.dmg);
    expect(run1.deaths).toEqual(run2.deaths);
  });
});

// ── Test 6: Supporter reduces damage taken by 50% ────────────────────────────
//
// Any living combatant on the defender's side with `supporterDmgReduction`
// flag halves all incoming damage (capped at 50%, research §5.6).

describe('Supporter damage reduction (§5.6)', () => {
  it('defender side with supporterDmgReduction takes ~50% less damage', () => {
    const makeAttacker = (): CombatContext =>
      makeAlly({
        stats: { hp: 500, atk: 300, def: 50, spd: 100 },
        row: 'front',
        element: 'Neutral',
        elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
      });

    // Without supporter
    const targetA = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 0, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
      abilities: [],
    });

    // With supporter flag (represents a team where a Supporter is alive)
    const targetB = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 0, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
      abilities: ['supporterDmgReduction'],
    });

    const ev = new DeterministicExpectedStrategy();

    const atk1 = makeAttacker();
    const outcomeA = resolveRound([atk1], [targetA], C, ev, evRng);
    const dmgA = outcomeA.damageByAttacker.get(atk1.petId as unknown as string)!;

    const atk2 = makeAttacker();
    const outcomeB = resolveRound([atk2], [targetB], C, ev, evRng);
    const dmgB = outcomeB.damageByAttacker.get(atk2.petId as unknown as string)!;

    // Damage WITH supporter should be exactly 50% of damage WITHOUT
    expect(dmgB).toBeCloseTo(dmgA * 0.5, 3);
  });
});

// ── Test 7: Defense soft cap ─────────────────────────────────────────────────
//
// DefenseFactor = 1 − D/(D + 200)
// D=200 → 50% mitigation; D=800 → 80% mitigation

describe('Defense soft cap (§6.2 Step 3)', () => {
  it('D=200 → defFactor=0.5, total damage ≈ 192', () => {
    // atk=400, atkSpd=100 (front), defSpd=100, def=200
    // BaseDmg = 400 − 100 = 300
    // defFactor = 1 − 200/400 = 0.5
    // effAtkSpd = 120; speedDmg = (120−100)/2 = 10
    // perHit = (300 × 1.0 × 0.5 + 10) × 1.0 = 160
    // EV actions: 1.2; hitChance = max(0.05, 120/120) = 1.0
    // totalDmg = 160 × 1.0 × 1.2 = 192
    const atk = makeAlly({
      stats: { hp: 500, atk: 400, def: 50, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const def200 = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 200, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([atk], [def200], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(atk.petId as unknown as string)!;
    expect(dmg).toBeCloseTo(192, 0);
  });

  it('D=800 → defFactor=0.2, total damage ≈ 396', () => {
    // atk=2000, def=800, atkSpd=100, defSpd=100
    // BaseDmg = 2000 − 400 = 1600
    // defFactor = 1 − 800/1000 = 0.2
    // effAtkSpd = 120; speedDmg = 10
    // perHit = (1600 × 0.2 + 10) × 1.0 = 330
    // EV actions: 1.2; hitChance: 1.0
    // totalDmg = 330 × 1.0 × 1.2 = 396
    const atk = makeAlly({
      stats: { hp: 500, atk: 2000, def: 50, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const def800 = makeEnemy({
      stats: { hp: 10000, atk: 1, def: 800, spd: 100 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([atk], [def800], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(atk.petId as unknown as string)!;
    expect(dmg).toBeCloseTo(396, 0);
  });
});

// ── Test 8: Deaths are recorded correctly ────────────────────────────────────

describe('Death detection', () => {
  it('enemy with insufficient HP is recorded as dead', () => {
    const atk = makeAlly({
      stats: { hp: 500, atk: 1000, def: 50, spd: 100 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const weakEnemy = makeEnemy({
      stats: { hp: 10, atk: 1, def: 0, spd: 50 },
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([atk], [weakEnemy], C, ev, evRng);

    expect(outcome.deaths).toContain(weakEnemy.enemyId!);
    expect(weakEnemy.currentHp).toBeLessThanOrEqual(0);
    expect(outcome.enemyHpAfter.get(weakEnemy.enemyId!)).toBeLessThanOrEqual(0);
  });

  it('surviving combatants are NOT in deaths list', () => {
    const atk = makeAlly({ stats: { hp: 500, atk: 1, def: 50, spd: 50 } });
    const tough = makeEnemy({ stats: { hp: 999999, atk: 1, def: 0, spd: 50 } });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([atk], [tough], C, ev, evRng);

    expect(outcome.deaths).not.toContain(tough.enemyId!);
  });
});

// ── Test 9: Hit-chance cap regression — fast attacker vs slow defender ────────
//
// Raw ratio effAtkSpd / (defSpd × 1.2) > 1 must be clamped to 1.0.
//
// Setup:
//   Attacker: front row, spd=600, atk=200, def=0 (no def on attacker matters)
//   Defender: front row, spd=100, def=0, hp=99999
//
//   effAtkSpd = 600 × 1.2 = 720  (front-row bonus)
//   raw ratio = 720 / (100 × 1.2) = 720 / 120 = 6.0  → capped to 1.0
//
//   BaseDmg = 200 − 0/2 = 200
//   elemFactor = 1.0 (Neutral vs Neutral, equal levels)
//   defFactor = 1 − 0/(0+200) = 1.0
//   speedDmg = (720 − 100) / 2 = 310
//   perHit = (200 × 1.0 × 1.0 + 310) × 1.0 = 510
//   EV actions at spd=600: 1 + clamp(600/500,0,1) + clamp((600−500)/1000,0,1)
//                        = 1 + 1.0 + 0.1 = 2.1
//   EV damage = 510 × 1.0 × 2.1 = 1071  (NOT 510 × 6.0 × 2.1 = 6426)

describe('Hit-chance cap regression (fast attacker, raw ratio > 1)', () => {
  it('EV damage equals perHit × 1.0 × actions, not perHit × rawRatio × actions', () => {
    const fastAlly = makeAlly({
      stats: { hp: 500, atk: 200, def: 0, spd: 600 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const slowEnemy = makeEnemy({
      stats: { hp: 99999, atk: 1, def: 0, spd: 100 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });

    const ev = new DeterministicExpectedStrategy();
    const outcome = resolveRound([fastAlly], [slowEnemy], C, ev, evRng);
    const dmg = outcome.damageByAttacker.get(fastAlly.petId as unknown as string)!;

    // perHit=510, hitChance=1.0 (capped), actions=2.1 → 1071
    const expectedEv = 510 * 1.0 * 2.1;
    // If hitChance were NOT capped, we'd get 510 * 6.0 * 2.1 = 6426
    const uncappedWrong = 510 * 6.0 * 2.1;

    expect(dmg).toBeCloseTo(expectedEv, 0);
    expect(dmg).not.toBeCloseTo(uncappedWrong, 0);
  });
});

// ── Test 10: EV/MC agreement — fast attacker (hit-chance capped at 1.0) ──────
//
// After fixing the cap, EV and MC must agree: a fast attacker vs slow defender
// where the raw ratio > 1 should produce the same expected damage in both modes.
//
// With hitChance capped to 1.0, MC mode will always hit (p=1.0 → always true).
// EV damage = perHit × 1.0 × actions.
// MC mean damage over many trials ≈ perHit × 1.0 × E[actions].
//
// Same attacker/defender as Test 9:
//   EV damage = 1071 (510 × 1.0 × 2.1)
//   MC mean should converge to ≈ 1071 within tolerance.

describe('EV/MC agreement — fast attacker with hit-chance cap (divergence regression)', () => {
  it('MC mean damage ≈ EV damage (within 5%) when hitChance is capped at 1.0', () => {
    const TRIALS = 50_000;
    const TOLERANCE_FRAC = 0.05; // 5%

    // Compute EV damage as reference
    const fastAllyEv = makeAlly({
      stats: { hp: 500, atk: 200, def: 0, spd: 600 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const slowEnemyEv = makeEnemy({
      stats: { hp: 99999, atk: 1, def: 0, spd: 100 },
      row: 'front',
      element: 'Neutral',
      elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    });
    const ev = new DeterministicExpectedStrategy();
    const evOutcome = resolveRound([fastAllyEv], [slowEnemyEv], C, ev, evRng);
    const evDmg = evOutcome.damageByAttacker.get(fastAllyEv.petId as unknown as string)!;

    // Compute MC mean over many trials with a fixed seed
    let mcTotal = 0;
    const rngSeed = mulberry32(0xc0ffee);
    for (let t = 0; t < TRIALS; t++) {
      const fastAllyMc = makeAlly({
        stats: { hp: 500, atk: 200, def: 0, spd: 600 },
        row: 'front',
        element: 'Neutral',
        elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
      });
      const slowEnemyMc = makeEnemy({
        stats: { hp: 99999, atk: 1, def: 0, spd: 100 },
        row: 'front',
        element: 'Neutral',
        elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
      });
      const mc = new MonteCarloStrategy(rngSeed);
      const mcOutcome = resolveRound([fastAllyMc], [slowEnemyMc], C, mc, rngSeed);
      mcTotal += mcOutcome.damageByAttacker.get(fastAllyMc.petId as unknown as string) ?? 0;
    }
    const mcMean = mcTotal / TRIALS;

    // MC mean should be within 5% of EV
    expect(mcMean).toBeGreaterThanOrEqual(evDmg * (1 - TOLERANCE_FRAC));
    expect(mcMean).toBeLessThanOrEqual(evDmg * (1 + TOLERANCE_FRAC));
  });
});
