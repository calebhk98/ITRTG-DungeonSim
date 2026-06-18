/**
 * v1 importer tests (WP-C).
 *
 * Covers:
 * - Round-trip: import(v1Fixture) → expected Pet[] fields
 * - Registry resolution: defaultRegistry.resolve(v1Fixture) picks version 1
 * - detect() returns ~0 for the v2 fixture (cross-format guard)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { defaultRegistry } from '../registry.js';
import { v1Importer } from './v1Importer.js';

// Importing v2Importer here ensures it is registered, enabling the cross-test.
import '../v2/v2Importer.js';

import v1Fixture from './v1.fixture.json' assert { type: 'json' };
import v2Fixture from '../v2/v2.fixture.json' assert { type: 'json' };

// ---------------------------------------------------------------------------
// Ensure v1Importer is registered (module side-effect fires on import above).
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Both importers should be registered by now via their module side-effects.
  const ids = defaultRegistry.list().map((i) => `${i.id}@v${i.version}`);
  expect(ids).toContain('official-export@v1');
});

// ---------------------------------------------------------------------------
// Round-trip: v1 fixture → Pet[]
// ---------------------------------------------------------------------------

describe('v1Importer.import()', () => {
  it('parses the v1 fixture without throwing', () => {
    const result = v1Importer.import(v1Fixture);
    expect(result.pets).toHaveLength(3);
  });

  it('maps the first pet (Squeaky/Neutral/Adventurer) correctly', () => {
    const { pets } = v1Importer.import(v1Fixture);
    const squeaky = pets[0];
    expect(squeaky).toBeDefined();
    if (squeaky === undefined) return;

    expect(squeaky.id).toBe('mouse-001');
    expect(squeaky.displayName).toBe('Squeaky');
    expect(squeaky.primaryElement).toBe('Neutral');
    expect(squeaky.dungeonLevel).toBe(42);
    expect(squeaky.classLevel).toBe(55);
    expect(squeaky.evolvedClass).toBe('Adventurer');
    expect(squeaky.totalGrowth).toBe(84000);
    // A7: growthRequiredForEvolution defaults to 50000 with a warning.
    expect(squeaky.growthRequiredForEvolution).toBe(50000);
    expect(squeaky.trainingPhysical).toBe(120);
    expect(squeaky.trainingMystic).toBe(80);
    expect(squeaky.trainingBattle).toBe(200);
    expect(squeaky.abilities).toContain('luckyCoin');
    expect(squeaky.source.importerId).toBe('official-export');
    expect(squeaky.source.importerVersion).toBe(1);
  });

  it('maps the second pet (Blaze/Fire/Mage) correctly', () => {
    const { pets } = v1Importer.import(v1Fixture);
    const blaze = pets[1];
    expect(blaze).toBeDefined();
    if (blaze === undefined) return;

    expect(blaze.id).toBe('dragon-001');
    expect(blaze.primaryElement).toBe('Fire');
    expect(blaze.evolvedClass).toBe('Mage');
    expect(blaze.dungeonLevel).toBe(120);
    expect(blaze.classLevel).toBe(100);
    expect(blaze.abilities).toContain('supporterDmgReduction');
    expect(blaze.abilities).toContain('vesuviusGrowth');
  });

  it('maps equipment for the second pet (Blaze) correctly', () => {
    const { pets } = v1Importer.import(v1Fixture);
    const blaze = pets[1];
    expect(blaze).toBeDefined();
    if (blaze === undefined) return;

    expect(blaze.equipment.weapon).toBeDefined();
    expect(blaze.equipment.weapon?.id).toBe('staff-t4-007');
    expect(blaze.equipment.weapon?.name).toBe('Dragon Staff');
    expect(blaze.equipment.weapon?.slot).toBe('weapon');
    expect(blaze.equipment.weapon?.tier).toBe(4);
    expect(blaze.equipment.weapon?.statMultiplierBonus).toBe(0.35);
    expect(blaze.equipment.weapon?.elementEnchant?.Fire).toBe(5);

    expect(blaze.equipment.armor).toBeDefined();
    expect(blaze.equipment.armor?.tier).toBe(3);
    expect(blaze.equipment.accessory).toBeDefined();
  });

  it('maps the third pet (Whisker/Wind/not evolved) correctly', () => {
    const { pets } = v1Importer.import(v1Fixture);
    const whisker = pets[2];
    expect(whisker).toBeDefined();
    if (whisker === undefined) return;

    expect(whisker.id).toBe('cat-001');
    expect(whisker.primaryElement).toBe('Wind');
    expect(whisker.evolvedClass).toBeNull();
    expect(whisker.classLevel).toBe(0);
    expect(whisker.abilities).toHaveLength(0);
    expect(whisker.equipment).toEqual({});
  });

  it('emits warnings for missing growthRequiredForEvolution (A7)', () => {
    const { warnings } = v1Importer.import(v1Fixture);
    // One warning per pet (3 pets).
    const growthWarnings = warnings.filter((w) =>
      w.includes('growthRequiredForEvolution'),
    );
    expect(growthWarnings).toHaveLength(3);
  });

  it('throws ImporterError on fundamentally bad input', async () => {
    const { ImporterError } = await import('../PetImporter.js');
    expect(() => v1Importer.import({ not: 'a v1 export' })).toThrow(ImporterError);
  });
});

// ---------------------------------------------------------------------------
// detect() accuracy
// ---------------------------------------------------------------------------

describe('v1Importer.detect()', () => {
  it('returns high confidence (>=0.9) for the v1 fixture', () => {
    expect(v1Importer.detect(v1Fixture)).toBeGreaterThanOrEqual(0.9);
  });

  it('returns 0 for the v2 fixture', () => {
    expect(v1Importer.detect(v2Fixture)).toBe(0);
  });

  it('returns 0 for arbitrary non-matching inputs', () => {
    expect(v1Importer.detect(null)).toBe(0);
    expect(v1Importer.detect(42)).toBe(0);
    expect(v1Importer.detect({ _formatVersion: 2, pets: [] })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Registry resolution
// ---------------------------------------------------------------------------

describe('defaultRegistry.resolve() with v1 fixture', () => {
  it('resolves to the v1 importer', () => {
    const resolved = defaultRegistry.resolve(v1Fixture);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('official-export');
    expect(resolved?.version).toBe(1);
  });
});
