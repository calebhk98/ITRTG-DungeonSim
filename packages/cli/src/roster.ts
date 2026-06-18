/**
 * Roster parsing helpers for the CLI.
 *
 * Supports two input shapes:
 *   1. Normalized roster file: an array of Pet objects (written by `import --out`).
 *   2. Raw export: any JSON that `defaultRegistry.importAuto()` can recognize.
 *
 * Both paths produce a `ReadonlyMap<PetId, Pet>`.
 */

import type { Pet } from '@itrtg-sim/core';
import type { PetId } from '@itrtg-sim/core';
import { defaultRegistry } from '@itrtg-sim/core';
import type { Team, TeamSlot, Row } from '@itrtg-sim/core';
import type { PetClassName } from '@itrtg-sim/core';

// ── Normalized file detection ─────────────────────────────────────────────────

/**
 * Returns true if `raw` looks like a normalized pets array (written by `import --out`).
 * Heuristic: raw is an array and the first element has a `source.importerId` field.
 */
function isNormalizedRoster(raw: unknown): raw is Pet[] {
  if (!Array.isArray(raw)) return false;
  if (raw.length === 0) return true; // empty array — treat as normalized
  const first = raw[0] as Record<string, unknown> | undefined;
  return (
    first !== undefined &&
    typeof first === 'object' &&
    'source' in first &&
    typeof (first as Record<string, unknown>)['id'] === 'string'
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a roster file's text content into a `ReadonlyMap<PetId, Pet>`.
 *
 * Accepts either:
 *   - A JSON array of Pet objects (output of `import --out`).
 *   - A raw export blob recognized by `defaultRegistry.importAuto()`.
 *
 * Throws a descriptive `Error` on unrecognized or invalid input.
 */
export function parseRosterFile(text: string): {
  roster: ReadonlyMap<PetId, Pet>;
  warnings: ReadonlyArray<string>;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Roster file is not valid JSON: ${String(e)}`);
  }

  // Path 1: already-normalized array of Pet objects.
  if (isNormalizedRoster(raw)) {
    const roster = new Map<PetId, Pet>();
    for (const pet of raw) {
      roster.set(pet.id, pet);
    }
    return { roster, warnings: [] };
  }

  // Path 2: raw export — delegate to importer registry.
  const result = defaultRegistry.importAuto(raw);
  const roster = new Map<PetId, Pet>();
  for (const pet of result.pets) {
    roster.set(pet.id, pet);
  }
  return { roster, warnings: result.warnings };
}

// ── Default team builder ──────────────────────────────────────────────────────

/**
 * Build a default `Team` from a roster.
 *
 * Fills front row (up to 3) then back row (up to 3), up to `maxSize` total.
 * Each slot's `assignedClass` = `pet.evolvedClass ?? 'Adventurer'`.
 *
 * This is a pure helper — no I/O.
 */
export function buildDefaultTeam(
  roster: ReadonlyMap<PetId, Pet>,
  maxSize: number = 6,
): Team {
  const slots: TeamSlot[] = [];
  let frontCount = 0;
  let backCount = 0;

  for (const pet of roster.values()) {
    if (slots.length >= maxSize) break;

    let row: Row;
    if (frontCount < 3) {
      row = 'front';
      frontCount++;
    } else if (backCount < 3) {
      row = 'back';
      backCount++;
    } else {
      break; // both rows full
    }

    const assignedClass: PetClassName = pet.evolvedClass ?? 'Adventurer';
    slots.push({ petId: pet.id, row, assignedClass });
  }

  return { slots };
}

/**
 * Parse a `--team` spec string into a `Team`.
 *
 * Spec format: comma-separated pet IDs, e.g. `mouse-001,dragon-001`
 * Rows: first 3 → front, next 3 → back. Class = evolvedClass ?? 'Adventurer'.
 *
 * Returns null if the spec is empty (caller should fall back to buildDefaultTeam).
 */
export function parseTeamSpec(
  spec: string,
  roster: ReadonlyMap<PetId, Pet>,
): Team | null {
  const ids = spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (ids.length === 0) return null;

  const slots: TeamSlot[] = [];
  let frontCount = 0;
  let backCount = 0;

  for (const id of ids.slice(0, 6)) {
    const petId = id as PetId;
    const pet = roster.get(petId);
    if (pet === undefined) {
      throw new Error(
        `Team spec references unknown pet id "${id}". ` +
          `Available ids: ${[...roster.keys()].join(', ')}`,
      );
    }

    let row: Row;
    if (frontCount < 3) {
      row = 'front';
      frontCount++;
    } else if (backCount < 3) {
      row = 'back';
      backCount++;
    } else {
      break;
    }

    const assignedClass: PetClassName = pet.evolvedClass ?? 'Adventurer';
    slots.push({ petId, row, assignedClass });
  }

  return { slots };
}
