/**
 * Validation tests for the Scrapyard dungeon content module.
 *
 * Test groups:
 *   1. Dungeon shape — conforms to the `Dungeon` type, element is 'Neutral'.
 *   2. EnemyArchetype invariants — all archetypes have valid ScalingSpec kinds
 *      and non-negative baseStats / xpValue.
 *   3. Boss multiplier spot-checks — documented depth multipliers (D1≈2, D2≈12,
 *      D3≈70) are stored correctly in the bossMult specs.
 *   4. Registry — getDungeon('Scrapyard') returns the dungeon; unknown id → undefined.
 *   5. Scaling integration — scaleEnemyStats at difficulty 0 returns base stats
 *      (or expected scaled values) for key archetypes, proving the content plugs
 *      into the scaler.
 */

import { describe, it, expect } from 'vitest';

import {
  scrapyardDungeon,
  ALL_SCRAPYARD_ARCHETYPES,
  chameleonD1,
  chameleonD2,
  chameleonD3,
  nothingBoss,
  railgunTrap,
  metalSlimy,
} from './scrapyard.js';

import { getDungeon } from './index.js';
import { scaleEnemyStats } from '../sim/scaling.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import type { EnemyArchetype } from '../domain/enemy.js';
import type { Dungeon } from '../domain/dungeon.js';

// ── 1. Dungeon shape ──────────────────────────────────────────────────────────

describe('Scrapyard Dungeon — shape', () => {
  it('has id "Scrapyard"', () => {
    expect(scrapyardDungeon.id).toBe('Scrapyard');
  });

  it('element is "Neutral"', () => {
    expect(scrapyardDungeon.element).toBe('Neutral');
  });

  it('satisfies the Dungeon type (structural check)', () => {
    // TypeScript enforces this at compile time; at runtime we verify key fields.
    const dungeon: Dungeon = scrapyardDungeon;
    expect(typeof dungeon.id).toBe('string');
    expect(typeof dungeon.element).toBe('string');
    expect(typeof dungeon.enemyTable).toBe('object');
    expect(typeof dungeon.bossArchetypeId).toBe('object');
  });

  it('has boss archetype ids for depths 1, 2, 3, 4', () => {
    expect(scrapyardDungeon.bossArchetypeId[1]).toBeDefined();
    expect(scrapyardDungeon.bossArchetypeId[2]).toBeDefined();
    expect(scrapyardDungeon.bossArchetypeId[3]).toBeDefined();
    expect(scrapyardDungeon.bossArchetypeId[4]).toBeDefined();
  });

  it('bossArchetypeId depth 1 is "chameleon-d1"', () => {
    expect(scrapyardDungeon.bossArchetypeId[1]).toBe('chameleon-d1');
  });

  it('bossArchetypeId depth 2 is "chameleon-d2"', () => {
    expect(scrapyardDungeon.bossArchetypeId[2]).toBe('chameleon-d2');
  });

  it('enemyTable has entries for all four depths', () => {
    expect(scrapyardDungeon.enemyTable[1]).toBeDefined();
    expect(scrapyardDungeon.enemyTable[2]).toBeDefined();
    expect(scrapyardDungeon.enemyTable[3]).toBeDefined();
    expect(scrapyardDungeon.enemyTable[4]).toBeDefined();
  });

  it('each depth enemyTable has drawsPerRoom and non-empty entries', () => {
    for (const depth of [1, 2, 3, 4] as const) {
      const table = scrapyardDungeon.enemyTable[depth];
      expect(table).toBeDefined();
      expect(table!.drawsPerRoom).toBeGreaterThan(0);
      expect(table!.entries.length).toBeGreaterThan(0);
    }
  });

  it('all RoomEnemyEntry records have positive weight and non-negative counts', () => {
    for (const depth of [1, 2, 3, 4] as const) {
      const entries = scrapyardDungeon.enemyTable[depth]!.entries;
      for (const entry of entries) {
        expect(entry.weight).toBeGreaterThan(0);
        expect(entry.minCount).toBeGreaterThanOrEqual(1);
        expect(entry.maxCount).toBeGreaterThanOrEqual(entry.minCount);
      }
    }
  });

  it('D4 enemy table does NOT contain the railgun-trap (it is a hazard, not a drawn enemy)', () => {
    const d4Entries = scrapyardDungeon.enemyTable[4]!.entries;
    const ids = d4Entries.map(e => e.enemyId);
    expect(ids).not.toContain('railgun-trap');
  });
});

