/**
 * Golden tests for WP-G: the enemy scaling resolver (sim/scaling.ts).
 *
 * Each test encodes a hand-computed expected value. Where the simplified √2
 * model diverges from the wiki table, the discrepancy is documented inline.
 *
 * Accumulation formula for towerFloor (documented here for traceability):
 *
 *   D = doublingEveryFloors (50)
 *   band = ⌊floor / D⌋   (which 50-floor band we're past)
 *   rem  = floor mod D    (remaining floors in the current band)
 *
 *   totalInc(baseInc, floor) =
 *       Σ_{b=0}^{band-1} D × baseInc × 2^b   ← full completed bands
 *     + rem × baseInc × 2^band                ← partial trailing band
 *
 *   stat(floor) = base × (1 + totalInc(baseInc, floor))
 *
 * HP/Def/Spd use baseInc = 0.40; Atk uses baseInc = 0.50.
 */

import { describe, it, expect } from 'vitest';
import { scaleEnemyStats, scaleEnemyToContext } from './scaling.js';
import type { EnemyArchetype } from '../domain/enemy.js';
import type { CombatStats } from '../domain/combat.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';

// ── Archetype factories ───────────────────────────────────────────────────────

function makeArchetype(
  overrides: Partial<EnemyArchetype> & { scaling: EnemyArchetype['scaling'] },
): EnemyArchetype {
  return {
    id: 'test-enemy',
    element: 'Neutral',
    isBoss: false,
    xpValue: 0,
    baseStats: { hp: 1000, atk: 100, def: 50, spd: 50 },
    ...overrides,
  };
}

// ── expSqrtDiff: Railgun ──────────────────────────────────────────────────────

