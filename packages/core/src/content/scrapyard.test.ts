/**
 * Validation tests for the Scrapyard dungeon (and all standard dungeons) built
 * from real data (content/buildFromData.ts → data/enemies.json + dungeon-rosters.json).
 *
 * Test groups:
 *   1. Real enemy stats — spot-check known enemies against spreadsheet values.
 *   2. Dungeon shape — each standard dungeon conforms to the Dungeon type.
 *   3. Archetype integrity — no dangling enemyId references, boss flags correct.
 *   4. Registry — getDungeon returns all six registered dungeons.
 *   5. Scaling integration — scaleEnemyStats with real archetypes.
 *   6. All-dungeon invariants — every registered dungeon passes structural checks.
 */

import { describe, it, expect } from 'vitest';

import { getDungeon, DUNGEON_REGISTRY, ALL_ARCHETYPES } from './index.js';
import { scaleEnemyStats } from '../sim/scaling.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import type { Dungeon, Depth } from '../domain/dungeon.js';

// ── 1. Real enemy stats ───────────────────────────────────────────────────────

describe('Real enemy stats (from data/enemies.json)', () => {
  it('Slimy: hp=20, atk=1, def=1, spd=1, xpValue=2, isBoss=false', () => {
    const a = ALL_ARCHETYPES['Slimy'];
    expect(a).toBeDefined();
    expect(a!.baseStats.hp).toBe(20);
    expect(a!.baseStats.atk).toBe(1);
    expect(a!.baseStats.def).toBe(1);
    expect(a!.baseStats.spd).toBe(1);
    expect(a!.xpValue).toBe(2);
    expect(a!.isBoss).toBe(false);
  });

  it('AngelSlimy: hp=120, atk=15, def=8, spd=14, scaling 0.4/0.5', () => {
    const a = ALL_ARCHETYPES['AngelSlimy'];
    expect(a).toBeDefined();
    expect(a!.baseStats.hp).toBe(120);
    expect(a!.baseStats.atk).toBe(15);
    expect(a!.baseStats.def).toBe(8);
    expect(a!.baseStats.spd).toBe(14);
    expect(a!.xpValue).toBe(15);
    expect(a!.isBoss).toBe(false);
    // elementLevels from data
    expect(a!.elementLevels).toBeDefined();
    expect(a!.elementLevels!.Fire).toBe(10);
    expect(a!.elementLevels!.Water).toBe(10);
    expect(a!.elementLevels!.Wind).toBe(10);
    expect(a!.elementLevels!.Earth).toBe(10);
    // scaling: perDiff.hp = round(120 × 0.4) = 48, perDiff.atk = round(15 × 0.5) = 8
    expect(a!.scaling.kind).toBe('linear');
    if (a!.scaling.kind === 'linear') {
      expect(a!.scaling.perDiff.hp).toBe(48);
      expect(a!.scaling.perDiff.atk).toBe(8);
      expect(a!.scaling.perDiff.def).toBe(3);   // round(8 × 0.4) = 3
      expect(a!.scaling.perDiff.spd).toBe(6);   // round(14 × 0.4) = 6
    }
  });

  it('OozingInventor (Boss): hp=1000, atk=1, def=40, spd=30, isBoss=true', () => {
    const a = ALL_ARCHETYPES['OozingInventor (Boss)'];
    expect(a).toBeDefined();
    expect(a!.baseStats.hp).toBe(1000);
    expect(a!.baseStats.atk).toBe(1);
    expect(a!.baseStats.def).toBe(40);
    expect(a!.baseStats.spd).toBe(30);
    expect(a!.isBoss).toBe(true);
    expect(a!.xpValue).toBe(150);
  });

  it('Displacer: attackElement=Wind, elementLevels.Wind=150', () => {
    const a = ALL_ARCHETYPES['Displacer'];
    expect(a).toBeDefined();
    expect(a!.element).toBe('Wind');
    expect(a!.elementLevels!.Wind).toBe(150);
    expect(a!.elementLevels!.Fire).toBe(-40);
  });

  it('Scrapyard D4 enemy Nanobots: scaling=0, perDiff all zero', () => {
    const a = ALL_ARCHETYPES['Nanobots'];
    expect(a).toBeDefined();
    expect(a!.scaling.kind).toBe('linear');
    if (a!.scaling.kind === 'linear') {
      // scaling=0 and attackScaling=0 in data → no perDiff entries
      expect(a!.scaling.perDiff.hp ?? 0).toBe(0);
      expect(a!.scaling.perDiff.atk ?? 0).toBe(0);
    }
  });
});

// ── 2. Dungeon shapes ─────────────────────────────────────────────────────────