// ── 2. EnemyArchetype invariants ──────────────────────────────────────────────

const VALID_SCALING_KINDS = new Set([
  'linear',
  'expDiff',
  'expSqrtDiff',
  'towerFloor',
  'bossMult',
]);

describe('EnemyArchetype — invariants across all archetypes', () => {
  it('every archetype has a non-empty id', () => {
    for (const a of ALL_SCRAPYARD_ARCHETYPES) {
      expect(typeof a.id).toBe('string');
      expect(a.id.length).toBeGreaterThan(0);
    }
  });

  it('every archetype has a valid ScalingSpec kind', () => {
    for (const a of ALL_SCRAPYARD_ARCHETYPES) {
      expect(VALID_SCALING_KINDS.has(a.scaling.kind)).toBe(true);
    }
  });

  it('every archetype has non-negative baseStats', () => {
    for (const a of ALL_SCRAPYARD_ARCHETYPES) {
      expect(a.baseStats.hp).toBeGreaterThanOrEqual(0);
      expect(a.baseStats.atk).toBeGreaterThanOrEqual(0);
      expect(a.baseStats.def).toBeGreaterThanOrEqual(0);
      expect(a.baseStats.spd).toBeGreaterThanOrEqual(0);
    }
  });

  it('every archetype has a non-negative xpValue', () => {
    for (const a of ALL_SCRAPYARD_ARCHETYPES) {
      expect(a.xpValue).toBeGreaterThanOrEqual(0);
    }
  });

  it('bosses have isBoss=true; regular enemies have isBoss=false', () => {
    const bossIds = new Set([
      'chameleon-d1',
      'chameleon-d2',
      'chameleon-d3',
      'chameleon-d4',
      'nothing',
    ]);
    for (const a of ALL_SCRAPYARD_ARCHETYPES) {
      if (bossIds.has(a.id)) {
        expect(a.isBoss).toBe(true);
      } else {
        expect(a.isBoss).toBe(false);
      }
    }
  });

  it('all archetypes have a defined element', () => {
    const validElements = new Set(['Fire', 'Water', 'Wind', 'Earth', 'Neutral']);
    for (const a of ALL_SCRAPYARD_ARCHETYPES) {
      expect(validElements.has(a.element)).toBe(true);
    }
  });
});

// ── 3. Boss multiplier spot-checks ────────────────────────────────────────────

describe('Boss multipliers — documented values', () => {
  it('Chameleon D1: bossMult base = 2 (research §7.1)', () => {
    expect(chameleonD1.scaling.kind).toBe('bossMult');
    if (chameleonD1.scaling.kind === 'bossMult') {
      expect(chameleonD1.scaling.base).toBe(2);
    }
  });

  it('Chameleon D2: bossMult base = 12 (research §7.1)', () => {
    expect(chameleonD2.scaling.kind).toBe('bossMult');
    if (chameleonD2.scaling.kind === 'bossMult') {
      expect(chameleonD2.scaling.base).toBe(12);
    }
  });

  it('Chameleon D3: bossMult base = 70 (research §7.1)', () => {
    expect(chameleonD3.scaling.kind).toBe('bossMult');
    if (chameleonD3.scaling.kind === 'bossMult') {
      expect(chameleonD3.scaling.base).toBe(70);
    }
  });

  it('Nothing boss: bossMult base = 12 (D2 depth)', () => {
    expect(nothingBoss.scaling.kind).toBe('bossMult');
    if (nothingBoss.scaling.kind === 'bossMult') {
      expect(nothingBoss.scaling.base).toBe(12);
    }
  });

  it('Nothing boss has documented base stats: HP=25000, ATK=1500, DEF=500, SPD=500', () => {
    expect(nothingBoss.baseStats.hp).toBe(25_000);
    expect(nothingBoss.baseStats.atk).toBe(1_500);
    expect(nothingBoss.baseStats.def).toBe(500);
    expect(nothingBoss.baseStats.spd).toBe(500);
  });

  it('Railgun trap: scaling kind is expSqrtDiff', () => {
    expect(railgunTrap.scaling.kind).toBe('expSqrtDiff');
  });

  it('Railgun trap: has a railgun EnemySpecial with baseDamage=20000', () => {
    const specials = railgunTrap.specials ?? [];
    const railgunSpecial = specials.find(s => s.kind === 'railgun');
    expect(railgunSpecial).toBeDefined();
    if (railgunSpecial !== undefined && 'baseDamage' in railgunSpecial) {
      expect(railgunSpecial.baseDamage).toBe(20_000);
    }
  });

  it('Railgun trap: isBoss=false (it is a hazard)', () => {
    expect(railgunTrap.isBoss).toBe(false);
  });

  it('Railgun trap: xpValue=0 (traps grant no XP)', () => {
    expect(railgunTrap.xpValue).toBe(0);
  });
});

