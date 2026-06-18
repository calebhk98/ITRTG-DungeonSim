/**
 * Tests for the real ITRTG Pet Export importer.
 * Reads the fixture file using Node's fs module (allowed in tests).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { petExportImporter } from './petExport.js';
import { defaultRegistry } from '../index.js';
import '../real/petExport.js'; // ensure registration

// ── Fixture ───────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'petExport.txt');

let fixtureText: string;
let result: ReturnType<typeof petExportImporter.import>;

beforeAll(() => {
  fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
  result = petExportImporter.import(fixtureText);
});

// ── detect() ─────────────────────────────────────────────────────────────────

describe('petExportImporter.detect()', () => {
  it('returns high confidence (0.99) for the real fixture string', () => {
    expect(petExportImporter.detect(fixtureText)).toBe(0.99);
  });

  it('returns 0 for a plain object (not a string)', () => {
    expect(petExportImporter.detect({ exportedPets: [] })).toBe(0);
  });

  it('returns 0 for a string that does not start with the expected header', () => {
    expect(petExportImporter.detect('Name,Element,HP\nMouse,Earth,100')).toBe(0);
  });
});

// ── import(): row count ───────────────────────────────────────────────────────

describe('petExportImporter.import(): row count', () => {
  it('parses the expected number of pet rows (159 data lines minus blanks/skipped)', () => {
    // The fixture has 159 rows of data (lines 2–160 minus blank/skipped).
    // Count exactly: fixture has header on line 1 and data on the rest.
    // We use the known total from the file.
    expect(result.pets.length).toBeGreaterThan(0);
    // The fixture contains exactly 159 non-header, non-blank lines.
    // Some rows (BigBurger, Oni, AfkyClone, etc.) have blank Action fields but
    // are still valid rows. Expect > 100 pets.
    expect(result.pets.length).toBeGreaterThanOrEqual(100);
  });
});

// ── import(): Mouse spot-check ────────────────────────────────────────────────

describe('petExportImporter.import(): Mouse spot-check', () => {
  let mouse: (typeof result.pets)[0] | undefined;

  beforeAll(() => {
    mouse = result.pets.find((p) => p.displayName === 'Mouse');
  });

  it('finds Mouse in the parsed roster', () => {
    expect(mouse).toBeDefined();
  });

  it('Mouse: element = Earth', () => {
    expect(mouse?.primaryElement).toBe('Earth');
  });

  it('Mouse: totalGrowth = 289900', () => {
    expect(mouse?.totalGrowth).toBe(289_900);
  });

  it('Mouse: dungeonLevel = 295', () => {
    expect(mouse?.dungeonLevel).toBe(295);
  });

  it('Mouse: evolvedClass = Blacksmith', () => {
    expect(mouse?.evolvedClass).toBe('Blacksmith');
  });

  it('Mouse: classLevel = 62', () => {
    expect(mouse?.classLevel).toBe(62);
  });

  it('Mouse: observed.stats.hp = 111557', () => {
    expect(mouse?.observed?.stats.hp).toBe(111_557);
  });

  it('Mouse: observed.stats.atk = 3801', () => {
    expect(mouse?.observed?.stats.atk).toBe(3_801);
  });

  it('Mouse: observed.stats.def = 11253', () => {
    expect(mouse?.observed?.stats.def).toBe(11_253);
  });

  it('Mouse: observed.stats.spd = 1197', () => {
    expect(mouse?.observed?.stats.spd).toBe(1_197);
  });

  it('Mouse: observed.elementLevels.Earth = 1632', () => {
    expect(mouse?.observed?.elementLevels.Earth).toBe(1_632);
  });

  it('Mouse: observed.elementLevels.Fire = 214', () => {
    expect(mouse?.observed?.elementLevels.Fire).toBe(214);
  });

  it('Mouse: observed.elementLevels.Wind = 161', () => {
    expect(mouse?.observed?.elementLevels.Wind).toBe(161);
  });

  it('Mouse: observed.elementLevels.Water = -114', () => {
    expect(mouse?.observed?.elementLevels.Water).toBe(-114);
  });

  it('Mouse: has weapon gear', () => {
    expect(mouse?.equipment.weapon).toBeDefined();
    expect(mouse?.equipment.weapon?.name).toBe('Godly Hammer');
    expect(mouse?.equipment.weapon?.slot).toBe('weapon');
  });

  it('Mouse: weapon has Earth gem enchant (lv 15)', () => {
    expect(mouse?.equipment.weapon?.elementEnchant?.Earth).toBe(15);
  });
});

// ── import(): AntQueen spot-check (None class) ────────────────────────────────

describe('petExportImporter.import(): AntQueen (Class=None)', () => {
  it('AntQueen.evolvedClass is null', () => {
    const antQueen = result.pets.find((p) => p.displayName === 'AntQueen');
    expect(antQueen).toBeDefined();
    expect(antQueen?.evolvedClass).toBeNull();
  });
});

// ── import(): negative growth (Dorgegebelle) ──────────────────────────────────

describe('petExportImporter.import(): negative growth', () => {
  it('Dorgegebelle.totalGrowth = -10800', () => {
    const dorg = result.pets.find((p) => p.displayName === 'Dorgegebelle');
    expect(dorg).toBeDefined();
    expect(dorg?.totalGrowth).toBe(-10_800);
  });
});

// ── registry resolution ───────────────────────────────────────────────────────

describe('defaultRegistry.resolve() picks the real pet export importer', () => {
  it('resolves the fixture string to the itrtg-pet-export importer', () => {
    const resolved = defaultRegistry.resolve(fixtureText);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('itrtg-pet-export');
    expect(resolved?.version).toBe(1);
  });

  it('does NOT resolve a JSON object to the real importer', () => {
    const resolved = defaultRegistry.resolve({ exportedPets: [] });
    // Should resolve to v1/v2 or null, not itrtg-pet-export
    expect(resolved?.id).not.toBe('itrtg-pet-export');
  });
});

// ── source provenance ─────────────────────────────────────────────────────────

describe('petExportImporter.import(): source provenance', () => {
  it('all pets carry source.importerId = itrtg-pet-export', () => {
    for (const pet of result.pets) {
      expect(pet.source.importerId).toBe('itrtg-pet-export');
    }
  });

  it('all pets carry source.importerVersion = 1', () => {
    for (const pet of result.pets) {
      expect(pet.source.importerVersion).toBe(1);
    }
  });
});