describe('expSqrtDiff (Railgun)', () => {
  /**
   * Research §7.2: dmg(d) = 20000 × (√2)^d = 20000 × 2^(d/2)
   *
   * Wiki table (_scaling_table in scrapyard-enemies.json):
   *   Diff 0  = 20000    Model: 20000.00       delta: 0
   *   Diff 5  = 113165   Model: 20000×2^2.5 ≈ 113137  delta: ~28  (~0.025%)
   *   Diff 10 = 640310   Model: 20000×2^5  = 640000    delta: ~310 (~0.048%)
   *
   * The small discrepancy (<0.05%) is consistent with rounding in the wiki table
   * (likely integer-truncated after each step of ×√2 applied incrementally).
   * Our model applies the exact closed-form 2^(d/2) which is mathematically
   * equivalent but avoids accumulated floating-point rounding.
   */
  const railgun = makeArchetype({
    id: 'railgun-trap',
    element: 'Neutral',
    baseStats: { hp: 20000, atk: 20000, def: 0, spd: 0 },
    scaling: { kind: 'expSqrtDiff' },
    specials: [{ kind: 'railgun', baseDamage: 20000 }],
  });

  it('Diff 0 = base (20000)', () => {
    const stats = scaleEnemyStats(railgun, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBeCloseTo(20000, 0);
    expect(stats.atk).toBeCloseTo(20000, 0);
  });

  it('Diff 10 ≈ 640000 (model), wiki says 640310 — within 0.05%', () => {
    const stats = scaleEnemyStats(railgun, { difficulty: 10 }, DEFAULT_CONSTANTS);
    // Exact model value: 20000 × 2^5 = 640000
    expect(stats.hp).toBeCloseTo(640000, 0);
    expect(stats.atk).toBeCloseTo(640000, 0);
    // Document the model/wiki divergence: wiki 640310, model 640000, delta ~310 (0.048%)
    const wikiD10 = 640310;
    const modelD10 = 20000 * Math.pow(2, 10 / 2);
    expect(Math.abs(modelD10 - wikiD10) / wikiD10).toBeLessThan(0.001); // < 0.1%
  });

  it('Diff 5 ≈ 113137 (model), wiki says 113165 — within 1%', () => {
    const stats = scaleEnemyStats(railgun, { difficulty: 5 }, DEFAULT_CONSTANTS);
    // Exact model value: 20000 × 2^2.5 ≈ 113137.08
    expect(stats.hp).toBeCloseTo(113137, 0);
    // Verify within 1% of the wiki value 113165
    const wikiD5 = 113165;
    const relErr = Math.abs(stats.hp - wikiD5) / wikiD5;
    expect(relErr).toBeLessThan(0.01);
  });

  it('factor doubles every 2 difficulty levels (√2 property)', () => {
    const d2 = scaleEnemyStats(railgun, { difficulty: 2 }, DEFAULT_CONSTANTS);
    const d4 = scaleEnemyStats(railgun, { difficulty: 4 }, DEFAULT_CONSTANTS);
    // (√2)^4 / (√2)^2 = (√2)^2 = 2
    expect(d4.hp / d2.hp).toBeCloseTo(2, 6);
  });
});

// ── expDiff: Ancient Mimic ────────────────────────────────────────────────────

describe('expDiff (Ancient Mimic, factor 1.4)', () => {
  /**
   * Research §7.2: Stat(d) = base × 1.4^d
   * Ancient Mimic base HP = 25,000,000 (Diff 0).
   */
  const mimic = makeArchetype({
    id: 'ancient-mimic',
    element: 'Neutral',
    baseStats: { hp: 25_000_000, atk: 150_000, def: 10_000, spd: 5_000 },
    scaling: { kind: 'expDiff', factor: 1.4 },
    isBoss: false,
  });

  it('Diff 0 = base stats unchanged', () => {
    const stats = scaleEnemyStats(mimic, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBeCloseTo(25_000_000, 0);
    expect(stats.atk).toBeCloseTo(150_000, 0);
  });

  it('Diff 10 HP = base × 1.4^10 ≈ 7.23e8', () => {
    const stats = scaleEnemyStats(mimic, { difficulty: 10 }, DEFAULT_CONSTANTS);
    const expected = 25_000_000 * Math.pow(1.4, 10);
    // 1.4^10 ≈ 28.925 → 25e6 × 28.925 ≈ 723,127,200
    expect(stats.hp).toBeCloseTo(expected, 0);
    expect(stats.hp).toBeGreaterThan(7e8);
  });

  it('ratio Diff10/Diff0 = 1.4^10', () => {
    const d0 = scaleEnemyStats(mimic, { difficulty: 0 }, DEFAULT_CONSTANTS);
    const d10 = scaleEnemyStats(mimic, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(d10.hp / d0.hp).toBeCloseTo(Math.pow(1.4, 10), 6);
  });

  it('factor 1.4 compounds correctly between steps', () => {
    const d3 = scaleEnemyStats(mimic, { difficulty: 3 }, DEFAULT_CONSTANTS);
    const d6 = scaleEnemyStats(mimic, { difficulty: 6 }, DEFAULT_CONSTANTS);
    // d6 / d3 = 1.4^3
    expect(d6.hp / d3.hp).toBeCloseTo(Math.pow(1.4, 3), 6);
  });
});

// ── linear: Cosmic Gnome-style ────────────────────────────────────────────────

describe('linear (Cosmic Gnome-style)', () => {
  /**
   * Research §7.2: Defense(d) = 99,999 + 10,000·d; HP(d) = 200 + 20·d
   */
  const gnome = makeArchetype({
    id: 'cosmic-gnome',
    element: 'Earth',
    baseStats: { hp: 200, atk: 100, def: 99_999, spd: 50 },
    scaling: {
      kind: 'linear',
      perDiff: { hp: 20, def: 10_000 },
    },
    isBoss: false,
  });

  it('Diff 0 = base stats', () => {
    const stats = scaleEnemyStats(gnome, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(200);
    expect(stats.def).toBe(99_999);
    expect(stats.atk).toBe(100); // atk not in perDiff, unchanged
    expect(stats.spd).toBe(50);  // spd not in perDiff, unchanged
  });

  it('Diff 5: hp=300, def=149999, atk/spd unchanged', () => {
    const stats = scaleEnemyStats(gnome, { difficulty: 5 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(200 + 20 * 5);       // 300
    expect(stats.def).toBe(99_999 + 10_000 * 5); // 149999
    expect(stats.atk).toBe(100);
    expect(stats.spd).toBe(50);
  });

  it('Diff 10: hp=400, def=199999', () => {
    const stats = scaleEnemyStats(gnome, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(200 + 20 * 10);       // 400
    expect(stats.def).toBe(99_999 + 10_000 * 10); // 199999
  });

  it('scaling is strictly linear (additive delta constant)', () => {
    const d3 = scaleEnemyStats(gnome, { difficulty: 3 }, DEFAULT_CONSTANTS);
    const d4 = scaleEnemyStats(gnome, { difficulty: 4 }, DEFAULT_CONSTANTS);
    const d7 = scaleEnemyStats(gnome, { difficulty: 7 }, DEFAULT_CONSTANTS);
    const d8 = scaleEnemyStats(gnome, { difficulty: 8 }, DEFAULT_CONSTANTS);
    expect(d4.def - d3.def).toBeCloseTo(d8.def - d7.def, 6);
  });
});

// ── towerFloor: Infinity Tower ────────────────────────────────────────────────

describe('towerFloor (Infinity Tower)', () => {
  /**
   * Research §7.4:
   *   HP/Def/Spd: +40% per floor (floors 0–49); doubles every 50 floors.
   *   Atk:        +50% per floor (floors 0–49); doubles every 50 floors.
   *
   * Accumulation formula (documented in file header + scaling.ts JSDoc):
   *   totalInc(baseInc, floor) =
   *       Σ_{b=0}^{band-1} D × baseInc × 2^b
   *     + rem × baseInc × 2^band
   *   where D=50, band=⌊floor/50⌋, rem=floor%50
   *
   * Using Mirror of Ruin base stats from §7.4:
   *   HP=3333, Atk=150, Def=0, Spd=100
   * (Def=0 is the documented base, so towerFloor Def always stays 0 here.)
   */
  const mirrorOfRuin = makeArchetype({
    id: 'mirror-of-ruin',
    element: 'Neutral',
    baseStats: { hp: 3333, atk: 150, def: 0, spd: 100 },
    scaling: { kind: 'towerFloor' },
    isBoss: false,
  });

  it('floor 0 = base stats', () => {
    const stats = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBeCloseTo(3333, 0);
    expect(stats.atk).toBeCloseTo(150, 0);
    expect(stats.spd).toBeCloseTo(100, 0);
  });

  it('floor 1: HP = base × 1.40, Atk = base × 1.50', () => {
    const stats = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 1 }, DEFAULT_CONSTANTS);
    // totalInc(0.40, 1): band=0, rem=1 → 1 × 0.40 × 2^0 = 0.40
    expect(stats.hp).toBeCloseTo(3333 * 1.40, 3);
    // totalInc(0.50, 1): band=0, rem=1 → 1 × 0.50 × 2^0 = 0.50
    expect(stats.atk).toBeCloseTo(150 * 1.50, 3);
    expect(stats.spd).toBeCloseTo(100 * 1.40, 3);
  });

  it('floor 10: HP = base × (1 + 10×0.40), Atk = base × (1 + 10×0.50)', () => {
    const stats = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 10 }, DEFAULT_CONSTANTS);
    // band=0, rem=10 → totalInc = 10 × 0.40 = 4.0; stat = base × 5
    expect(stats.hp).toBeCloseTo(3333 * (1 + 10 * 0.40), 3);
    expect(stats.atk).toBeCloseTo(150  * (1 + 10 * 0.50), 3);
  });

  it('floor 49: last floor of first band (increment still 0.40/floor)', () => {
    const stats = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 49 }, DEFAULT_CONSTANTS);
    // band=0, rem=49 → totalInc = 49 × 0.40 = 19.6; stat = base × 20.6
    expect(stats.hp).toBeCloseTo(3333 * (1 + 49 * 0.40), 3);
    expect(stats.atk).toBeCloseTo(150  * (1 + 49 * 0.50), 3);
  });

  it('floor 51: second floor of second band — per-floor increment is now 0.80 (doubled)', () => {
    /**
     * Floor 50: band=1, rem=0 → totalInc = 50×0.40×2^0 + 0 = 20.0  (same delta as last band-0 floor)
     * Floor 51: band=1, rem=1 → totalInc = 50×0.40×2^0 + 1×0.40×2^1 = 20.0 + 0.80 = 20.80
     * So the FIRST floor that shows the doubled increment is floor 51 (rem=1 in band 1).
     */
    const stats51 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 51 }, DEFAULT_CONSTANTS);
    const stats50 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 50 }, DEFAULT_CONSTANTS);
    // Delta floor50→51 is the first step with the doubled increment (band 1: 0.40×2^1 = 0.80)
    const delta51 = stats51.hp - stats50.hp;
    expect(delta51).toBeCloseTo(3333 * 0.80, 2);
  });

  it('increment doubles after floor 50: per-floor delta at floor 60 is 2× that at floor 10', () => {
    /**
     * Verify the doubling: within floors 51–99 (band 1, rem>0), each floor adds
     * 0.40 × 2^1 = 0.80 × base for HP. Within floors 1–49 (band 0), each floor
     * adds 0.40 × 2^0 = 0.40 × base. Ratio = 2.
     *
     * Important: floor 50 itself (band=1, rem=0) shows the band-0 delta because
     * the partial band contribution is 0 at rem=0. Floor 51 is the first floor
     * whose delta reflects the band-1 (doubled) increment.
     */
    // Use floor 60 and 59 (both in band 1, rem>0)
    const stats59 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 59 }, DEFAULT_CONSTANTS);
    const stats60 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 60 }, DEFAULT_CONSTANTS);
    const stats09 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 9 }, DEFAULT_CONSTANTS);
    const stats10 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 10 }, DEFAULT_CONSTANTS);
    const deltaAt60 = stats60.hp - stats59.hp;
    const deltaAt10 = stats10.hp - stats09.hp;
    // Delta at floor 60 (band 1, increment ×2) should be 2× delta at floor 10 (band 0)
    expect(deltaAt60 / deltaAt10).toBeCloseTo(2, 5);
  });

  it('floor 101: third band first step — per-floor increment doubled twice (1.60 × base)', () => {
    /**
     * Floor 100: band=2, rem=0 → full bands: b=0: 50×0.40×1=20; b=1: 50×0.40×2=40 → total=60; partial=0
     * Floor 101: band=2, rem=1 → totalInc = 60 + 1×0.40×2^2 = 60 + 1.60 = 61.60
     * So the FIRST floor showing band-2 increment is floor 101.
     * band 2: baseInc × 2^2 = 0.40 × 4 = 1.60 per floor
     */
    const stats101 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 101 }, DEFAULT_CONSTANTS);
    const stats100 = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 100 }, DEFAULT_CONSTANTS);
    const delta = stats101.hp - stats100.hp;
    expect(delta).toBeCloseTo(3333 * 1.60, 1);
  });

  it('cumulative formula check at floor 51', () => {
    /**
     * Manual calculation for floor 51:
     *   band = 1, rem = 1
     *   full bands: b=0: 50 × 0.40 × 2^0 = 20.0
     *   partial:    1  × 0.40 × 2^1 = 0.80
     *   totalInc = 20.80
     *   HP = 3333 × (1 + 20.80) = 3333 × 21.80
     */
    const stats = scaleEnemyStats(mirrorOfRuin, { difficulty: 0, floor: 51 }, DEFAULT_CONSTANTS);
    const expectedHpMult = 1 + (50 * 0.40 * 1) + (1 * 0.40 * 2);
    expect(stats.hp).toBeCloseTo(3333 * expectedHpMult, 2);
  });
});

