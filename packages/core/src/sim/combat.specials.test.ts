/**
 * Tests for the pet combat specials wired into sim/combat.ts (research §13).
 *
 * Each special is exercised in EV mode (DeterministicExpectedStrategy) so the
 * assertions are exact/deterministic. Where a special's magnitude is awkward to
 * hand-compute, the test pins the *ratio* against an identical baseline combatant
 * by zeroing speed (→ exactly 1 base action, no speed damage, hit chance at the
 * 5% floor) so only the special under test moves the number.
 */

import { describe, it, expect } from 'vitest';
import { resolveRound } from './combat.js';
import { DeterministicExpectedStrategy } from './strategies.js';
import { mulberry32 } from './rng.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import type { CombatContext } from '../domain/combat.js';
import type { Element } from '../domain/element.js';
import type { PetId } from '../domain/ids.js';
import type { AbilityFlag } from '../domain/pet.js';

const C = DEFAULT_CONSTANTS;
const EV = new DeterministicExpectedStrategy();
const rng = mulberry32(1);

let _id = 0;
function ally(overrides: Partial<CombatContext> = {}): CombatContext {
  const hp = overrides.stats?.hp ?? 100_000;
  const base: CombatContext = {
    petId: `pet-${++_id}` as unknown as PetId,
    stats: { hp, atk: 200, def: 100, spd: 0 },
    elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    element: 'Neutral' as Element,
    assignedClass: null,
    classLevel: 0,
    row: 'front',
    abilities: [],
    currentHp: hp,
  };
  const merged = { ...base, ...overrides };
  merged.currentHp = overrides.currentHp ?? merged.stats.hp;
  return merged;
}
function enemy(overrides: Partial<CombatContext> = {}): CombatContext {
  const hp = overrides.stats?.hp ?? 100_000;
  const base: CombatContext = {
    enemyId: `enemy-${++_id}`,
    stats: { hp, atk: 100, def: 100, spd: 200 },
    elementLevels: { Fire: 75, Water: 75, Wind: 75, Earth: 75 },
    element: 'Neutral' as Element,
    assignedClass: null,
    classLevel: 0,
    row: 'front',
    abilities: [],
    currentHp: hp,
  };
  const merged = { ...base, ...overrides };
  merged.currentHp = overrides.currentHp ?? merged.stats.hp;
  return merged;
}

/** Damage one lone attacker deals to one lone enemy in a single round (EV). */
function soloDamage(attackerAbilities: ReadonlyArray<AbilityFlag>, extra: Partial<CombatContext> = {}): number {
  const a = ally({ abilities: attackerAbilities, ...extra });
  const e = enemy();
  const outcome = resolveRound([a], [e], C, EV, rng);
  return outcome.damageByAttacker.get(a.petId as unknown as string) ?? 0;
}

describe('Ghost — cannotAttack + scareDebuff (§13)', () => {
  it('a cannotAttack pet deals no attack damage', () => {
    const ghost = ally({ abilities: ['cannotAttack'] });
    const e = enemy();
    const outcome = resolveRound([ghost], [e], C, EV, rng);
    expect(outcome.damageByAttacker.get(ghost.petId as unknown as string)).toBeUndefined();
    expect(e.currentHp).toBe(e.stats.hp); // untouched
  });

  it('Scare halves a normal enemy ATK and DEF (×0.5)', () => {
    const ghost = ally({ abilities: ['cannotAttack', 'scareDebuff'] });
    const e = enemy();
    resolveRound([ghost], [e], C, EV, rng);
    expect(e.atkMod).toBe(0.5);
    expect(e.defMod).toBe(0.5);
  });

  it('Scare only reduces bosses by 30% (×0.7)', () => {
    const ghost = ally({ abilities: ['cannotAttack', 'scareDebuff'] });
    const boss = enemy({ isBoss: true });
    resolveRound([ghost], [boss], C, EV, rng);
    expect(boss.atkMod).toBe(0.7);
    expect(boss.defMod).toBe(0.7);
  });
});

describe('Sniper — snipeTriple (§13)', () => {
  it('deals exactly 3× a baseline attacker (same stats, speed 0 → 1 action)', () => {
    const baseline = soloDamage([]);
    const sniper = soloDamage(['snipeTriple']);
    expect(sniper).toBeCloseTo(baseline * 3, 5);
  });

  it('ignores the back-row penalty', () => {
    const back = soloDamage(['snipeTriple'], { row: 'back' });
    const front = soloDamage(['snipeTriple'], { row: 'front' });
    expect(back).toBeCloseTo(front, 5); // no 0.80 penalty
  });
});

describe('Archer — bowExtraAttack (§13)', () => {
  it('CL64 gives a guaranteed extra action (2× damage at speed 0)', () => {
    const baseline = soloDamage([]);
    const archer = soloDamage(['bowExtraAttack'], { classLevel: 64 });
    expect(archer).toBeCloseTo(baseline * 2, 5);
  });

  it('CL0 still grants its 20% base extra-attack chance (1.2× damage)', () => {
    const baseline = soloDamage([]);
    const archer = soloDamage(['bowExtraAttack'], { classLevel: 0 });
    expect(archer).toBeCloseTo(baseline * 1.2, 5);
  });
});