const VALID_ELEMENTS = new Set(['Fire', 'Water', 'Wind', 'Earth', 'Neutral']);
const VALID_SCALING_KINDS = new Set(['linear', 'expDiff', 'expSqrtDiff', 'towerFloor', 'bossMult']);

function checkDungeonShape(dungeon: Dungeon, depths: ReadonlyArray<Depth>) {
  expect(typeof dungeon.id).toBe('string');
  expect(VALID_ELEMENTS.has(dungeon.element)).toBe(true);
  expect(typeof dungeon.enemyTable).toBe('object');
  expect(typeof dungeon.archetypes).toBe('object');

  for (const depth of depths) {
    const table = dungeon.enemyTable[depth];
    if (table !== undefined) {
      expect(table.drawsPerRoom).toBeGreaterThan(0);
      expect(table.entries.length).toBeGreaterThan(0);
      for (const entry of table.entries) {
        expect(entry.weight).toBeGreaterThan(0);
        expect(entry.minCount).toBeGreaterThanOrEqual(1);
        expect(entry.maxCount).toBeGreaterThanOrEqual(entry.minCount);
        // All enemyIds in the table must resolve in archetypes
        expect(
          dungeon.archetypes[entry.enemyId],
          `enemyId "${entry.enemyId}" not in archetypes for ${dungeon.id} depth ${depth}`,
        ).toBeDefined();
      }
    }
    const bossId = dungeon.bossArchetypeId[depth];
    if (bossId !== undefined) {
      expect(
        dungeon.archetypes[bossId],
        `bossArchetypeId[${depth}] = "${bossId}" not in archetypes for ${dungeon.id}`,
      ).toBeDefined();
    }
  }

  // All archetypes have valid structure
  for (const [id, archetype] of Object.entries(dungeon.archetypes)) {
    expect(archetype.id).toBe(id);
    expect(VALID_ELEMENTS.has(archetype.element)).toBe(true);
    expect(VALID_SCALING_KINDS.has(archetype.scaling.kind)).toBe(true);
    expect(archetype.baseStats.hp).toBeGreaterThanOrEqual(0);
    expect(archetype.baseStats.atk).toBeGreaterThanOrEqual(0);
    expect(archetype.xpValue).toBeGreaterThanOrEqual(0);
  }
}

describe('Scrapyard dungeon — shape', () => {
  const dungeon = getDungeon('Scrapyard');

  it('is registered and has correct id/element', () => {
    expect(dungeon).toBeDefined();
    expect(dungeon!.id).toBe('Scrapyard');
    expect(dungeon!.element).toBe('Neutral');
  });

  it('has enemy tables for depths 1–4 with non-empty entries', () => {
    checkDungeonShape(dungeon!, [1, 2, 3, 4]);
  });

  it('D1 regular roster: AngelSlimy, MetalSlimy, NinjaSlimy, RoboSlimy, CyborgSlimy, GhostSlimy', () => {
    const entries = dungeon!.enemyTable[1]!.entries;
    const ids = entries.map(e => e.enemyId);
    // These are the non-boss D1 enemies (UnstableSlimy is also in D1)
    expect(ids).toContain('AngelSlimy');
    expect(ids).toContain('MetalSlimy');
    expect(ids).toContain('NinjaSlimy');
    expect(ids).toContain('RoboSlimy');
    expect(ids).toContain('CyborgSlimy');
    expect(ids).toContain('GhostSlimy');
  });

  it('D1 boss is OozingInventor (Boss)', () => {
    expect(dungeon!.bossArchetypeId[1]).toBe('OozingInventor (Boss)');
    expect(dungeon!.archetypes['OozingInventor (Boss)']!.isBoss).toBe(true);
  });

  it('D2 boss is MURDER (Boss)', () => {
    expect(dungeon!.bossArchetypeId[2]).toBe('MURDER (Boss)');
  });

  it('D3 boss is AlienWreckage (Boss) (first in roster)', () => {
    expect(dungeon!.bossArchetypeId[3]).toBe('AlienWreckage (Boss)');
  });

  it('D4 boss is YogSothoth (first boss-flagged entry in D4 roster)', () => {
    // YogSothoth has boss=true in the data, is first among bosses in D4 roster
    expect(dungeon!.bossArchetypeId[4]).toBe('YogSothoth');
    expect(dungeon!.archetypes['YogSothoth']!.isBoss).toBe(true);
  });

  it('D1 table does NOT contain boss (OozingInventor is not a regular entry)', () => {
    const ids = dungeon!.enemyTable[1]!.entries.map(e => e.enemyId);
    expect(ids).not.toContain('OozingInventor (Boss)');
  });

  it('every enemyId in every depth table resolves in archetypes', () => {
    for (const depth of [1, 2, 3, 4] as const) {
      const table = dungeon!.enemyTable[depth];
      if (table === undefined) continue;
      for (const entry of table.entries) {
        expect(dungeon!.archetypes[entry.enemyId]).toBeDefined();
      }
    }
  });
});