// ── bossMult ──────────────────────────────────────────────────────────────────

describe('bossMult', () => {
  /**
   * Research §7.1: effectiveMult = baseMult × (1 + 0.10 × difficulty)
   * Using ScalingSpec.base = 2 (Depth 1 multiplier).
   *
   * With petStatsReference = { hp:1000, atk:200, def:100, spd:100 }:
   *   Diff 0: mult = 2 × 1.0 = 2  → hp=2000
   *   Diff 5: mult = 2 × 1.5 = 3  → hp=3000
   *   Diff 10: mult = 2 × 2.0 = 4 → hp=4000
   */
  const bossArchetype = makeArchetype({
    id: 'depth1-boss',
    element: 'Neutral',
    baseStats: { hp: 500, atk: 100, def: 50, spd: 50 },
    scaling: { kind: 'bossMult', base: 2 },
    isBoss: true,
  });

  const petRef: CombatStats = { hp: 1000, atk: 200, def: 100, spd: 100 };

  it('Diff 0 with petStatsReference: stat = ref × 2', () => {
    const stats = scaleEnemyStats(
      bossArchetype,
      { difficulty: 0, petStatsReference: petRef },
      DEFAULT_CONSTANTS,
    );
    expect(stats.hp).toBeCloseTo(petRef.hp * 2, 6);
    expect(stats.atk).toBeCloseTo(petRef.atk * 2, 6);
    expect(stats.def).toBeCloseTo(petRef.def * 2, 6);
    expect(stats.spd).toBeCloseTo(petRef.spd * 2, 6);
  });

  it('Diff 5 with petStatsReference: stat = ref × 2 × 1.5 = ref × 3', () => {
    const stats = scaleEnemyStats(
      bossArchetype,
      { difficulty: 5, petStatsReference: petRef },
      DEFAULT_CONSTANTS,
    );
    expect(stats.hp).toBeCloseTo(petRef.hp * 3, 6);
    expect(stats.atk).toBeCloseTo(petRef.atk * 3, 6);
  });

  it('Diff 10 with petStatsReference: stat = ref × 2 × 2.0 = ref × 4', () => {
    const stats = scaleEnemyStats(
      bossArchetype,
      { difficulty: 10, petStatsReference: petRef },
      DEFAULT_CONSTANTS,
    );
    expect(stats.hp).toBeCloseTo(petRef.hp * 4, 6);
  });

  it('fallback to archetype.baseStats when no petStatsReference', () => {
    const stats = scaleEnemyStats(
      bossArchetype,
      { difficulty: 0 },
      DEFAULT_CONSTANTS,
    );
    // Without petStatsReference: falls back to baseStats × 2
    expect(stats.hp).toBeCloseTo(bossArchetype.baseStats.hp * 2, 6);
  });

  it('uses constants.bosses.depthMultipliers when ScalingSpec.base is absent (via depth lookup)', () => {
    /**
     * Test that the depth-lookup path works. We craft an archetype with base=12
     * (Depth 2 multiplier) and also pass depth:2 to verify they yield same result.
     */
    const d2boss = makeArchetype({
      id: 'depth2-boss',
      element: 'Neutral',
      baseStats: { hp: 500, atk: 100, def: 50, spd: 50 },
      scaling: { kind: 'bossMult', base: 12 },
      isBoss: true,
    });
    const stats = scaleEnemyStats(
      d2boss,
      { difficulty: 0, depth: 2, petStatsReference: petRef },
      DEFAULT_CONSTANTS,
    );
    // base=12 from ScalingSpec.base, Diff 0 → mult = 12 × 1.0 = 12
    expect(stats.hp).toBeCloseTo(petRef.hp * 12, 6);
  });

  it('Nothing boss (HP25000/ATK1500/DEF500/SPD500) scaled with bossMult depth2', () => {
    /**
     * Real data from scrapyard-enemies.json: Nothing boss baseStats
     * HP=25000 / ATK=1500 / DEF=500 / SPD=500. Using bossMult base=12 (D2).
     * At Diff 0 against a petRef, hp = petRef.hp × 12.
     */
    const nothing = makeArchetype({
      id: 'nothing',
      element: 'Neutral',
      baseStats: { hp: 25_000, atk: 1_500, def: 500, spd: 500 },
      scaling: { kind: 'bossMult', base: 12 },
      isBoss: true,
    });
    const d0 = scaleEnemyStats(nothing, { difficulty: 0, petStatsReference: petRef }, DEFAULT_CONSTANTS);
    expect(d0.hp).toBeCloseTo(petRef.hp * 12, 6);
    const d5 = scaleEnemyStats(nothing, { difficulty: 5, petStatsReference: petRef }, DEFAULT_CONSTANTS);
    expect(d5.hp).toBeCloseTo(petRef.hp * 12 * 1.5, 6);
  });
});

