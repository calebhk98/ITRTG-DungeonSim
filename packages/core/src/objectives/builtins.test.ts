/**
 * Tests for built-in objective functions (WP-E).
 *
 * Fixture strategy:
 *   - clearedFastRich  — cleared, short runtime, high rewards (best for yield/hr)
 *   - clearedSlowPoor  — cleared, long runtime, low rewards
 *   - failedPartial    — not cleared, some rooms done
 *   - mcRun            — monteCarlo run with distribution (survivalRate uses clearRate)
 *   - deepClear        — cleared at D3 diff=10 (best maxClearableDepth score)
 *   - shallowClear     — cleared at D1 diff=0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { RunConfig, RunResult, RewardBundle, RunResultDistribution } from '../domain/run.js';
import type { ObjectiveContext } from './Objective.js';
import { objectiveRegistry } from './Objective.js';

// Import side-effecting module to ensure registration runs.
import './builtins.js';

import {
  resourceYieldPerHour,
  makeResourceYieldPerHour,
  maxClearableDepth,
  survivalRate,
  xpPerHour,
  makeMaterialTargetYield,
  makeWeightedComposite,
} from './builtins.js';

// ---------------------------------------------------------------------------
// Minimal GameConstants stub — objectives don't use constants; we just need a
// value that satisfies the ObjectiveContext type.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubConstants = {} as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRewards(overrides: Partial<RewardBundle> = {}): RewardBundle {
  return {
    godPower: 0,
    luckyDraws: 0,
    petStones: 0,
    growthAwarded: 0,
    xpTotal: 0,
    materials: {},
    equipmentDrops: 0,
    keyMaterials: 0,
    runes: 0,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    team: { slots: [] } as unknown as RunConfig['team'],
    dungeonId: 'Volcano',
    depth: 1,
    difficulty: 0,
    rooms: 30,
    nrdcCompletions: 0,
    evaluationMode: 'expected',
    ...overrides,
  };
}

function makeResult(overrides: Partial<RunResult>): RunResult {
  return {
    cleared: true,
    roomsCleared: 30,
    petDeaths: [],
    elapsedMinutes: 60,
    rewards: makeRewards(),
    perPet: new Map(),
    ...overrides,
  };
}

function ctx(result: RunResult, config?: Partial<RunConfig>): ObjectiveContext {
  return {
    config: makeConfig(config),
    result,
    constants: stubConstants,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A run that cleared quickly with rich rewards — best for yield/hour
const clearedFastRich: RunResult = makeResult({
  cleared: true,
  roomsCleared: 30,
  elapsedMinutes: 60, // 1 hour
  rewards: makeRewards({
    godPower: 1000,
    luckyDraws: 10,
    petStones: 50,
    growthAwarded: 200,
    xpTotal: 5000,
    materials: { Fire: { 3: 100 } },
    equipmentDrops: 5,
    keyMaterials: 3,
    runes: 2,
  }),
  petDeaths: [],
});

// A run that cleared but slowly with poor rewards
const clearedSlowPoor: RunResult = makeResult({
  cleared: true,
  roomsCleared: 30,
  elapsedMinutes: 600, // 10 hours
  rewards: makeRewards({
    godPower: 100,
    luckyDraws: 1,
    petStones: 5,
    growthAwarded: 20,
    xpTotal: 500,
    materials: { Fire: { 3: 10 } },
  }),
  petDeaths: [],
});

// A run that did not clear — partial progress only
const failedPartial: RunResult = makeResult({
  cleared: false,
  roomsCleared: 15,
  elapsedMinutes: 225,
  rewards: makeRewards({ godPower: 300, xpTotal: 1500 }),
  petDeaths: ['pet_1' as import('../domain/ids.js').PetId],
});

// A Monte Carlo run with a distribution object
const mcDistribution: RunResultDistribution = {
  clearRate: 0.75,
  timeP50: 120,
  timeP95: 180,
  meanRewards: makeRewards({ godPower: 500, xpTotal: 2000 }),
};
const mcRun: RunResult = makeResult({
  cleared: true,
  roomsCleared: 30,
  elapsedMinutes: 120,
  rewards: makeRewards({ godPower: 500, xpTotal: 2000 }),
  distribution: mcDistribution,
  petDeaths: [],
});

// Deep, hard clear — best maxClearableDepth
const deepClearConfig: Partial<RunConfig> = { depth: 3, difficulty: 10, rooms: 30 };
const deepClear: RunResult = makeResult({
  cleared: true,
  roomsCleared: 30,
  elapsedMinutes: 450,
  rewards: makeRewards({ godPower: 3000 }),
  petDeaths: [],
});

// Shallow, easy clear — lower maxClearableDepth
const shallowClearConfig: Partial<RunConfig> = { depth: 1, difficulty: 0, rooms: 30 };
const shallowClear: RunResult = makeResult({
  cleared: true,
  roomsCleared: 30,
  elapsedMinutes: 450,
  rewards: makeRewards({ godPower: 500 }),
  petDeaths: [],
});

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe('objectiveRegistry', () => {
  it('has resourceYieldPerHour registered', () => {
    expect(objectiveRegistry.has('resourceYieldPerHour')).toBe(true);
  });

  it('has maxClearableDepth registered', () => {
    expect(objectiveRegistry.has('maxClearableDepth')).toBe(true);
  });

  it('has survivalRate registered', () => {
    expect(objectiveRegistry.has('survivalRate')).toBe(true);
  });

  it('has xpPerHour registered', () => {
    expect(objectiveRegistry.has('xpPerHour')).toBe(true);
  });

  it('registry entries match the exported singleton objects', () => {
    expect(objectiveRegistry.get('resourceYieldPerHour')).toBe(resourceYieldPerHour);
    expect(objectiveRegistry.get('maxClearableDepth')).toBe(maxClearableDepth);
    expect(objectiveRegistry.get('survivalRate')).toBe(survivalRate);
    expect(objectiveRegistry.get('xpPerHour')).toBe(xpPerHour);
  });
});

// ---------------------------------------------------------------------------
// resourceYieldPerHour
// ---------------------------------------------------------------------------

describe('resourceYieldPerHour', () => {
  it('scores a high-reward fast run above a low-reward slow run', () => {
    const scoreRich = resourceYieldPerHour.score(ctx(clearedFastRich));
    const scorePoor = resourceYieldPerHour.score(ctx(clearedSlowPoor));
    expect(scoreRich).toBeGreaterThan(scorePoor);
  });

  it('score is positive for a cleared run with rewards', () => {
    expect(resourceYieldPerHour.score(ctx(clearedFastRich))).toBeGreaterThan(0);
  });

  it('feasible() returns true for a cleared run', () => {
    expect(resourceYieldPerHour.feasible!(ctx(clearedFastRich))).toBe(true);
  });

  it('feasible() returns false for a failed (un-cleared) run', () => {
    expect(resourceYieldPerHour.feasible!(ctx(failedPartial))).toBe(false);
  });

  it('handles elapsedMinutes=0 safely (no division by zero)', () => {
    const zeroTimeRun = makeResult({ cleared: true, elapsedMinutes: 0, rewards: makeRewards({ godPower: 100 }) });
    expect(() => resourceYieldPerHour.score(ctx(zeroTimeRun))).not.toThrow();
    expect(isFinite(resourceYieldPerHour.score(ctx(zeroTimeRun)))).toBe(true);
  });

  it('returns 0 when all rewards are zero', () => {
    const emptyRun = makeResult({ cleared: true, elapsedMinutes: 60, rewards: makeRewards() });
    expect(resourceYieldPerHour.score(ctx(emptyRun))).toBe(0);
  });

  describe('makeResourceYieldPerHour factory', () => {
    it('custom weights produce different scores than the default', () => {
      // Only weight godPower
      const gpOnly = makeResourceYieldPerHour({ godPower: 1 }, 'gpOnly');
      const defaultScore = resourceYieldPerHour.score(ctx(clearedFastRich));
      const gpScore = gpOnly.score(ctx(clearedFastRich));
      // gpOnly ignores luckyDraws/petStones/etc — scores will differ
      expect(gpScore).not.toBe(defaultScore);
    });

    it('factory objective has the provided id', () => {
      const obj = makeResourceYieldPerHour({ godPower: 1 }, 'myCustomGP');
      expect(obj.id).toBe('myCustomGP');
    });

    it('factory objective is feasible only on cleared runs', () => {
      const obj = makeResourceYieldPerHour({ godPower: 1 }, 'gpFeasTest');
      expect(obj.feasible!(ctx(clearedFastRich))).toBe(true);
      expect(obj.feasible!(ctx(failedPartial))).toBe(false);
    });

    it('zero-weight fields contribute nothing to score', () => {
      const gpOnlyObj = makeResourceYieldPerHour({ godPower: 1, luckyDraws: 0 }, 'gpZ');
      // luckyDraws=10 in clearedFastRich; if weight=0 it should not affect score
      const richCtx = ctx(clearedFastRich);
      const noLD = makeResult({
        ...clearedFastRich,
        rewards: makeRewards({ ...clearedFastRich.rewards, luckyDraws: 99999 }),
      });
      expect(gpOnlyObj.score(richCtx)).toBeCloseTo(gpOnlyObj.score(ctx(noLD)), 5);
    });
  });
});

// ---------------------------------------------------------------------------
// maxClearableDepth
// ---------------------------------------------------------------------------

describe('maxClearableDepth', () => {
  it('scores a D3-diff10 clear above a D1-diff0 clear', () => {
    const deepScore = maxClearableDepth.score(ctx(deepClear, deepClearConfig));
    const shallowScore = maxClearableDepth.score(ctx(shallowClear, shallowClearConfig));
    expect(deepScore).toBeGreaterThan(shallowScore);
  });

  it('cleared D3-diff10 = 310', () => {
    expect(maxClearableDepth.score(ctx(deepClear, deepClearConfig))).toBe(310);
  });

  it('cleared D1-diff0 = 100', () => {
    expect(maxClearableDepth.score(ctx(shallowClear, shallowClearConfig))).toBe(100);
  });

  it('partial credit = roomsCleared when not cleared', () => {
    // failedPartial has roomsCleared=15
    expect(maxClearableDepth.score(ctx(failedPartial))).toBe(15);
  });

  it('partial fail always scores below any full clear', () => {
    const partialScore = maxClearableDepth.score(ctx(failedPartial));
    const clearedScore = maxClearableDepth.score(ctx(shallowClear, shallowClearConfig));
    expect(partialScore).toBeLessThan(clearedScore);
  });

  it('has no feasible() constraint (undefined)', () => {
    expect(maxClearableDepth.feasible).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// survivalRate
// ---------------------------------------------------------------------------

describe('survivalRate', () => {
  it('uses distribution.clearRate when distribution is present', () => {
    // mcRun has clearRate=0.75, no pet deaths
    expect(survivalRate.score(ctx(mcRun))).toBeCloseTo(0.75);
  });

  it('returns 1 for a cleared expected-mode run with no deaths', () => {
    expect(survivalRate.score(ctx(clearedFastRich))).toBeCloseTo(1);
  });

  it('returns fractional score for a partial run', () => {
    // failedPartial: roomsCleared=15, rooms=30 → base 0.5; 1 death → -0.05 → 0.45
    const score = survivalRate.score(ctx(failedPartial, { rooms: 30 }));
    expect(score).toBeCloseTo(0.45);
  });

  it('penalises pet deaths even on a cleared run', () => {
    const deathRun = makeResult({
      ...clearedFastRich,
      petDeaths: [
        'p1' as import('../domain/ids.js').PetId,
        'p2' as import('../domain/ids.js').PetId,
      ],
    });
    // base=1, 2 deaths → 1 - 0.10 = 0.90
    expect(survivalRate.score(ctx(deathRun))).toBeCloseTo(0.9);
  });

  it('clamps to 0 when deaths are extreme', () => {
    const manyDeaths = makeResult({
      cleared: false,
      roomsCleared: 0,
      elapsedMinutes: 15,
      rewards: makeRewards(),
      petDeaths: Array.from({ length: 30 }, (_, i) => `p${i}` as import('../domain/ids.js').PetId),
    });
    expect(survivalRate.score(ctx(manyDeaths))).toBe(0);
  });

  it('MC run scores higher than failed partial on survivalRate', () => {
    const mcScore = survivalRate.score(ctx(mcRun));
    const partialScore = survivalRate.score(ctx(failedPartial, { rooms: 30 }));
    expect(mcScore).toBeGreaterThan(partialScore);
  });

  it('has no feasible() constraint', () => {
    expect(survivalRate.feasible).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// xpPerHour
// ---------------------------------------------------------------------------

describe('xpPerHour', () => {
  it('higher xpTotal in same time → higher score', () => {
    const highXp = makeResult({ cleared: true, elapsedMinutes: 60, rewards: makeRewards({ xpTotal: 10000 }) });
    const lowXp = makeResult({ cleared: true, elapsedMinutes: 60, rewards: makeRewards({ xpTotal: 1000 }) });
    expect(xpPerHour.score(ctx(highXp))).toBeGreaterThan(xpPerHour.score(ctx(lowXp)));
  });

  it('same xpTotal but half the time → double score', () => {
    const fast = makeResult({ cleared: true, elapsedMinutes: 30, rewards: makeRewards({ xpTotal: 5000 }) });
    const slow = makeResult({ cleared: true, elapsedMinutes: 60, rewards: makeRewards({ xpTotal: 5000 }) });
    expect(xpPerHour.score(ctx(fast))).toBeCloseTo(xpPerHour.score(ctx(slow)) * 2);
  });

  it('returns 0 when xpTotal is 0', () => {
    const noXp = makeResult({ cleared: true, elapsedMinutes: 60, rewards: makeRewards() });
    expect(xpPerHour.score(ctx(noXp))).toBe(0);
  });

  it('handles elapsedMinutes=0 safely', () => {
    const zeroTime = makeResult({ cleared: true, elapsedMinutes: 0, rewards: makeRewards({ xpTotal: 100 }) });
    expect(() => xpPerHour.score(ctx(zeroTime))).not.toThrow();
    expect(isFinite(xpPerHour.score(ctx(zeroTime)))).toBe(true);
  });

  it('has no feasible() constraint', () => {
    expect(xpPerHour.feasible).toBeUndefined();
  });

  it('id is xpPerHour', () => {
    expect(xpPerHour.id).toBe('xpPerHour');
  });
});

// ---------------------------------------------------------------------------
// makeMaterialTargetYield
// ---------------------------------------------------------------------------

describe('makeMaterialTargetYield', () => {
  it('id encodes element and tier', () => {
    const obj = makeMaterialTargetYield('Fire', 3);
    expect(obj.id).toBe('materialYield:Fire:T3');
  });

  it('scores Fire T3 materials per hour correctly', () => {
    // clearedFastRich: Fire T3 = 100 in 1 hour → score = 100
    const obj = makeMaterialTargetYield('Fire', 3);
    expect(obj.score(ctx(clearedFastRich))).toBeCloseTo(100);
  });

  it('returns 0 when the specific element is absent', () => {
    const obj = makeMaterialTargetYield('Water', 2);
    // clearedFastRich has no Water materials
    expect(obj.score(ctx(clearedFastRich))).toBe(0);
  });

  it('returns 0 when the tier is absent within a present element', () => {
    const obj = makeMaterialTargetYield('Fire', 4); // Fire T4 not in fixtures
    expect(obj.score(ctx(clearedFastRich))).toBe(0);
  });

  it('a run with more of the target material scores higher', () => {
    const obj = makeMaterialTargetYield('Fire', 3);
    const richFire = makeResult({
      cleared: true,
      elapsedMinutes: 60,
      rewards: makeRewards({ materials: { Fire: { 3: 200 } } }),
    });
    const poorFire = makeResult({
      cleared: true,
      elapsedMinutes: 60,
      rewards: makeRewards({ materials: { Fire: { 3: 10 } } }),
    });
    expect(obj.score(ctx(richFire))).toBeGreaterThan(obj.score(ctx(poorFire)));
  });

  it('faster run with same material count scores higher', () => {
    const obj = makeMaterialTargetYield('Earth', 2);
    const fast = makeResult({ cleared: true, elapsedMinutes: 30, rewards: makeRewards({ materials: { Earth: { 2: 50 } } }) });
    const slow = makeResult({ cleared: true, elapsedMinutes: 120, rewards: makeRewards({ materials: { Earth: { 2: 50 } } }) });
    expect(obj.score(ctx(fast))).toBeGreaterThan(obj.score(ctx(slow)));
  });

  it('has no feasible() constraint', () => {
    expect(makeMaterialTargetYield('Fire', 1).feasible).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// makeWeightedComposite
// ---------------------------------------------------------------------------

describe('makeWeightedComposite', () => {
  it('id matches provided string', () => {
    const composite = makeWeightedComposite(
      [{ objective: xpPerHour, weight: 1 }],
      'myComposite',
    );
    expect(composite.id).toBe('myComposite');
  });

  it('single-part composite with weight=1 equals the wrapped objective score', () => {
    const composite = makeWeightedComposite(
      [{ objective: xpPerHour, weight: 1 }],
      'xpOnly',
    );
    const c = ctx(clearedFastRich);
    expect(composite.score(c)).toBeCloseTo(xpPerHour.score(c));
  });

  it('weights scale their constituent scores', () => {
    const composite = makeWeightedComposite(
      [{ objective: xpPerHour, weight: 2 }],
      'xpDoubled',
    );
    const c = ctx(clearedFastRich);
    expect(composite.score(c)).toBeCloseTo(xpPerHour.score(c) * 2);
  });

  it('sums contributions from multiple objectives', () => {
    const composite = makeWeightedComposite(
      [
        { objective: xpPerHour, weight: 1 },
        { objective: maxClearableDepth, weight: 0.5 },
      ],
      'blended',
    );
    const c = ctx(clearedFastRich);
    const expected = xpPerHour.score(c) + 0.5 * maxClearableDepth.score(c);
    expect(composite.score(c)).toBeCloseTo(expected);
  });

  it('feasible() returns false when any constituent with feasible() fails', () => {
    // resourceYieldPerHour.feasible requires cleared; failedPartial is not cleared
    const composite = makeWeightedComposite(
      [
        { objective: resourceYieldPerHour, weight: 1 },
        { objective: xpPerHour, weight: 0.1 },
      ],
      'yieldXp',
    );
    expect(composite.feasible!(ctx(failedPartial))).toBe(false);
    expect(composite.feasible!(ctx(clearedFastRich))).toBe(true);
  });

  it('feasible() returns true when no constituent has a feasible() check', () => {
    // Neither xpPerHour nor maxClearableDepth define feasible()
    const composite = makeWeightedComposite(
      [
        { objective: xpPerHour, weight: 1 },
        { objective: maxClearableDepth, weight: 1 },
      ],
      'noFeasCheck',
    );
    // Should not throw and should return true for any run
    expect(composite.feasible!(ctx(failedPartial))).toBe(true);
  });

  it('blended GP+materials composite ranks rich-fast run above poor-slow run', () => {
    const gpObj = makeResourceYieldPerHour({ godPower: 1 }, 'gpRaw');
    const matObj = makeMaterialTargetYield('Fire', 3);
    const composite = makeWeightedComposite(
      [
        { objective: gpObj, weight: 1 },
        { objective: matObj, weight: 10 },
      ],
      'gpPlusMat',
    );
    expect(composite.score(ctx(clearedFastRich))).toBeGreaterThan(composite.score(ctx(clearedSlowPoor)));
  });
});
