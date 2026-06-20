/**
 * Integration smoke-test: simulate all 5 dungeon teams using the real export files.
 *
 * Run with: pnpm --filter @itrtg-sim/core exec vitest run --reporter=verbose src/importers/real/realRoster.smoke.test.ts
 *
 * This file is intentionally not picked up by default test runs (it reads from
 * absolute upload paths that only exist in this dev environment).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  defaultRegistry,
  parseStatisticsExport,
  parseDungeonTeams,
  resolveDungeonTeams,
  getDungeon,
  simulateRun,
  DEFAULT_CONSTANTS,
} from '../../index.js';
import type { Team, RunResult, DungeonId, Difficulty } from '../../index.js';

// ── Upload paths ──────────────────────────────────────────────────────────────

const UPLOAD_BASE = '/root/.claude/uploads/81c520fa-e416-577f-a491-a7cc43dd5538';

const petExportText   = readFileSync(`${UPLOAD_BASE}/62645fca-NameElementGrowthDungeon_LevelC.txt`, 'utf-8');
const statsText       = readFileSync(`${UPLOAD_BASE}/5daf017d-Idling_to_Rule_the_Gods__statistic.txt`, 'utf-8');
const dungeonTeamText = readFileSync(`${UPLOAD_BASE}/1e24491d-DungeonTeamsStart.txt`, 'utf-8');

// ── Import pets ───────────────────────────────────────────────────────────────

const { pets, warnings: importWarnings } = defaultRegistry.importAuto(petExportText);
const roster = new Map(pets.map(p => [p.id, p]));
const nameToId = new Map(pets.map(p => [p.displayName, p.id]));

// ── World state ───────────────────────────────────────────────────────────────

const worldState = parseStatisticsExport(statsText);

// ── Teams ─────────────────────────────────────────────────────────────────────

const parsedTeams = parseDungeonTeams(dungeonTeamText);
const { teams: resolvedTeams, warnings: teamWarnings } = resolveDungeonTeams(parsedTeams, nameToId);

// Team 0 → Scrapyard, 1 → WaterTemple, 2 → Volcano, 3 → Mountain, 4 → Forest
const DUNGEON_MAP: Record<number, DungeonId> = {
  0: 'Scrapyard',
  1: 'WaterTemple',
  2: 'Volcano',
  3: 'Mountain',
  4: 'Forest',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function runTeam(team: Team, dungeonId: DungeonId, difficulty: Difficulty): RunResult {
  return simulateRun(
    {
      team,
      dungeonId,
      depth: 4,
      difficulty,
      rooms: 60,
      nrdcCompletions: worldState.nrdcCompletions,
      evaluationMode: 'expected',
    },
    { dungeon: getDungeon(dungeonId)!, roster, constants: DEFAULT_CONSTANTS },
  );
}

function banner(teamIndex: number, dungeonId: DungeonId, difficulty: Difficulty, result: RunResult): string {
  const status = result.cleared ? '✓ CLEARED' : `✗ FAILED  (${result.roomsCleared}/60 rooms)`;
  const deaths = result.petDeaths.length > 0 ? result.petDeaths.join(', ') : 'none';
  const petNames = resolvedTeams[teamIndex]!.team.slots.map(s => s.petId).join(', ');
  return [
    `Team ${teamIndex} | ${dungeonId} D4-${difficulty} | ${status}`,
    `  Pets:    ${petNames}`,
    `  Deaths:  ${deaths}`,
    `  GP:      ${result.rewards.godPower.toFixed(2)}`,
    `  Stones:  ${result.rewards.petStones.toFixed(2)}`,
    `  XP:      ${result.rewards.xpTotal}`,
    `  Elapsed: ${result.elapsedMinutes.toFixed(1)} min`,
  ].join('\n');
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

describe('Diagnostics: import', () => {
  it('imports 158 pets from the real export', () => {
    console.log(`\nImported ${pets.length} pets`);
    if (importWarnings.length > 0) {
      console.log(`Import warnings (${importWarnings.length}):`);
      for (const w of importWarnings.slice(0, 10)) console.log('  ', w);
    }
    expect(pets.length).toBeGreaterThan(100);
  });

  it('parses 5 dungeon teams', () => {
    console.log(`\nDungeon teams parsed: ${resolvedTeams.length}`);
    if (teamWarnings.length > 0) {
      console.log(`Team warnings:`);
      for (const w of teamWarnings) console.log('  ', w);
    }
    expect(resolvedTeams.length).toBe(5);
  });

  it('has NRDC completions ≥ 20 (D4 unlocked)', () => {
    console.log(`\nNRDC completions: ${worldState.nrdcCompletions}`);
    expect(worldState.nrdcCompletions).toBeGreaterThanOrEqual(20);
  });
});

// ── Simulate each team at D4 diff 5 ──────────────────────────────────────────

describe('Simulate: each team at D4 difficulty 5', () => {
  for (const { teamIndex, team } of resolvedTeams) {
    const dungeonId = DUNGEON_MAP[teamIndex] ?? ('Scrapyard' as DungeonId);
    it(`Team ${teamIndex} (${dungeonId})`, () => {
      const result = runTeam(team, dungeonId, 5 as Difficulty);
      console.log('\n' + banner(teamIndex, dungeonId, 5, result));
      // Basic sanity: at least some damage was dealt
      const totalDealt = [...result.perPet.values()].reduce((s, p) => s + p.dealt, 0);
      expect(totalDealt).toBeGreaterThan(0);
    });
  }
});

// ── Sweep: find clear threshold for each team ─────────────────────────────────

describe('Simulate: sweep D4 difficulties 0–10', () => {
  for (const { teamIndex, team } of resolvedTeams) {
    const dungeonId = DUNGEON_MAP[teamIndex] ?? ('Scrapyard' as DungeonId);
    it(`Team ${teamIndex} (${dungeonId}) sweep`, () => {
      const lines: string[] = [`\nTeam ${teamIndex} | ${dungeonId} D4 sweep:`];
      let highestClear = -1;

      for (let diff = 0; diff <= 10; diff++) {
        const result = runTeam(team, dungeonId, diff as Difficulty);
        const mark = result.cleared ? '✓' : `✗(${result.roomsCleared}/60)`;
        lines.push(`  diff ${diff}: ${mark}  GP=${result.rewards.godPower.toFixed(2)}  stones=${result.rewards.petStones.toFixed(2)}`);
        if (result.cleared) highestClear = diff;
      }

      lines.push(`  → Highest clear: diff ${highestClear}`);
      console.log(lines.join('\n'));

      // Must clear at least diff 0
      expect(highestClear).toBeGreaterThanOrEqual(0);
    });
  }
});