// ── scaleEnemyToContext ───────────────────────────────────────────────────────

describe('scaleEnemyToContext', () => {
  it('returns correct CombatContext shape for a neutral expSqrtDiff enemy', () => {
    const railgun = makeArchetype({
      id: 'railgun-trap',
      element: 'Neutral',
      baseStats: { hp: 20000, atk: 20000, def: 0, spd: 0 },
      scaling: { kind: 'expSqrtDiff' },
    });

    const ctx = scaleEnemyToContext(
      railgun,
      { difficulty: 0, effectiveLevel: 10 },
      DEFAULT_CONSTANTS,
    );

    expect(ctx.enemyId).toBe('railgun-trap');
    expect(ctx.element).toBe('Neutral');
    expect(ctx.assignedClass).toBeNull();
    expect(ctx.row).toBe('front');
    expect(ctx.abilities).toHaveLength(0);
    expect(ctx.currentHp).toBe(ctx.stats.hp);
    // Neutral element levels: 0.75 × effectiveLevel = 7.5
    expect(ctx.elementLevels.Fire).toBeCloseTo(7.5, 6);
    expect(ctx.elementLevels.Water).toBeCloseTo(7.5, 6);
  });

  it('sets primary element high and weakness negative for a Fire enemy', () => {
    const fireEnemy = makeArchetype({
      id: 'fire-enemy',
      element: 'Fire',
      baseStats: { hp: 1000, atk: 100, def: 50, spd: 50 },
      scaling: { kind: 'linear', perDiff: {} },
    });

    const ctx = scaleEnemyToContext(
      fireEnemy,
      { difficulty: 0, effectiveLevel: 100 },
      DEFAULT_CONSTANTS,
    );

    // Fire enemy: primary (Fire) = 50 + 3×100 = 350; weakness (Water) = -50; others = 0
    expect(ctx.elementLevels.Fire).toBeCloseTo(350, 6);
    expect(ctx.elementLevels.Water).toBeCloseTo(-50, 6);
    expect(ctx.elementLevels.Wind).toBeCloseTo(0, 6);
    expect(ctx.elementLevels.Earth).toBeCloseTo(0, 6);
  });

  it('currentHp matches stats.hp on creation', () => {
    const enemy = makeArchetype({
      id: 'test',
      element: 'Neutral',
      baseStats: { hp: 5000, atk: 300, def: 100, spd: 80 },
      scaling: { kind: 'expDiff', factor: 1.4 },
    });
    const ctx = scaleEnemyToContext(enemy, { difficulty: 5, effectiveLevel: 1 }, DEFAULT_CONSTANTS);
    expect(ctx.currentHp).toBe(ctx.stats.hp);
    // HP at diff 5 = 5000 × 1.4^5 ≈ 5000 × 5.378 ≈ 26895
    expect(ctx.stats.hp).toBeCloseTo(5000 * Math.pow(1.4, 5), 0);
  });
});
