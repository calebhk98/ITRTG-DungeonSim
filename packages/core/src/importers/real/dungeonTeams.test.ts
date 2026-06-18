/**
 * Tests for the ITRTG Dungeon-Teams export parser.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectDungeonTeams,
  parseDungeonTeams,
  resolveDungeonTeams,
} from './dungeonTeams.js';
import type { ParsedDungeonTeams } from './dungeonTeams.js';
import { asPetId } from '../../domain/ids.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'dungeonTeams.txt');

let fixture: string;
let parsed: ParsedDungeonTeams;

beforeAll(() => {
  fixture = readFileSync(FIXTURE_PATH, 'utf-8');
  parsed = parseDungeonTeams(fixture);
});

// ── detectDungeonTeams ────────────────────────────────────────────────────────

describe('detectDungeonTeams()', () => {
  it('returns 0.99 for fixture text', () => {
    expect(detectDungeonTeams(fixture)).toBe(0.99);
  });

  it('returns 0 for non-string', () => {
    expect(detectDungeonTeams(42)).toBe(0);
    expect(detectDungeonTeams(null)).toBe(0);
    expect(detectDungeonTeams({})).toBe(0);
  });

  it('returns 0 for unrelated string', () => {
    expect(detectDungeonTeams('Name;Element;Growth')).toBe(0);
  });
});

// ── parseDungeonTeams: structure ─────────────────────────────────────────────

describe('parseDungeonTeams(): structure', () => {
  it('parses 5 teams from fixture', () => {
    expect(parsed.teams).toHaveLength(5);
  });

  it('produces no warnings on valid fixture', () => {
    expect(parsed.warnings).toHaveLength(0);
  });

  it('teams are in teamIndex order', () => {
    const indices = parsed.teams.map(t => t.teamIndex);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });

  it('each team has 6 slots', () => {
    for (const team of parsed.teams) {
      expect(team.slots).toHaveLength(6);
    }
  });

  it('slots within each team are in position order', () => {
    for (const team of parsed.teams) {
      const positions = team.slots.map(s => s.position);
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);
    }
  });
});

// ── parseDungeonTeams: team 0 ─────────────────────────────────────────────────

describe('parseDungeonTeams(): team 0 (Scrapyard)', () => {
  it('team 0 has correct pet names', () => {
    const names = parsed.teams[0]!.slots.map(s => s.petName);
    expect(names).toEqual(expect.arrayContaining(['Cat', 'Dog', 'Tanuki', 'Nothing', 'Ghost', 'Carno']));
    expect(names).toHaveLength(6);
  });

  it('Cat is in position 1 (front row)', () => {
    const cat = parsed.teams[0]!.slots.find(s => s.petName === 'Cat');
    expect(cat?.position).toBe(1);
    expect(cat?.row).toBe('front');
  });

  it('Carno is in position 3 (front row)', () => {
    const carno = parsed.teams[0]!.slots.find(s => s.petName === 'Carno');
    expect(carno?.position).toBe(3);
    expect(carno?.row).toBe('front');
  });

  it('Tanuki is in position 4 (back row)', () => {
    const tanuki = parsed.teams[0]!.slots.find(s => s.petName === 'Tanuki');
    expect(tanuki?.position).toBe(4);
    expect(tanuki?.row).toBe('back');
  });

  it('Ghost is in position 6 (back row)', () => {
    const ghost = parsed.teams[0]!.slots.find(s => s.petName === 'Ghost');
    expect(ghost?.position).toBe(6);
    expect(ghost?.row).toBe('back');
  });
});

// ── parseDungeonTeams: team 1 ─────────────────────────────────────────────────

describe('parseDungeonTeams(): team 1 (Water Temple)', () => {
  it('team 1 contains Undine, Witch, Alien, MistSphere, BlackTortoise, Clam', () => {
    const names = parsed.teams[1]!.slots.map(s => s.petName);
    expect(names).toEqual(
      expect.arrayContaining(['Undine', 'Witch', 'Alien', 'MistSphere', 'BlackTortoise', 'Clam']),
    );
  });

  it('Undine is in position 1 (front)', () => {
    const undine = parsed.teams[1]!.slots.find(s => s.petName === 'Undine');
    expect(undine?.row).toBe('front');
  });
});

// ── parseDungeonTeams: team 4 ─────────────────────────────────────────────────

describe('parseDungeonTeams(): team 4 (Forest)', () => {
  it('Gnome is in position 1 (front)', () => {
    const gnome = parsed.teams[4]!.slots.find(s => s.petName === 'Gnome');
    expect(gnome?.position).toBe(1);
    expect(gnome?.row).toBe('front');
  });

  it('Crocodile is in position 6 (back)', () => {
    const croc = parsed.teams[4]!.slots.find(s => s.petName === 'Crocodile');
    expect(croc?.position).toBe(6);
    expect(croc?.row).toBe('back');
  });
});

// ── parseDungeonTeams: edge cases ─────────────────────────────────────────────

describe('parseDungeonTeams(): edge cases', () => {
  it('returns empty teams with warning if marker absent', () => {
    const result = parseDungeonTeams('some unrelated text');
    expect(result.teams).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/marker not found/i);
  });

  it('skips malformed entries (no colon)', () => {
    const text = '---DungeonTeamsStart---\nnoColon;---DungeonTeamsEnd---';
    const result = parseDungeonTeams(text);
    expect(result.teams).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('no colon'))).toBe(true);
  });

  it('skips slots with invalid positions', () => {
    const text = '---DungeonTeamsStart---\n0:Cat=7,Dog=1,;---DungeonTeamsEnd---';
    const result = parseDungeonTeams(text);
    expect(result.teams[0]!.slots).toHaveLength(1);
    expect(result.warnings.some(w => w.includes('invalid position'))).toBe(true);
  });
});

// ── resolveDungeonTeams ───────────────────────────────────────────────────────

describe('resolveDungeonTeams()', () => {
  it('resolves all teams when all names are in the map', () => {
    const allNames = parsed.teams.flatMap(t => t.slots.map(s => s.petName));
    const nameToId = new Map(allNames.map(n => [n, asPetId(n)]));

    const result = resolveDungeonTeams(parsed, nameToId);
    expect(result.teams).toHaveLength(5);
    expect(result.warnings).toHaveLength(0);

    for (const { team } of result.teams) {
      expect(team.slots).toHaveLength(6);
      for (const slot of team.slots) {
        expect(slot.assignedClass).toBeNull();
        expect(typeof slot.petId).toBe('string');
      }
    }
  });

  it('skips and warns for names not in the map', () => {
    const nameToId = new Map([['Cat', asPetId('Cat')]]);
    const result = resolveDungeonTeams(parsed, nameToId);

    // Only Cat can be resolved; all other slots across all teams are skipped
    const team0 = result.teams[0]!.team;
    expect(team0.slots).toHaveLength(1);
    expect(team0.slots[0]!.petId).toBe(asPetId('Cat'));
    expect(result.warnings.some(w => w.includes('not found in roster'))).toBe(true);
  });

  it('preserves teamIndex order', () => {
    const nameToId = new Map<string, ReturnType<typeof asPetId>>();
    const result = resolveDungeonTeams(parsed, nameToId);
    expect(result.teams.map(t => t.teamIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});
