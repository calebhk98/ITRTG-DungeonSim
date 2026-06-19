/**
 * Helpers for the `active-teams` CLI command.
 *
 * Parses the game's real export files (pet export + dungeon teams + optional
 * statistics) and maps each team to the dungeon its pets are currently
 * running, using the "Action" column from the pet export.
 */

import type { DungeonId, Difficulty } from '@itrtg-sim/core';
import {
  defaultRegistry,
  parseDungeonTeams,
  resolveDungeonTeams,
  getDungeon,
  simulateRun,
  DEFAULT_CONSTANTS,
} from '@itrtg-sim/core';
import type { Pet, PetId, Team, RunResult } from '@itrtg-sim/core';

// ── Action → DungeonId mapping ────────────────────────────────────────────────

/**
 * Map the freeform Action string from the pet export to a known DungeonId.
 * Returns null if the action doesn't correspond to a dungeon (e.g. "Crafting",
 * "Questing", "Food", "Divinity", etc.).
 */
const ACTION_TO_DUNGEON_ID: Record<string, DungeonId> = {
  'NewbieGround': 'NewbieGround',
  'Scrapyard':    'Scrapyard',
  'Water Temple': 'WaterTemple',
  'Volcano':      'Volcano',
  'Mountain':     'Mountain',
  'Forest':       'Forest',
};

export function actionToDungeonId(action: string): DungeonId | null {
  const trimmed = action.trim();
  return (ACTION_TO_DUNGEON_ID[trimmed] as DungeonId | undefined) ?? null;
}

// ── Pet export Action column parser ──────────────────────────────────────────

const PET_EXPORT_HEADER_PREFIX = 'Name;Element;Growth;Dungeon Level;';
const COL_ACTION = 19;
const COL_NAME   = 0;

/**
 * Extract a map of petName → actionString from the raw pet export text.
 * Skips the header row and any blank lines.
 */
export function parseActionColumn(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(PET_EXPORT_HEADER_PREFIX)) continue;

    const cols = trimmed.split(';');
    const name   = cols[COL_NAME]?.trim() ?? '';
    const action = cols[COL_ACTION]?.trim() ?? '';
    if (name && action) {
      result.set(name, action);
    }
  }

  return result;
}

// ── Import helpers ────────────────────────────────────────────────────────────

/** Import a pet roster from raw pet-export text. */
export function importPetExport(text: string): {
  roster: ReadonlyMap<PetId, Pet>;
  pets: ReadonlyArray<Pet>;
  warnings: ReadonlyArray<string>;
} {
  const { pets, warnings } = defaultRegistry.importAuto(text);
  const roster = new Map<PetId, Pet>(pets.map(p => [p.id, p]));
  return { roster, pets, warnings };
}

// ── Team → dungeon resolution ─────────────────────────────────────────────────

export interface ResolvedActiveTeam {
  teamIndex: number;
  team: Team;
  dungeonId: DungeonId;
  petNames: ReadonlyArray<string>;
}

/**
 * Given a parsed dungeon-teams export and a pet export, resolve each team to
 * a `Team` + dungeon by:
 *  1. Building petName → PetId map from the roster.
 *  2. Looking up the Action column for the first pet in each team.
 *  3. Mapping that action string to a DungeonId.
 *
 * Teams whose dungeon can't be determined are skipped (with a warning).
 */
export function resolveActiveTeams(
  dungeonTeamText: string,
  petExportText: string,
  pets: ReadonlyArray<Pet>,
): { activeTeams: ResolvedActiveTeam[]; warnings: string[] } {
  const warnings: string[] = [];
  const nameToId = new Map(pets.map(p => [p.displayName, p.id]));
  const actionMap = parseActionColumn(petExportText);

  const parsedTeams = parseDungeonTeams(dungeonTeamText);
  warnings.push(...parsedTeams.warnings);

  const { teams: resolved, warnings: resolveWarnings } = resolveDungeonTeams(parsedTeams, nameToId);
  warnings.push(...resolveWarnings);

  const activeTeams: ResolvedActiveTeam[] = [];

  for (const { teamIndex, team } of resolved) {
    if (team.slots.length === 0) {
      warnings.push(`Team ${teamIndex}: no resolved slots; skipping.`);
      continue;
    }

    // Find the dungeon by looking up the first pet's action
    const firstPetId = team.slots[0]!.petId;
    const firstPetName = firstPetId as string; // PetId = petName for real exports
    const action = actionMap.get(firstPetName) ?? '';
    const dungeonId = actionToDungeonId(action);

    if (dungeonId === null) {
      // Fall back: try any pet in the team
      let found: DungeonId | null = null;
      for (const slot of team.slots) {
        const name = slot.petId as string;
        const act = actionMap.get(name) ?? '';
        const id = actionToDungeonId(act);
        if (id !== null) { found = id; break; }
      }
      if (found === null) {
        warnings.push(
          `Team ${teamIndex}: cannot determine dungeon ` +
          `(first pet "${firstPetName}" has action "${action}"); skipping.`,
        );
        continue;
      }
    }

    const finalDungeonId = actionToDungeonId(action) ??
      ((): DungeonId => {
        for (const slot of team.slots) {
          const id = actionToDungeonId(actionMap.get(slot.petId as string) ?? '');
          if (id !== null) return id;
        }
        return 'Scrapyard'; // unreachable given the guard above
      })();

    activeTeams.push({
      teamIndex,
      team,
      dungeonId: finalDungeonId,
      petNames: team.slots.map(s => s.petId as string),
    });
  }

  return { activeTeams, warnings };
}