describe('WaterTemple dungeon — shape', () => {
  const dungeon = getDungeon('WaterTemple');
  it('registered with element Water', () => {
    expect(dungeon).toBeDefined();
    expect(dungeon!.element).toBe('Water');
  });
  it('has valid shape for depths 1–4', () => {
    checkDungeonShape(dungeon!, [1, 2, 3, 4]);
  });
  it('D1 boss is Godzilly (Boss)', () => {
    expect(dungeon!.bossArchetypeId[1]).toBe('Godzilly (Boss)');
  });
  it('D2 boss is Kraken (Boss)', () => {
    expect(dungeon!.bossArchetypeId[2]).toBe('Kraken (Boss)');
  });
  it('D4 boss is Cthulu (first boss by field in D4)', () => {
    expect(dungeon!.bossArchetypeId[4]).toBe('Cthulu');
  });
});

describe('Volcano dungeon — shape', () => {
  const dungeon = getDungeon('Volcano');
  it('registered with element Fire', () => {
    expect(dungeon).toBeDefined();
    expect(dungeon!.element).toBe('Fire');
  });
  it('has valid shape for depths 1–4', () => {
    checkDungeonShape(dungeon!, [1, 2, 3, 4]);
  });
  it('D1 boss is FireLord (Boss)', () => {
    expect(dungeon!.bossArchetypeId[1]).toBe('FireLord (Boss)');
  });
  it('D3 boss is SunSpirit (Boss)', () => {
    expect(dungeon!.bossArchetypeId[3]).toBe('SunSpirit (Boss)');
  });
});

describe('Mountain dungeon — shape', () => {
  const dungeon = getDungeon('Mountain');
  it('registered with element Wind', () => {
    expect(dungeon).toBeDefined();
    expect(dungeon!.element).toBe('Wind');
  });
  it('has valid shape for depths 1–4', () => {
    checkDungeonShape(dungeon!, [1, 2, 3, 4]);
  });
  it('D1 boss is ScreechingGralk (Boss)', () => {
    expect(dungeon!.bossArchetypeId[1]).toBe('ScreechingGralk (Boss)');
  });
});

describe('Forest dungeon — shape', () => {
  const dungeon = getDungeon('Forest');
  it('registered with element Earth', () => {
    expect(dungeon).toBeDefined();
    expect(dungeon!.element).toBe('Earth');
  });
  it('has valid shape for depths 1–4', () => {
    checkDungeonShape(dungeon!, [1, 2, 3, 4]);
  });
  it('D1 boss is GroveWarden (Boss)', () => {
    expect(dungeon!.bossArchetypeId[1]).toBe('GroveWarden (Boss)');
  });
  it('D4 boss is ShubNiggurath (first boss by field in D4)', () => {
    expect(dungeon!.bossArchetypeId[4]).toBe('ShubNiggurath');
  });
});

describe('NewbieGround dungeon — shape', () => {
  const dungeon = getDungeon('NewbieGround');
  it('registered with element Neutral', () => {
    expect(dungeon).toBeDefined();
    expect(dungeon!.element).toBe('Neutral');
  });
  it('has valid shape for depth 1', () => {
    checkDungeonShape(dungeon!, [1]);
  });
  it('D1 boss is RogueShadowClone (Boss)', () => {
    // First boss-name entry in Newbie Grounds1 roster
    expect(dungeon!.bossArchetypeId[1]).toBe('RogueShadowClone (Boss)');
  });
  it('regular enemies include Slimy, Frog, Chick, Tree, WalkingCandle', () => {
    const ids = dungeon!.enemyTable[1]!.entries.map(e => e.enemyId);
    expect(ids).toContain('Slimy');
    expect(ids).toContain('Frog');
    expect(ids).toContain('Chick');
    expect(ids).toContain('Tree');
    expect(ids).toContain('WalkingCandle');
  });
});

// ── 3. All-dungeon archetype integrity ────────────────────────────────────────

describe('All dungeons — archetype integrity (no dangling references)', () => {
  for (const [dungeonId, dungeon] of DUNGEON_REGISTRY) {
    it(`${dungeonId}: every enemyId and bossArchetypeId resolves in archetypes`, () => {
      for (const depth of [1, 2, 3, 4] as const) {
        const table = dungeon.enemyTable[depth];
        if (table !== undefined) {
          for (const entry of table.entries) {
            expect(
              dungeon.archetypes[entry.enemyId],
              `${dungeonId} D${depth}: enemyId "${entry.enemyId}" not in archetypes`,
            ).toBeDefined();
          }
        }
        const bossId = dungeon.bossArchetypeId[depth];
        if (bossId !== undefined) {
          expect(
            dungeon.archetypes[bossId],
            `${dungeonId} D${depth}: bossId "${bossId}" not in archetypes`,
          ).toBeDefined();
        }
      }
    });
  }
});