// ── 4. Registry ───────────────────────────────────────────────────────────────

describe('getDungeon registry', () => {
  it('getDungeon("Scrapyard") returns the Scrapyard dungeon', () => {
    const dungeon = getDungeon('Scrapyard');
    expect(dungeon).toBeDefined();
    expect(dungeon?.id).toBe('Scrapyard');
    expect(dungeon?.element).toBe('Neutral');
  });

  it('getDungeon returns the same object as the direct export', () => {
    expect(getDungeon('Scrapyard')).toBe(scrapyardDungeon);
  });

  it('getDungeon("NewbieGround") returns undefined (not yet registered)', () => {
    expect(getDungeon('NewbieGround')).toBeUndefined();
  });

  it('getDungeon("Mountain") returns undefined', () => {
    expect(getDungeon('Mountain')).toBeUndefined();
  });

  it('getDungeon("WaterTemple") returns undefined', () => {
    expect(getDungeon('WaterTemple')).toBeUndefined();
  });
});

// ── 4b. Archetype id integrity (no dangling references) ───────────────────────

describe('Scrapyard Dungeon — archetypes field integrity', () => {
  it('archetypes map is defined on scrapyardDungeon', () => {
    expect(scrapyardDungeon.archetypes).toBeDefined();
    expect(typeof scrapyardDungeon.archetypes).toBe('object');
  });

  it('every enemyId in every depth enemyTable entry resolves in archetypes', () => {
    for (const depth of [1, 2, 3, 4] as const) {
      const table = scrapyardDungeon.enemyTable[depth];
      if (table === undefined) continue;
      for (const entry of table.entries) {
        expect(
          scrapyardDungeon.archetypes[entry.enemyId],
          `enemyId "${entry.enemyId}" at depth ${depth} is missing from archetypes`,
        ).toBeDefined();
      }
    }
  });

  it('every bossArchetypeId value resolves in archetypes', () => {
    for (const [depth, bossId] of Object.entries(scrapyardDungeon.bossArchetypeId)) {
      if (bossId === undefined) continue;
      expect(
        scrapyardDungeon.archetypes[bossId],
        `bossArchetypeId[${depth}] = "${bossId}" is missing from archetypes`,
      ).toBeDefined();
    }
  });

  it('archetypes map contains ALL_SCRAPYARD_ARCHETYPES (one entry per archetype)', () => {
    for (const archetype of ALL_SCRAPYARD_ARCHETYPES) {
      expect(
        scrapyardDungeon.archetypes[archetype.id],
        `archetype "${archetype.id}" is not in the archetypes map`,
      ).toBe(archetype);
    }
  });
});

// ── 5. Scaling integration ────────────────────────────────────────────────────

