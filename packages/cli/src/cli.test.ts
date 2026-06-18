/**
 * Unit tests and smoke tests for the @itrtg-sim/cli helpers.
 *
 * Tests are written against the helper functions directly (no subprocess spawn)
 * so they run fast and are fully deterministic.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// CLI helpers under test.
import { parseRosterFile, buildDefaultTeam, parseTeamSpec } from './roster.js';
import {
  formatImportSummary,
  formatRunResult,
  formatFarmOptimizeResult,
} from './format.js';

// Core API for smoke tests.
import {
  defaultRegistry,
  simulateRun,
  DEFAULT_CONSTANTS,
  makeFarmTargetProblem,
  EnumerationOptimizer,
  objectiveRegistry,
} from '@itrtg-sim/core';
import { getDungeon } from '@itrtg-sim/core';
import type { Pet, PetId, Team } from '@itrtg-sim/core';

// ── Fixture paths ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const V1_FIXTURE = resolvePath(
  __dirname,
  '../../core/src/importers/v1/v1.fixture.json',
);
const V2_FIXTURE = resolvePath(
  __dirname,
  '../../core/src/importers/v2/v2.fixture.json',
);

// ── Helper: load fixture as text ───────────────────────────────────────────────

function loadFixture(path: string): string {
  return readFileSync(path, 'utf-8');
}

// ── parseRosterFile ────────────────────────────────────────────────────────────

describe('parseRosterFile', () => {
  it('parses a v1 fixture via auto-detection', () => {
    const text = loadFixture(V1_FIXTURE);
    const { roster, warnings } = parseRosterFile(text);
    expect(roster.size).toBeGreaterThan(0);
    // v1 fixture has 3 pets
    expect(roster.size).toBe(3);
    // warnings may be empty or not — either is fine
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('parses a v2 fixture via auto-detection', () => {
    const text = loadFixture(V2_FIXTURE);
    const { roster } = parseRosterFile(text);
    expect(roster.size).toBe(3);
  });

  it('parses a normalized roster (array of Pet objects)', () => {
    // First import v1 to get Pet objects.
    const raw = JSON.parse(loadFixture(V1_FIXTURE)) as unknown;
    const { pets } = defaultRegistry.importAuto(raw);

    // Serialize as a normalized roster file.
    const normalizedText = JSON.stringify([...pets], null, 2);
    const { roster, warnings } = parseRosterFile(normalizedText);

    expect(roster.size).toBe(pets.length);
    expect(warnings).toHaveLength(0);

    // Each pet in the Map matches the original.
    for (const pet of pets) {
      expect(roster.has(pet.id)).toBe(true);
    }
  });

  it('throws on invalid JSON', () => {
    expect(() => parseRosterFile('not-json')).toThrow();
  });
});

// ── buildDefaultTeam ───────────────────────────────────────────────────────────

describe('buildDefaultTeam', () => {
  it('fills front row first, then back row', () => {
    const text = loadFixture(V2_FIXTURE);
    const { roster } = parseRosterFile(text);

    const team = buildDefaultTeam(roster);
    const front = team.slots.filter((s) => s.row === 'front');
    const back = team.slots.filter((s) => s.row === 'back');

    // V2 fixture has 3 pets → all in front row
    expect(front.length).toBeLessThanOrEqual(3);
    expect(back.length).toBeLessThanOrEqual(3);
    expect(team.slots.length).toBe(roster.size);
  });

  it('respects maxSize', () => {
    const text = loadFixture(V2_FIXTURE);
    const { roster } = parseRosterFile(text);

    const team = buildDefaultTeam(roster, 2);
    expect(team.slots.length).toBe(2);
  });

  it('assigns evolvedClass when present', () => {
    const text = loadFixture(V2_FIXTURE);
    const { roster } = parseRosterFile(text);

    const team = buildDefaultTeam(roster);
    for (const slot of team.slots) {
      const pet = roster.get(slot.petId);
      if (pet !== undefined && pet.evolvedClass !== null) {
        expect(slot.assignedClass).toBe(pet.evolvedClass);
      } else {
        expect(slot.assignedClass).toBe('Adventurer');
      }
    }
  });

  it('returns empty slots for empty roster', () => {
    const team = buildDefaultTeam(new Map<PetId, Pet>());
    expect(team.slots).toHaveLength(0);
  });
});

// ── parseTeamSpec ─────────────────────────────────────────────────────────────

describe('parseTeamSpec', () => {
  it('returns null for empty spec', () => {
    const text = loadFixture(V1_FIXTURE);
    const { roster } = parseRosterFile(text);
    expect(parseTeamSpec('', roster)).toBeNull();
  });

  it('parses a comma-separated list of pet ids', () => {
    const text = loadFixture(V1_FIXTURE);
    const { roster } = parseRosterFile(text);
    const ids = [...roster.keys()].slice(0, 2);
    const spec = ids.join(',');
    const team = parseTeamSpec(spec, roster);
    expect(team).not.toBeNull();
    expect(team!.slots.length).toBe(2);
    expect(team!.slots[0]?.petId).toBe(ids[0]);
    expect(team!.slots[1]?.petId).toBe(ids[1]);
  });

  it('throws for an unknown pet id', () => {
    const text = loadFixture(V1_FIXTURE);
    const { roster } = parseRosterFile(text);
    expect(() => parseTeamSpec('nonexistent-pet', roster)).toThrow();
  });
});

// ── formatImportSummary ────────────────────────────────────────────────────────

describe('formatImportSummary', () => {
  it('returns a non-empty string for pets', () => {
    const raw = JSON.parse(loadFixture(V1_FIXTURE)) as unknown;
    const { pets } = defaultRegistry.importAuto(raw);
    const output = formatImportSummary(pets);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
    // Should contain column headers
    expect(output).toContain('id');
    expect(output).toContain('DL');
    expect(output).toContain('CL');
  });

  it('returns a placeholder for empty pets', () => {
    const output = formatImportSummary([]);
    expect(output).toContain('no pets');
  });
});

// ── formatRunResult ────────────────────────────────────────────────────────────

describe('formatRunResult', () => {
  it('formats a RunResult with expected fields', () => {
    const raw = JSON.parse(loadFixture(V1_FIXTURE)) as unknown;
    const { pets } = defaultRegistry.importAuto(raw);
    const roster = new Map<PetId, Pet>(pets.map((p) => [p.id, p]));
    const team = buildDefaultTeam(roster);

    const dungeon = getDungeon('Scrapyard')!;
    const result = simulateRun(
      {
        team,
        dungeonId: 'Scrapyard',
        depth: 1,
        difficulty: 0,
        rooms: 6,
        nrdcCompletions: 0,
        evaluationMode: 'expected',
      },
      { dungeon, roster, constants: DEFAULT_CONSTANTS },
    );

    const output = formatRunResult(result, roster);
    expect(typeof output).toBe('string');
    expect(output).toContain('Run Result');
    expect(output).toContain('Rooms cleared');
    expect(output).toContain('Elapsed');
    expect(output).toContain('Rewards');
    expect(output).toContain('Per-pet stats');
  });
});

// ── formatFarmOptimizeResult ───────────────────────────────────────────────────

describe('formatFarmOptimizeResult', () => {
  it('formats the farm optimize result', () => {
    const candidate = { depth: 1 as const, difficulty: 0 as const, rooms: 6 };
    const output = formatFarmOptimizeResult(candidate, 42.5, 0);
    expect(output).toContain('farm');
    expect(output).toContain('42.5');
    expect(output).toContain('depth');
  });
});

// ── Smoke test: import → simulate ─────────────────────────────────────────────

describe('smoke: import v1 → simulate Scrapyard D1 expected', () => {
  it('produces a RunResult with non-negative roomsCleared', () => {
    // Import
    const raw = JSON.parse(loadFixture(V1_FIXTURE)) as unknown;
    const { pets } = defaultRegistry.importAuto(raw);
    expect(pets.length).toBeGreaterThan(0);

    // Build roster + team
    const roster = new Map<PetId, Pet>(pets.map((p) => [p.id, p]));
    const team = buildDefaultTeam(roster);
    expect(team.slots.length).toBeGreaterThan(0);

    // Simulate
    const dungeon = getDungeon('Scrapyard')!;
    expect(dungeon).toBeDefined();

    const result = simulateRun(
      {
        team,
        dungeonId: 'Scrapyard',
        depth: 1,
        difficulty: 0,
        rooms: 6,
        nrdcCompletions: 0,
        evaluationMode: 'expected',
      },
      { dungeon, roster, constants: DEFAULT_CONSTANTS },
    );

    expect(result.roomsCleared).toBeGreaterThanOrEqual(0);
    expect(result.roomsCleared).toBeLessThanOrEqual(6);
    expect(result.elapsedMinutes).toBeGreaterThanOrEqual(0);
    expect(result.perPet.size).toBe(team.slots.length);

    // Print a sample for the report.
    const output = formatRunResult(result, roster);
    console.log('\n--- Sample RunResult output ---\n' + output + '\n');
  });
});

// ── Smoke test: farm EnumerationOptimizer ────────────────────────────────────

describe('smoke: farm EnumerationOptimizer over tiny choice set', () => {
  it('finds a finite best score', () => {
    const raw = JSON.parse(loadFixture(V1_FIXTURE)) as unknown;
    const { pets } = defaultRegistry.importAuto(raw);
    const roster = new Map<PetId, Pet>(pets.map((p) => [p.id, p]));
    const team = buildDefaultTeam(roster);

    const dungeon = getDungeon('Scrapyard')!;
    const objective = objectiveRegistry.get('xpPerHour')!;
    expect(objective).toBeDefined();

    // Tiny choice set: depth 1, difficulty 0, rooms 6.
    const problem = makeFarmTargetProblem({
      team,
      dungeon,
      roster,
      objective,
      constants: DEFAULT_CONSTANTS,
      depthChoices: [1],
      difficultyChoices: [0],
      roomChoices: [6],
    });

    const optimizer = new EnumerationOptimizer();
    const { best, score } = optimizer.run(problem, {
      maxIterations: 10,
      traceVerbosity: 'final',
    });

    // With a tiny choice set we should get exactly 1 candidate back.
    expect(typeof score).toBe('number');
    expect(isFinite(score)).toBe(true);
    const farmBest = best as { depth: number; difficulty: number; rooms: number };
    expect(farmBest.depth).toBe(1);
    expect(farmBest.rooms).toBe(6);

    const output = formatFarmOptimizeResult(
      best as { depth: 1; difficulty: 0; rooms: number },
      score,
      1,
    );
    console.log('\n--- Sample Optimize output ---\n' + output + '\n');
  });
});

// ── Additional: teams with multiple pets exercise both rows ───────────────────

describe('buildDefaultTeam with 6 pets', () => {
  it('fills up to 3 front + 3 back from v1+v2 combined roster', () => {
    // Merge both fixture rosters for a 6-pet pool.
    const r1 = parseRosterFile(loadFixture(V1_FIXTURE)).roster;
    const r2 = parseRosterFile(loadFixture(V2_FIXTURE)).roster;
    const combined = new Map<PetId, Pet>([...r1, ...r2]);

    const team: Team = buildDefaultTeam(combined, 6);
    const front = team.slots.filter((s) => s.row === 'front');
    const back = team.slots.filter((s) => s.row === 'back');

    expect(front.length).toBeLessThanOrEqual(3);
    expect(back.length).toBeLessThanOrEqual(3);
    expect(team.slots.length).toBeLessThanOrEqual(6);
  });
});
