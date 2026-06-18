/**
 * ITRTG Dungeon-Teams export parser.
 *
 * Parses the block produced by the game's built-in export:
 *
 *   ---DungeonTeamsStart---
 *   0:Cat=1,Dog=2,Tanuki=4,Nothing=5,Ghost=6,Carno=3,;1:Alien=2,...;---DungeonTeamsEnd---
 *
 * Each entry has the form `teamIndex:PetName=position,...,;`.
 * Positions 1–3 map to the front row; 4–6 map to the back row.
 *
 * ## Design notes
 *
 * This is NOT a PetImporter — it produces a `ParsedDungeonTeams` (name-based)
 * that can be resolved against an imported pet roster to build `Team` objects.
 *
 * The export does not include class assignments, so `assignedClass` is always
 * null in resolved `TeamSlot`s — the sim will fall back to `pet.evolvedClass`.
 *
 * The real pet export uses the pet's display name as its `PetId` (e.g.,
 * `asPetId("Cat")`), so callers can build a name→id map simply with:
 *   `new Map(pets.map(p => [p.displayName, p.id]))`
 *
 * ## Adding new export parsers
 *
 * Follow the same pattern as this file and `statistics.ts`:
 *   1. Create `packages/core/src/importers/real/<format>.ts` with `detect*` +
 *      `parse*` functions and typed result interfaces.
 *   2. Add a fixture file under `importers/real/fixtures/`.
 *   3. Write a co-located `<format>.test.ts`.
 *   4. Append exports to `packages/core/src/index.ts`.
 *   Do NOT register it in the PetImporter registry unless it produces `Pet[]`.
 */

import type { Team, TeamSlot, Row } from '../../domain/team.js';
import type { PetId } from '../../domain/ids.js';

// ── Types ──────────────────────────────────────────────────────────────────────

/** One slot as exported: pet name + 1-based position (not yet a PetId). */
export interface RawTeamSlot {
  /** Pet name matching the Name column in the pet export (e.g. "Cat"). */
  readonly petName: string;
  /** 1-based position in the team (1–6). 1–3 = front row, 4–6 = back row. */
  readonly position: number;
  /** Row derived from position: 1–3 → front, 4–6 → back. */
  readonly row: Row;
}

/** One dungeon team as parsed from the export (names, not PetIds). */
export interface ParsedDungeonTeam {
  /** 0-based team index from the export block. */
  readonly teamIndex: number;
  /** Slots in position order (ascending). */
  readonly slots: ReadonlyArray<RawTeamSlot>;
}

/** Result of parsing a DungeonTeamsStart block. */
export interface ParsedDungeonTeams {
  /** Teams in teamIndex order. */
  readonly teams: ReadonlyArray<ParsedDungeonTeam>;
  /** Non-fatal parse warnings (unknown fields, skipped entries, etc.). */
  readonly warnings: ReadonlyArray<string>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const START_MARKER = '---DungeonTeamsStart---';
const END_MARKER   = '---DungeonTeamsEnd---';

// ── Helpers ────────────────────────────────────────────────────────────────────

function positionToRow(position: number): Row {
  return position <= 3 ? 'front' : 'back';
}

// ── detect ─────────────────────────────────────────────────────────────────────

/**
 * Return a confidence in [0, 1] that `raw` is a DungeonTeams export block.
 * Safe to call on any unknown input.
 */
export function detectDungeonTeams(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  return raw.includes(START_MARKER) ? 0.99 : 0;
}

// ── parse ──────────────────────────────────────────────────────────────────────

/**
 * Parse a DungeonTeams export block.
 *
 * Accepts the full multi-section export text or just the relevant block.
 * Gracefully handles trailing commas after slot lists and the end marker
 * appearing on the same line as the last team entry.
 */
export function parseDungeonTeams(text: string): ParsedDungeonTeams {
  const warnings: string[] = [];

  const startIdx = text.indexOf(START_MARKER);
  if (startIdx === -1) {
    return { teams: [], warnings: ['DungeonTeamsStart marker not found in input'] };
  }

  const afterStart = text.slice(startIdx + START_MARKER.length);
  const endIdx = afterStart.indexOf(END_MARKER);
  const block = endIdx >= 0 ? afterStart.slice(0, endIdx) : afterStart;

  // Team entries are delimited by ';' — the end marker may be on the last line
  const entries = block
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('---'));