describe('Scaling integration — scaleEnemyStats with Scrapyard archetypes', () => {
  /**
   * For `linear` scaling at difficulty 0:
   *   stat = base + perDiff × 0 = base
   * So scaleEnemyStats(enemy, { difficulty: 0 }) should return exact baseStats.
   */
  it('Metal Slimy (linear) at Diff 0 returns its exact baseStats', () => {
    const stats = scaleEnemyStats(metalSlimy, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(metalSlimy.baseStats.hp);
    expect(stats.atk).toBe(metalSlimy.baseStats.atk);
    expect(stats.def).toBe(metalSlimy.baseStats.def);
    expect(stats.spd).toBe(metalSlimy.baseStats.spd);
  });

  it('Metal Slimy (linear) at Diff 5 scales correctly', () => {
    const stats = scaleEnemyStats(metalSlimy, { difficulty: 5 }, DEFAULT_CONSTANTS);
    if (metalSlimy.scaling.kind === 'linear') {
      const pd = metalSlimy.scaling.perDiff;
      expect(stats.hp).toBeCloseTo(metalSlimy.baseStats.hp + (pd.hp ?? 0) * 5, 6);
      expect(stats.atk).toBeCloseTo(metalSlimy.baseStats.atk + (pd.atk ?? 0) * 5, 6);
    }
  });

  /**
   * For `bossMult` scaling at difficulty 0 WITHOUT a petStatsReference:
   *   effectiveMult = base × (1 + 0.10 × 0) = base × 1.0 = base
   *   stat = baseStats[stat] × base
   *
   * Chameleon D1: base=2, so stat = baseStats × 2.
   */
  it('Chameleon D1 (bossMult base=2) at Diff 0 returns baseStats × 2', () => {
    const stats = scaleEnemyStats(chameleonD1, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBeCloseTo(chameleonD1.baseStats.hp * 2, 6);
    expect(stats.atk).toBeCloseTo(chameleonD1.baseStats.atk * 2, 6);
  });

  /**
   * Nothing boss: bossMult base=12.
   * At Diff 0 without petStatsReference: stat = baseStats × 12.
   */
  it('Nothing boss (bossMult base=12) at Diff 0 returns baseStats × 12', () => {
    const stats = scaleEnemyStats(nothingBoss, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBeCloseTo(nothingBoss.baseStats.hp * 12, 6);
    expect(stats.atk).toBeCloseTo(nothingBoss.baseStats.atk * 12, 6);
  });

  /**
   * Railgun trap (expSqrtDiff):
   *   stat(d) = base × (√2)^d = base × 2^(d/2)
   * At Diff 0: stat = base × 1 = base.
   */
  it('Railgun trap (expSqrtDiff) at Diff 0 returns its sentinel baseStats', () => {
    const stats = scaleEnemyStats(railgunTrap, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBeCloseTo(railgunTrap.baseStats.hp, 6); // sentinel = 1
    expect(stats.atk).toBe(0);
  });

  it('Railgun trap (expSqrtDiff) at Diff 10: base.atk × 2^5 = 0 (sentinel)', () => {
    // ATK sentinel = 0, so scaled value stays 0.
    const stats = scaleEnemyStats(railgunTrap, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(stats.atk).toBe(0);
  });

  /**
   * Verify the documented Railgun damage scaling via the baseDamage in specials
   * combined with the expSqrtDiff scaler against a hypothetical archetype matching
   * the documented baseDamage=20000.
   *
   * This mirrors the test in sim/scaling.test.ts to confirm our archetype's
   * scaling kind interacts with the scaler the same way.
   */
  it('expSqrtDiff model: 20000 × 2^(10/2) = 640000 (within 0.1% of wiki 640310)', () => {
    const hypotheticalRailgun: EnemyArchetype = {
      ...railgunTrap,
      baseStats: { hp: 20_000, atk: 20_000, def: 0, spd: 0 },
    };
    const stats = scaleEnemyStats(hypotheticalRailgun, { difficulty: 10 }, DEFAULT_CONSTANTS);
    const expected = 20_000 * Math.pow(2, 10 / 2); // = 640000
    expect(stats.hp).toBeCloseTo(expected, 0);
    // Within 0.1% of the wiki-documented value 640310
    expect(Math.abs(stats.hp - 640_310) / 640_310).toBeLessThan(0.001);
  });

  /**
   * Chameleon D3 (bossMult base=70) at Diff 0 with petStatsReference:
   *   effectiveMult = 70 × 1.0 = 70
   *   stat = ref × 70
   */
  it('Chameleon D3 (bossMult base=70) scales by ×70 against a petStatsReference at Diff 0', () => {
    const petRef = { hp: 1_000, atk: 200, def: 100, spd: 100 };
    const stats = scaleEnemyStats(
      chameleonD3,
      { difficulty: 0, petStatsReference: petRef },
      DEFAULT_CONSTANTS,
    );
    expect(stats.hp).toBeCloseTo(petRef.hp * 70, 6);
    expect(stats.atk).toBeCloseTo(petRef.atk * 70, 6);
  });

  /**
   * Confirm +10% additive per difficulty level on bossMult.
   * Chameleon D1, Diff 5: effectiveMult = 2 × (1 + 0.10 × 5) = 2 × 1.5 = 3.
   */
  it('Chameleon D1 at Diff 5 scales by ×2×1.5=3 against a petStatsReference', () => {
    const petRef = { hp: 1_000, atk: 200, def: 100, spd: 100 };
    const stats = scaleEnemyStats(
      chameleonD1,
      { difficulty: 5, petStatsReference: petRef },
      DEFAULT_CONSTANTS,
    );
    expect(stats.hp).toBeCloseTo(petRef.hp * 3, 6);
  });
});
