/**
 * Tests for the ITRTG Pet-Equipment-IDs export parser.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPetEquip, parsePetEquip } from './petEquip.js';
import type { ParsedPetEquip } from './petEquip.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'petEquip.txt');

let fixture: string;
let parsed: ParsedPetEquip;

beforeAll(() => {
  fixture = readFileSync(FIXTURE_PATH, 'utf-8');
  parsed = parsePetEquip(fixture);
});

// ── detectPetEquip ────────────────────────────────────────────────────────────

describe('detectPetEquip()', () => {
  it('returns 0.99 for fixture text', () => {
    expect(detectPetEquip(fixture)).toBe(0.99);
  });

  it('returns 0 for non-string', () => {
    expect(detectPetEquip(null)).toBe(0);
    expect(detectPetEquip(42)).toBe(0);
    expect(detectPetEquip({})).toBe(0);
  });

  it('returns 0 for unrelated string', () => {
    expect(detectPetEquip('Name;Element;Growth')).toBe(0);
  });
});

// ── parsePetEquip: structure ──────────────────────────────────────────────────

describe('parsePetEquip(): structure', () => {
  it('produces no warnings on valid fixture', () => {
    expect(parsed.warnings).toHaveLength(0);
  });

  it('parses entries for all 158 pets in the fixture', () => {
    expect(parsed.equipment.size).toBe(158);
  });
});

// ── parsePetEquip: specific pets ──────────────────────────────────────────────

describe('parsePetEquip(): specific pet values', () => {
  it('Owl: weapon=1945, armor=2241, accessory=2611', () => {
    const eq = parsed.equipment.get('Owl');
    expect(eq).toEqual({ weaponId: 1945, armorId: 2241, accessoryId: 2611 });
  });

  it('Witch: weapon=3436, armor=3389, accessory=3439', () => {
    const eq = parsed.equipment.get('Witch');
    expect(eq).toEqual({ weaponId: 3436, armorId: 3389, accessoryId: 3439 });
  });

  it('Santa: all slots 0 (empty)', () => {
    const eq = parsed.equipment.get('Santa');
    expect(eq).toEqual({ weaponId: 0, armorId: 0, accessoryId: 0 });
  });

  it('Stone: armor slot is 0 (empty)', () => {
    const eq = parsed.equipment.get('Stone');
    expect(eq).toEqual({ weaponId: 3870, armorId: 0, accessoryId: 1220 });
  });

  it('Baphomate (last entry): all slots 0', () => {
    const eq = parsed.equipment.get('Baphomate');
    expect(eq).toEqual({ weaponId: 0, armorId: 0, accessoryId: 0 });
  });

  it('Mouse: weapon=1533, armor=3405, accessory=3912', () => {
    const eq = parsed.equipment.get('Mouse');
    expect(eq).toEqual({ weaponId: 1533, armorId: 3405, accessoryId: 3912 });
  });
});

// ── parsePetEquip: edge cases ─────────────────────────────────────────────────

describe('parsePetEquip(): edge cases', () => {
  it('returns empty map with warning if marker absent', () => {
    const result = parsePetEquip('some unrelated text');
    expect(result.equipment.size).toBe(0);
    expect(result.warnings[0]).toMatch(/marker not found/i);
  });

  it('skips and warns on malformed entries (no =)', () => {
    const text = '---PetEquipStart---\nBadEntry;Owl=1,2,3;---PetEquipEnd---';
    const result = parsePetEquip(text);
    expect(result.equipment.size).toBe(1);
    expect(result.equipment.get('Owl')).toEqual({ weaponId: 1, armorId: 2, accessoryId: 3 });
    expect(result.warnings.some(w => w.includes("no '='"))).toBe(true);
  });

  it('skips and warns when fewer than 3 IDs', () => {
    const text = '---PetEquipStart---\nOwl=1,2;---PetEquipEnd---';
    const result = parsePetEquip(text);
    expect(result.equipment.size).toBe(0);
    expect(result.warnings.some(w => w.includes('expected 3 item IDs'))).toBe(true);
  });

  it('skips and warns on non-numeric IDs', () => {
    const text = '---PetEquipStart---\nOwl=abc,2,3;---PetEquipEnd---';
    const result = parsePetEquip(text);
    expect(result.equipment.size).toBe(0);
    expect(result.warnings.some(w => w.includes('non-numeric'))).toBe(true);
  });

  it('parses correctly when block is embedded in a larger text', () => {
    const text = 'some prefix\n---PetEquipStart---\nOwl=10,20,30;---PetEquipEnd---\nsome suffix';
    const result = parsePetEquip(text);
    expect(result.equipment.get('Owl')).toEqual({ weaponId: 10, armorId: 20, accessoryId: 30 });
  });
});