// ── 4. Registry ───────────────────────────────────────────────────────────────

describe('getDungeon registry', () => {
  it('getDungeon("Scrapyard") returns a dungeon with id "Scrapyard"', () => {
    const dungeon = getDungeon('Scrapyard');
    expect(dungeon).toBeDefined();
    expect(dungeon!.id).toBe('Scrapyard');
    expect(dungeon!.element).toBe('Neutral');
  });

  it('getDungeon("NewbieGround") returns the NewbieGround dungeon (now registered)', () => {
    expect(getDungeon('NewbieGround')).toBeDefined();
    expect(getDungeon('NewbieGround')!.id).toBe('NewbieGround');
  });

  it('getDungeon("WaterTemple") returns a dungeon', () => {
    expect(getDungeon('WaterTemple')).toBeDefined();
  });

  it('getDungeon("Volcano") returns a dungeon', () => {
    expect(getDungeon('Volcano')).toBeDefined();
  });

  it('getDungeon("Mountain") returns a dungeon', () => {
    expect(getDungeon('Mountain')).toBeDefined();
  });

  it('getDungeon("Forest") returns a dungeon', () => {
    expect(getDungeon('Forest')).toBeDefined();
  });

  it('getDungeon("InfinityTower:Fire") returns undefined (not yet implemented)', () => {
    expect(getDungeon('InfinityTower:Fire')).toBeUndefined();
  });

  it('DUNGEON_REGISTRY has exactly 6 entries', () => {
    expect(DUNGEON_REGISTRY.size).toBe(6);
  });
});

// ── 5. Scaling integration ────────────────────────────────────────────────────

describe('Scaling integration — scaleEnemyStats with real data-driven archetypes', () => {
  it('AngelSlimy (linear) at Diff 0 returns its exact baseStats', () => {
    const a = ALL_ARCHETYPES['AngelSlimy']!;
    const stats = scaleEnemyStats(a, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(120);
    expect(stats.atk).toBe(15);
    expect(stats.def).toBe(8);
    expect(stats.spd).toBe(14);
  });

  it('AngelSlimy at Diff 10: hp=120+48×10=600, atk=15+8×10=95', () => {
    const a = ALL_ARCHETYPES['AngelSlimy']!;
    const stats = scaleEnemyStats(a, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(120 + 48 * 10);   // 600
    expect(stats.atk).toBe(15 + 8 * 10);    // 95
    expect(stats.def).toBe(8 + 3 * 10);     // 38
    expect(stats.spd).toBe(14 + 6 * 10);    // 74
  });

  it('ScrapWorm at Diff 0 returns exact base: hp=650, atk=88, def=70, spd=65', () => {
    const a = ALL_ARCHETYPES['ScrapWorm']!;
    const stats = scaleEnemyStats(a, { difficulty: 0 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(650);
    expect(stats.atk).toBe(88);
    expect(stats.def).toBe(70);
    expect(stats.spd).toBe(65);
  });

  it('ScrapWorm scaling: perDiff.hp=round(650×0.3)=195, perDiff.atk=round(88×0.4)=35', () => {
    const a = ALL_ARCHETYPES['ScrapWorm']!;
    const stats = scaleEnemyStats(a, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(stats.hp).toBe(650 + 195 * 10);   // 2600
    expect(stats.atk).toBe(88 + 35 * 10);    // 438
  });

  it('Nanobots (scaling=0) at Diff 10 returns same as Diff 0', () => {
    const a = ALL_ARCHETYPES['Nanobots']!;
    const d0 = scaleEnemyStats(a, { difficulty: 0 }, DEFAULT_CONSTANTS);
    const d10 = scaleEnemyStats(a, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(d10.hp).toBe(d0.hp);
    expect(d10.atk).toBe(d0.atk);
  });

  it('D1 scaling: Diff 10 AngelSlimy is strictly stronger than Diff 0', () => {
    const a = ALL_ARCHETYPES['AngelSlimy']!;
    const d0  = scaleEnemyStats(a, { difficulty: 0 }, DEFAULT_CONSTANTS);
    const d10 = scaleEnemyStats(a, { difficulty: 10 }, DEFAULT_CONSTANTS);
    expect(d10.hp).toBeGreaterThan(d0.hp);
    expect(d10.atk).toBeGreaterThan(d0.atk);
  });
});