describe('Sylph — windExtraHits (§13)', () => {
  // Use an enemy whose Wind matches the attacker's so the elemental factor stays
  // 1.0 and only the extra-hit count moves the damage.
  function windDamage(abilities: ReadonlyArray<AbilityFlag>, wind: number): number {
    const els = { Fire: 75, Water: 75, Wind: wind, Earth: 75 };
    const a = ally({ abilities, elementLevels: els });
    const e = enemy({ elementLevels: els });
    return resolveRound([a], [e], C, EV, rng).damageByAttacker.get(a.petId as unknown as string) ?? 0;
  }

  it('Wind 900 → +2 hits (3× damage at speed 0)', () => {
    expect(windDamage(['windExtraHits'], 900)).toBeCloseTo(windDamage([], 900) * 3, 5);
  });

  it('caps the bonus at +7 hits (Wind 9000 → 8× damage, not 20×)', () => {
    expect(windDamage(['windExtraHits'], 9000)).toBeCloseTo(windDamage([], 9000) * 8, 5);
  });
});

describe('Undine — undineAoe (§13)', () => {
  it('deals ~1% of a non-boss enemy max HP (Water 0) and spares bosses', () => {
    // Undine cannot land a normal hit here (atk < def/2, speed 0) so only the
    // AoE moves enemy HP.
    const undine = ally({
      abilities: ['undineAoe'],
      stats: { hp: 100_000, atk: 10, def: 100, spd: 0 },
      elementLevels: { Fire: 0, Water: 0, Wind: 0, Earth: 0 },
    });
    const normal = enemy({ stats: { hp: 1000, atk: 0, def: 100, spd: 200 } });
    const boss = enemy({ isBoss: true, stats: { hp: 1000, atk: 0, def: 100, spd: 200 } });
    resolveRound([undine], [normal, boss], C, EV, rng);
    expect(normal.currentHp).toBeCloseTo(990, 5); // 1% of 1000
    expect(boss.currentHp).toBe(1000); // bosses immune to the AoE
  });
});

describe('Leviathan — counterAttack (§13)', () => {
  it('reflects damage back at attackers, hurting them vs no-counter baseline', () => {
    const withCounter = ally({ stats: { hp: 100_000, atk: 200, def: 100, spd: 0 } });
    const lev = enemy({ abilities: ['counterAttack'], stats: { hp: 50_000, atk: 0, def: 100, spd: 200 } });
    resolveRound([withCounter], [lev], C, EV, rng);

    const noCounter = ally({ stats: { hp: 100_000, atk: 200, def: 100, spd: 0 } });
    const plain = enemy({ stats: { hp: 50_000, atk: 0, def: 100, spd: 200 } });
    resolveRound([noCounter], [plain], C, EV, rng);

    expect(withCounter.currentHp).toBeLessThan(noCounter.currentHp); // took counter damage
  });
});

describe('Elephant — burnAttackers (§13)', () => {
  it('burns attackers for a share of their max HP', () => {
    const withBurn = ally({ stats: { hp: 100_000, atk: 200, def: 100, spd: 0 } });
    const ele = enemy({ abilities: ['burnAttackers'], stats: { hp: 100_000, atk: 0, def: 100, spd: 200 } });
    resolveRound([withBurn], [ele], C, EV, rng);

    const noBurn = ally({ stats: { hp: 100_000, atk: 200, def: 100, spd: 0 } });
    const plain = enemy({ stats: { hp: 100_000, atk: 0, def: 100, spd: 200 } });
    resolveRound([noBurn], [plain], C, EV, rng);

    expect(withBurn.currentHp).toBeLessThan(noBurn.currentHp);
  });
});

describe('Hourglass — slowEnemies (§13)', () => {
  it('CL0 slows enemies by 10% (spdMod 0.9)', () => {
    const hg = ally({ abilities: ['slowEnemies'], classLevel: 0 });
    const e = enemy();
    resolveRound([hg], [e], C, EV, rng);
    expect(e.spdMod).toBeCloseTo(0.9, 5);
  });

  it('CL50 slows enemies by 20% (spdMod 0.8)', () => {
    const hg = ally({ abilities: ['slowEnemies'], classLevel: 50 });
    const e = enemy();
    resolveRound([hg], [e], C, EV, rng);
    expect(e.spdMod).toBeCloseTo(0.8, 5);
  });
});

describe('Honeybadger — honeyBadgerDamage (§13)', () => {
  it('CL50 multiplies own damage by 1.5×', () => {
    const baseline = soloDamage([]);
    const badger = soloDamage(['honeyBadgerDamage'], { classLevel: 50 });
    expect(badger).toBeCloseTo(baseline * 1.5, 5);
  });
});

describe('Succubus — succubusHeal CL scaling (§13)', () => {
  it('heals the attacker when it deals damage (vs no-heal baseline)', () => {
    // Compare against an identical attacker without the flag; both take the same
    // incoming damage, so any HP difference is the lifesteal.
    const mk = (abilities: ReadonlyArray<AbilityFlag>): CombatContext =>
      ally({
        abilities,
        classLevel: 100,
        stats: { hp: 100_000, atk: 200, def: 100, spd: 0 },
        currentHp: 10_000,
      });
    const succ = mk(['succubusHeal']);
    resolveRound([succ], [enemy()], C, EV, rng);
    const plain = mk([]);
    resolveRound([plain], [enemy()], C, EV, rng);
    expect(succ.currentHp).toBeGreaterThan(plain.currentHp);
  });
});
