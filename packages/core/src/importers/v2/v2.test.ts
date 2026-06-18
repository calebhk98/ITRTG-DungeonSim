/**
 * v2 importer tests (WP-D).
 *
 * Covers:
 * - Round-trip: import(v2Fixture) → expected Pet[] fields
 * - Registry resolution: defaultRegistry.resolve(v2Fixture) picks version 2
 * - detect() returns 0 for the v1 fixture (cross-format guard)
 * - Cross-test: the two importers do NOT both claim a fixture with equal
 *   high confidence (no ambiguous resolution for either fixture).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { defaultRegistry } from '../registry.js';
import { v2Importer } from './v2Importer.js';

// Importing v1Importer ensures it is registered, enabling the cross-tests.
import '../v1/v1Importer.js';

import v2Fixture from './v2.fixture.json' assert { type: 'json' };
import v1Fixture from '../v1/v1.fixture.json' assert { type: 'json' };

// ---------------------------------------------------------------------------
// Ensure both importers are registered.
// ---------------------------------------------------------------------------

beforeAll(() => {
  const ids = defaultRegistry.list().map((i) => `${i.id}@v${i.version}`);
  expect(ids).toContain('official-export@v1');
  expect(ids).toContain('official-export@v2');
});

// ---------------------------------------------------------------------------
// Round-trip: v2 fixture → Pet[]
// ---------------------------------------------------------------------------

describe('v2Importer.import()', () => {
  it('parses the v2 fixture without throwing', () => {
    const result = v2Importer.import(v2Fixture);
    expect(result.pets).toHaveLength(3);
  });

  it('maps the first pet (Blobby/Water/Defender) correctly', () => {
    const { pets, warnings } = v2Importer.import(v2Fixture);
    const blobby = pets[0];
    expect(blobby).toBeDefined();
    if (blobby === undefined) return;

    expect(blobby.id).toBe('slime-001');
    expect(blobby.displayName).toBe('Blobby');
    expect(blobby.primaryElement).toBe('Water');
    expect(blobby.dungeonLevel).toBe(75);
    expect(blobby.classLevel).toBe(80);
    expect(blobby.evolvedClass).toBe('Defender');
    expect(blobby.totalGrowth).toBe(180000);
    // B7: evolutionDifficulty is explicitly provided in v2.
    expect(blobby.growthRequiredForEvolution).toBe(100000);
    expect(blobby.trainingPhysical).toBe(300);
    expect(blobby.trainingMystic).toBe(450);
    expect(blobby.trainingBattle).toBe(150);
    expect(blobby.abilities).toContain('succubusHeal');
    expect(blobby.source.importerId).toBe('official-export');
    expect(blobby.source.importerVersion).toBe(2);

    // v2 does NOT emit a growthRequiredForEvolution warning.
    const growthWarnings = warnings.filter((w) =>
      w.includes('growthRequiredForEvolution'),
    );
    expect(growthWarnings).toHaveLength(0);
  });

  it('maps the second pet (Vixie/Wind/Assassin) correctly', () => {
    const { pets } = v2Importer.import(v2Fixture);
    const vixie = pets[1];
    expect(vixie).toBeDefined();
    if (vixie === undefined) return;

    expect(vixie.id).toBe('fox-001');
    expect(vixie.primaryElement).toBe('Wind');
    expect(vixie.evolvedClass).toBe('Assassin');
    expect(vixie.dungeonLevel).toBe(200);
    expect(vixie.classLevel).toBe(100);
    expect(vixie.totalGrowth).toBe(520000);
    expect(vixie.growthRequiredForEvolution).toBe(150000);
    expect(vixie.abilities).toContain('chameleonElement');
    expect(vixie.abilities).toContain('luckyCoin');
  });

  it('maps equipment for the second pet (Vixie) correctly', () => {
    const { pets } = v2Importer.import(v2Fixture);
    const vixie = pets[1];
    expect(vixie).toBeDefined();
    if (vixie === undefined) return;

    expect(vixie.equipment.weapon).toBeDefined();
    expect(vixie.equipment.weapon?.id).toBe('dagger-t4-009');
    expect(vixie.equipment.weapon?.name).toBe('Gale Dagger');
    expect(vixie.equipment.weapon?.slot).toBe('weapon');
    expect(vixie.equipment.weapon?.tier).toBe(4);
    expect(vixie.equipment.weapon?.statMultiplierBonus).toBe(0.40);
    expect(vixie.equipment.weapon?.elementEnchant?.Wind).toBe(6);

    expect(vixie.equipment.armor).toBeDefined();
    expect(vixie.equipment.accessory).toBeDefined();
    expect(vixie.equipment.accessory?.elementEnchant?.Wind).toBe(2);
    // Trinket slot not equipped.
    expect(vixie.equipment.trinket).toBeUndefined();
  });

  it('maps the third pet (Shellsworth/Earth/not evolved) correctly', () => {
    const { pets } = v2Importer.import(v2Fixture);
    const shellsworth = pets[2];
    expect(shellsworth).toBeDefined();
    if (shellsworth === undefined) return;

    expect(shellsworth.id).toBe('turtle-001');
    expect(shellsworth.primaryElement).toBe('Earth');
    expect(shellsworth.evolvedClass).toBeNull();
    expect(shellsworth.classLevel).toBe(0);
    expect(shellsworth.abilities).toHaveLength(0);
    expect(shellsworth.equipment).toEqual({});
    expect(shellsworth.growthRequiredForEvolution).toBe(50000);
  });

  it('produces no warnings for a clean v2 import', () => {
    const { warnings } = v2Importer.import(v2Fixture);
    expect(warnings).toHaveLength(0);
  });

  it('throws ImporterError on fundamentally bad input', async () => {
    const { ImporterError } = await import('../PetImporter.js');
    expect(() => v2Importer.import({ exportedPets: [] })).toThrow(ImporterError);
    // _formatVersion 1 is not 2, so it is not a valid v2 export.
    expect(() => v2Importer.import({ _formatVersion: 1, roster: [] })).toThrow(ImporterError);
  });
});

// ---------------------------------------------------------------------------
// detect() accuracy
// ---------------------------------------------------------------------------

describe('v2Importer.detect()', () => {
  it('returns 1.0 for the v2 fixture', () => {
    expect(v2Importer.detect(v2Fixture)).toBe(1.0);
  });

  it('returns 0 for the v1 fixture', () => {
    expect(v2Importer.detect(v1Fixture)).toBe(0);
  });

  it('returns 0 for arbitrary non-matching inputs', () => {
    expect(v2Importer.detect(null)).toBe(0);
    expect(v2Importer.detect(42)).toBe(0);
    expect(v2Importer.detect({ exportedPets: [] })).toBe(0);
    expect(v2Importer.detect({ _formatVersion: 3, roster: [] })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Registry resolution
// ---------------------------------------------------------------------------

describe('defaultRegistry.resolve() with v2 fixture', () => {
  it('resolves to the v2 importer', () => {
    const resolved = defaultRegistry.resolve(v2Fixture);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('official-export');
    expect(resolved?.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-test: no ambiguous resolution (neither fixture claimed by both with
// equal high confidence).
// ---------------------------------------------------------------------------

describe('Cross-format disambiguation', () => {
  it('v1 and v2 importers do NOT tie on the v1 fixture', async () => {
    const { v1Importer } = await import('../v1/v1Importer.js');
    const v1Score = v1Importer.detect(v1Fixture);
    const v2Score = v2Importer.detect(v1Fixture);
    // v1 should win clearly — not tied at the same high value.
    expect(v1Score).toBeGreaterThan(v2Score);
  });

  it('v1 and v2 importers do NOT tie on the v2 fixture', async () => {
    const { v1Importer } = await import('../v1/v1Importer.js');
    const v1Score = v1Importer.detect(v2Fixture);
    const v2Score = v2Importer.detect(v2Fixture);
    // v2 should win clearly — not tied at the same high value.
    expect(v2Score).toBeGreaterThan(v1Score);
  });

  it('resolve() picks v1 for v1 fixture and v2 for v2 fixture (no ambiguity)', () => {
    expect(defaultRegistry.resolve(v1Fixture)?.version).toBe(1);
    expect(defaultRegistry.resolve(v2Fixture)?.version).toBe(2);
  });
});