// ── Sweep runner ──────────────────────────────────────────────────────────────

export interface DifficultyResult {
  difficulty: Difficulty;
  result: RunResult;
}

/** Sweep all difficulties 0–10 for a single team+dungeon. */
export function sweepDifficulties(
  team: Team,
  dungeonId: DungeonId,
  depth: 1 | 2 | 3 | 4,
  rooms: number,
  nrdcCompletions: number,
): DifficultyResult[] {
  const dungeon = getDungeon(dungeonId);
  if (dungeon === undefined) return [];

  const results: DifficultyResult[] = [];
  for (let d = 0; d <= 10; d++) {
    const result = simulateRun(
      {
        team,
        dungeonId,
        depth,
        difficulty: d as Difficulty,
        rooms,
        nrdcCompletions,
        evaluationMode: 'expected',
      },
      { dungeon, roster: new Map(), constants: DEFAULT_CONSTANTS },
    );
    results.push({ difficulty: d as Difficulty, result });
  }
  return results;
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** Format a single team's sweep results into a human-readable block. */
export function formatTeamSweep(
  at: ResolvedActiveTeam,
  sweep: DifficultyResult[],
  depth: number,
): string {
  const lines: string[] = [];

  lines.push(`Team ${at.teamIndex} │ ${at.dungeonId} D${depth}`);
  lines.push(`  Pets: ${at.petNames.join(', ')}`);
  lines.push(`  Difficulty sweep:`);

  let highestClear = -1;
  let lowestFail: number | null = null;

  for (const { difficulty, result } of sweep) {
    const cleared = result.cleared;
    const deaths = result.petDeaths.length;
    const xp = result.rewards.xpTotal.toLocaleString();
    const roomsCleared = result.roomsCleared;
    const elapsed = result.elapsedMinutes.toFixed(0);

    let status: string;
    if (cleared) {
      status = deaths > 0
        ? `✓ cleared (${deaths} death${deaths > 1 ? 's' : ''})`
        : '✓ cleared';
      highestClear = difficulty;
    } else {
      status = `✗ failed  (${roomsCleared}/${sweep[0]!.result.roomsCleared + (roomsCleared < sweep[0]!.result.roomsCleared ? 0 : 0)} rooms)`;
      // recalculate rooms display properly
      status = `✗ failed  (${roomsCleared} rooms)`;
      if (lowestFail === null) lowestFail = difficulty;
    }

    lines.push(`    diff ${String(difficulty).padStart(2)}: ${status.padEnd(24)}  xp=${xp.padStart(7)}  ${elapsed}min`);
  }

  lines.push('');
  if (highestClear === 10) {
    lines.push(`  → Clears all difficulties (currently maxed at D${depth}-10)`);
  } else if (highestClear >= 0 && lowestFail !== null) {
    lines.push(`  → Highest clear: D${depth}-${highestClear}  |  First fail: D${depth}-${lowestFail}`);
  } else if (highestClear < 0) {
    lines.push(`  → Cannot clear any difficulty at D${depth}`);
  }

  return lines.join('\n');
}

/** Format the full active-teams report. */
export function formatActiveTeamsReport(
  activeTeams: ResolvedActiveTeam[],
  sweepsByTeam: Map<number, DifficultyResult[]>,
  depth: number,
  nrdcCompletions: number,
  warnings: string[],
): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                  Active Teams — Dungeon Report               ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`NRDC completions: ${nrdcCompletions}${nrdcCompletions >= 20 ? '  ✓ D4 unlocked' : '  ✗ D4 locked'}`);
  lines.push('');

  for (const at of activeTeams) {
    const sweep = sweepsByTeam.get(at.teamIndex) ?? [];
    lines.push(formatTeamSweep(at, sweep, depth));
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('─── Warnings ──────────────────────────────────────────────────');
    for (const w of warnings.slice(0, 5)) {
      lines.push(`  ! ${w}`);
    }
    if (warnings.length > 5) {
      lines.push(`  … and ${warnings.length - 5} more`);
    }
    lines.push('');
  }

  lines.push(
    '  Note: enemy stats in this sim are community-estimated and may not\n' +
    '  perfectly match your in-game experience. Results are comparative\n' +
    '  (teams vs each other) rather than absolute.',
  );

  return lines.join('\n');
}
