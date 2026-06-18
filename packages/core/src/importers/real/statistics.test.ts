/**
 * Tests for the ITRTG Statistics-Export parser.
 * Reads the fixture file using Node's fs module (allowed in tests).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatisticsExport, toGlobalModifiers } from './statistics.js';
import type { WorldState } from './statistics.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'statistics.txt');

let ws: WorldState;

beforeAll(() => {
  const text = readFileSync(FIXTURE_PATH, 'utf-8');
  ws = parseStatisticsExport(text);
});

// ── NRDC completions ──────────────────────────────────────────────────────────

describe('parseStatisticsExport(): NRDC completions', () => {
  it('nrdcCompletions === 21', () => {
    expect(ws.nrdcCompletions).toBe(21);
  });
});

// ── Dojo ──────────────────────────────────────────────────────────────────────

describe('parseStatisticsExport(): Dojo', () => {
  it('dojo.attackPct === 99', () => {
    expect(ws.dojo.attackPct).toBe(99);
  });

  it('dojo.healthPct === 99', () => {
    expect(ws.dojo.healthPct).toBe(99);
  });

  it('dojo.speedPct === 98', () => {
    expect(ws.dojo.speedPct).toBe(98);
  });

  it('dojo.speedDamagePct === 65', () => {
    expect(ws.dojo.speedDamagePct).toBe(65);
  });

  it('dojo.dungeonExpPct === 100', () => {
    expect(ws.dojo.dungeonExpPct).toBe(100);
  });

  it('dojo.otherExpPct === 100', () => {
    expect(ws.dojo.otherExpPct).toBe(100);
  });

  it('dojo.elementPct.water === 5', () => {
    expect(ws.dojo.elementPct.water).toBe(5);
  });

  it('dojo.elementPct.fire === 5', () => {
    expect(ws.dojo.elementPct.fire).toBe(5);
  });

  it('dojo.physicalPct === 0', () => {
    expect(ws.dojo.physicalPct).toBe(0);
  });
});

// ── Strategy Room ─────────────────────────────────────────────────────────────

describe('parseStatisticsExport(): Strategy Room', () => {
  it('strategyRoom.strategyBooks === 81897', () => {
    expect(ws.strategyRoom.strategyBooks).toBe(81_897);
  });

  it('strategyRoom.fourthLowestGrowth === 144296', () => {
    expect(ws.strategyRoom.fourthLowestGrowth).toBe(144_296);
  });

  it('strategyRoom.health === 70469', () => {
    expect(ws.strategyRoom.health).toBe(70_469);
  });

  it('strategyRoom.attack === 8601', () => {
    expect(ws.strategyRoom.attack).toBe(8_601);
  });

  it('strategyRoom.defense === 2430', () => {
    expect(ws.strategyRoom.defense).toBe(2_430);
  });

  it('strategyRoom.speed === 5866', () => {
    expect(ws.strategyRoom.speed).toBe(5_866);
  });

  it('strategyRoom.elementPct.water ≈ 34.65', () => {
    expect(ws.strategyRoom.elementPct.water).toBeCloseTo(34.65, 1);
  });

  it('strategyRoom.elementPct.fire ≈ 35.24', () => {
    expect(ws.strategyRoom.elementPct.fire).toBeCloseTo(35.24, 1);
  });

  it('strategyRoom.elementPct.wind ≈ 33.7', () => {
    expect(ws.strategyRoom.elementPct.wind).toBeCloseTo(33.7, 1);
  });

  it('strategyRoom.elementPct.earth ≈ 35.41', () => {
    expect(ws.strategyRoom.elementPct.earth).toBeCloseTo(35.41, 1);
  });
});

// ── Challenge Points ──────────────────────────────────────────────────────────

describe('parseStatisticsExport(): Challenge Points', () => {
  it('challengePoints.dungeonDropBoostPct === 20', () => {
    expect(ws.challengePoints.dungeonDropBoostPct).toBe(20);
  });

  it('challengePoints.dungeonExpBoostPct === 20', () => {
    expect(ws.challengePoints.dungeonExpBoostPct).toBe(20);
  });

  it('challengePoints.d4BossRoom === 60', () => {
    expect(ws.challengePoints.d4BossRoom).toBe(60);
  });

  it('challengePoints.petStoneDropBoostPct === 2', () => {
    expect(ws.challengePoints.petStoneDropBoostPct).toBe(2);
  });
});

// ── Pet equip bonuses ─────────────────────────────────────────────────────────

describe('parseStatisticsExport(): Pet equip bonuses', () => {
  it('petEquipBonus.hpPct ≈ 3268.52', () => {
    expect(ws.petEquipBonus.hpPct).toBeCloseTo(3268.52, 1);
  });

  it('petEquipBonus.attackPct === 1950', () => {
    expect(ws.petEquipBonus.attackPct).toBe(1950);
  });
});

// ── Totals ────────────────────────────────────────────────────────────────────

describe('parseStatisticsExport(): Totals', () => {
  it('totals.unlockedPets === 126', () => {
    expect(ws.totals.unlockedPets).toBe(126);
  });

  it('totals.evolvedPets === 122', () => {
    expect(ws.totals.evolvedPets).toBe(122);
  });

  it('totals.totalDungeonLevels === 14595', () => {
    expect(ws.totals.totalDungeonLevels).toBe(14_595);
  });

  it('totals.petStones === 285061', () => {
    expect(ws.totals.petStones).toBe(285_061);
  });
});

// ── toGlobalModifiers ─────────────────────────────────────────────────────────

describe('toGlobalModifiers()', () => {
  it('returns a statMultiplier > 1 (Dojo buffs are active)', () => {
    const mods = toGlobalModifiers(ws);
    expect(mods.statMultiplier).toBeGreaterThan(1);
  });

  it('returns elementLevelMultiplier > 1 (Strategy Room element slots active)', () => {
    const mods = toGlobalModifiers(ws);
    expect(mods.elementLevelMultiplier).toBeGreaterThan(1);
  });

  it('statMultiplier ≈ 1 + avg(99,99,98)/100 ≈ 1.9867', () => {
    const mods = toGlobalModifiers(ws);
    const expected = 1 + (99 + 99 + 98) / 3 / 100;
    expect(mods.statMultiplier).toBeCloseTo(expected, 4);
  });
});