  const teams: ParsedDungeonTeam[] = [];

  for (const entry of entries) {
    // Format: "0:Cat=1,Dog=2,Carno=3,Tanuki=4,Nothing=5,Ghost=6"
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) {
      warnings.push(`Skipping malformed team entry (no colon): "${entry}"`);
      continue;
    }

    const teamIndex = parseInt(entry.slice(0, colonIdx).trim(), 10);
    if (isNaN(teamIndex)) {
      warnings.push(`Skipping entry with non-numeric team index: "${entry.slice(0, colonIdx)}"`);
      continue;
    }

    const slotStrings = entry
      .slice(colonIdx + 1)
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const slots: RawTeamSlot[] = [];

    for (const slotStr of slotStrings) {
      const eqIdx = slotStr.indexOf('=');
      if (eqIdx === -1) {
        warnings.push(`Team ${teamIndex}: skipping malformed slot "${slotStr}" (no '=')`);
        continue;
      }
      const petName = slotStr.slice(0, eqIdx).trim();
      const position = parseInt(slotStr.slice(eqIdx + 1).trim(), 10);

      if (petName.length === 0) {
        warnings.push(`Team ${teamIndex}: skipping slot with empty pet name`);
        continue;
      }
      if (isNaN(position) || position < 1 || position > 6) {
        warnings.push(
          `Team ${teamIndex}: pet "${petName}" has invalid position ${String(position)}; skipping`,
        );
        continue;
      }

      slots.push({ petName, position, row: positionToRow(position) });
    }

    if (slots.length === 0) {
      warnings.push(`Team ${teamIndex}: no valid slots found; skipping`);
      continue;
    }

    // Sort slots by position for deterministic order
    slots.sort((a, b) => a.position - b.position);
    teams.push({ teamIndex, slots });
  }

  teams.sort((a, b) => a.teamIndex - b.teamIndex);

  return { teams, warnings };
}

// ── Resolution helpers ────────────────────────────────────────────────────────

/**
 * Resolve one `ParsedDungeonTeam` to a `Team` using a pet-name → PetId map.
 *
 * Pets whose names are not in the map are skipped; a warning is appended to
 * the caller-supplied `warnings` array.
 *
 * For rosters imported via the real pet export, build the map with:
 *   `new Map(pets.map(p => [p.displayName, p.id]))`
 */
export function resolveDungeonTeam(
  parsed: ParsedDungeonTeam,
  nameToId: ReadonlyMap<string, PetId>,
  warnings: string[],
): Team {
  const slots: TeamSlot[] = [];

  for (const raw of parsed.slots) {
    const petId = nameToId.get(raw.petName);
    if (petId === undefined) {
      warnings.push(
        `Team ${parsed.teamIndex}: pet "${raw.petName}" not found in roster; skipping`,
      );
      continue;
    }
    // assignedClass: null — the export does not record per-slot class overrides;
    // the sim falls back to pet.evolvedClass.
    slots.push({ petId, row: raw.row, assignedClass: null });
  }

  return { slots };
}

/**
 * Resolve all parsed dungeon teams to `Team` objects.
 *
 * Returns teams in teamIndex order plus any resolution warnings (the parse
 * warnings from `parsed.warnings` are also forwarded).
 */
export function resolveDungeonTeams(
  parsed: ParsedDungeonTeams,
  nameToId: ReadonlyMap<string, PetId>,
): { teams: ReadonlyArray<{ teamIndex: number; team: Team }>; warnings: ReadonlyArray<string> } {
  const warnings: string[] = [...parsed.warnings];
  const teams = parsed.teams.map(p => ({
    teamIndex: p.teamIndex,
    team: resolveDungeonTeam(p, nameToId, warnings),
  }));
  return { teams, warnings };
}
