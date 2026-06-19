#!/usr/bin/env node
/**
 * @itrtg-sim/cli — entry point.
 * Commander wrapper around @itrtg-sim/core.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import {
  defaultRegistry,
  ImporterError,
  objectiveRegistry,
  simulateRun,
  DEFAULT_CONSTANTS,
  makeFarmTargetProblem,
  makeTeamCompositionProblem,
  makeMultiTeamProblem,
  EnumerationOptimizer,
  GreedyOptimizer,
  BeamSearchOptimizer,
  mulberry32,
} from '@itrtg-sim/core';
import { getDungeon, DUNGEON_REGISTRY } from '@itrtg-sim/core';
import type {
  DungeonId,
  Depth,
  Difficulty,
  RunConfig,
  Pet,
  PetId,
  Team,
  FarmTargetCandidate,
  MultiTeamPlan,
} from '@itrtg-sim/core';
import { parseRosterFile, buildDefaultTeam, parseTeamSpec } from './roster.js';
import {
  formatImportSummary,
  formatRunResult,
  formatFarmOptimizeResult,
  formatTeamOptimizeResult,
  formatMultiTeamResult,
  formatTrace,
} from './format.js';
import {
  importPetExport,
  resolveActiveTeams,
  sweepDifficulties,
  formatActiveTeamsReport,
  applyGearOverrides,
} from './activeTeams.js';
import type { GearOverrideSpec } from './activeTeams.js';
import { parseStatisticsExport } from '@itrtg-sim/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** List of valid non-InfinityTower dungeon IDs for help messages. */
const STANDARD_DUNGEON_IDS: DungeonId[] = [
  'NewbieGround',
  'Scrapyard',
  'WaterTemple',
  'Volcano',
  'Mountain',
  'Forest',
];

function validDungeonIds(): string {
  return [...DUNGEON_REGISTRY.keys()].join(', ');
}

function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`Error: ${name} must be a positive integer (got "${value}")`);
    process.exit(1);
  }
  return n;
}

function parseNonNegInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0) {
    console.error(`Error: ${name} must be a non-negative integer (got "${value}")`);
    process.exit(1);
  }
  return n;
}

function parseDungeonId(id: string): DungeonId {
  const dungeon = getDungeon(id as DungeonId);
  if (dungeon === undefined) {
    console.error(
      `Error: unknown dungeon id "${id}".\nValid ids: ${validDungeonIds()}`,
    );
    process.exit(1);
  }
  return id as DungeonId;
}

function parseDepth(value: string): Depth {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 4) {
    console.error(`Error: --depth must be 1–4 (got "${value}")`);
    process.exit(1);
  }
  return n as Depth;
}

function parseDifficulty(value: string): Difficulty {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0 || n > 10) {
    console.error(`Error: --difficulty must be 0–10 (got "${value}")`);
    process.exit(1);
  }
  return n as Difficulty;
}

function readRosterFile(filePath: string): {
  roster: ReadonlyMap<PetId, Pet>;
  warnings: ReadonlyArray<string>;
} {
  const abs = resolvePath(filePath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf-8');
  } catch (e) {
    console.error(`Error: cannot read roster file "${filePath}": ${String(e)}`);
    process.exit(1);
  }
  try {
    return parseRosterFile(text);
  } catch (e) {
    console.error(`Error parsing roster file "${filePath}": ${String(e)}`);
    process.exit(1);
  }
}

// ── Program ───────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('itrtg-sim')
  .description('ITRTG Pet Dungeon Simulator + Optimizer')
  .version('0.0.0');

// ── import ────────────────────────────────────────────────────────────────────

program
  .command('import <file>')
  .description('Import pets from an in-game export file and show a roster summary')
  .option('--out <path>', 'write the normalized pets JSON to this path')
  .action((file: string, options: { out?: string }) => {
    const abs = resolvePath(file);
    let text: string;
    try {
      text = readFileSync(abs, 'utf-8');
    } catch (e) {
      console.error(`Error: cannot read file "${file}": ${String(e)}`);
      process.exit(1);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      console.error(`Error: file "${file}" is not valid JSON: ${String(e)}`);
      process.exit(1);
    }

    let pets: ReadonlyArray<Pet>;
    let warnings: ReadonlyArray<string>;
    try {
      const result = defaultRegistry.importAuto(raw);
      pets = result.pets;
      warnings = result.warnings;
    } catch (e) {
      if (e instanceof ImporterError) {
        console.error(`Import error: ${e.message}`);
      } else {
        console.error(`Unexpected error during import: ${String(e)}`);
      }
      process.exit(1);
    }

    console.log(`Imported ${pets.length} pet(s).\n`);
    console.log(formatImportSummary(pets));

    if (warnings.length > 0) {
      console.log('\nWarnings:');
      for (const w of warnings) {
        console.log(`  ! ${w}`);
      }
    }

    if (options.out !== undefined) {
      const outPath = resolvePath(options.out);
      try {
        writeFileSync(outPath, JSON.stringify([...pets], null, 2), 'utf-8');
        console.log(`\nRoster written to ${outPath}`);
      } catch (e) {
        console.error(`Error writing output file "${options.out}": ${String(e)}`);
        process.exit(1);
      }
    }
  });

// ── simulate ──────────────────────────────────────────────────────────────────

program
  .command('simulate')
  .description('Simulate a dungeon run for a given team and configuration')
  .requiredOption('--roster <file>', 'normalized pets JSON or raw export file')
  .option('--dungeon <id>', 'dungeon id (default: Scrapyard)', 'Scrapyard')
  .option('--depth <n>', 'depth tier 1–4 (default: 1)', '1')
  .option('--difficulty <n>', 'difficulty 0–10 (default: 0)', '0')
  .option('--rooms <n>', 'number of rooms 1–60 (default: 6)', '6')
  .option(
    '--mode <mode>',
    'evaluation mode: expected | montecarlo (default: expected)',
    'expected',
  )
  .option('--seed <n>', 'RNG seed (for Monte Carlo)')
  .option('--trials <n>', 'Monte Carlo trial count (default: 100)', '100')
  .option(
    '--phoenix-feathers <n>',
    'Phoenix Feathers carried into the run (auto-revive at 20% HP, default: 0)',
    '0',
  )
  .option(
    '--team <spec>',
    'comma-separated pet ids (default: first up-to-6 from roster)',
  )
  .action(
    (options: {
      roster: string;
      dungeon: string;
      depth: string;
      difficulty: string;
      rooms: string;
      mode: string;
      seed?: string;
      trials: string;
      phoenixFeathers: string;
      team?: string;
    }) => {
      // Parse roster.
      const { roster, warnings: rosterWarnings } = readRosterFile(options.roster);
      if (rosterWarnings.length > 0) {
        for (const w of rosterWarnings) {
          console.warn(`Roster warning: ${w}`);
        }
      }

      // Parse dungeon.
      const dungeonId = parseDungeonId(options.dungeon);
      const dungeon = getDungeon(dungeonId);
      if (dungeon === undefined) {
        console.error(`Error: dungeon "${dungeonId}" not found.`);
        process.exit(1);
      }

      const depth = parseDepth(options.depth);
      const difficulty = parseDifficulty(options.difficulty);
      const rooms = parsePositiveInt(options.rooms, '--rooms');

      if (rooms < 1 || rooms > 60) {
        console.error(`Error: --rooms must be between 1 and 60 (got ${rooms})`);
        process.exit(1);
      }

      const mode = options.mode.toLowerCase();
      if (mode !== 'expected' && mode !== 'montecarlo') {
        console.error(
          `Error: --mode must be "expected" or "montecarlo" (got "${options.mode}")`,
        );
        process.exit(1);
      }
      const evaluationMode = mode === 'montecarlo' ? 'monteCarlo' : 'expected';

      const seed =
        options.seed !== undefined ? parseNonNegInt(options.seed, '--seed') : undefined;
      const trials = parsePositiveInt(options.trials, '--trials');
      const phoenixFeathers = parseNonNegInt(options.phoenixFeathers, '--phoenix-feathers');

      // Build team.
      let team: Team;
      if (options.team !== undefined && options.team.trim().length > 0) {
        try {
          const parsed = parseTeamSpec(options.team, roster);
          team = parsed ?? buildDefaultTeam(roster);
        } catch (e) {
          console.error(`Error: ${String(e)}`);
          process.exit(1);
        }
      } else {
        team = buildDefaultTeam(roster);
      }

      if (team.slots.length === 0) {
        console.error('Error: team has no slots. Ensure the roster is non-empty.');
        process.exit(1);
      }

      // Build RunConfig.
      const config: RunConfig = {
        team,
        dungeonId,
        depth,
        difficulty,
        rooms,
        nrdcCompletions: 0,
        evaluationMode,
        ...(phoenixFeathers > 0 ? { phoenixFeathers } : {}),
        ...(seed !== undefined ? { rngSeed: seed } : {}),
        ...(evaluationMode === 'monteCarlo' ? { monteCarloTrials: trials } : {}),
      };

      // Run simulation.
      let result;
      try {
        result = simulateRun(config, {
          dungeon,
          roster,
          constants: DEFAULT_CONSTANTS,
        });
      } catch (e) {
        console.error(`Simulation error: ${String(e)}`);
        process.exit(1);
      }

      console.log(formatRunResult(result, roster));
    },
  );

// ── optimize ──────────────────────────────────────────────────────────────────

program
  .command('optimize')
  .description('Optimize farm target or team composition against an objective')
  .requiredOption('--roster <file>', 'normalized pets JSON or raw export file')
  .requiredOption(
    '--dimension <dim>',
    'optimization dimension: farm | team | multiteam | gear',
  )
  .requiredOption('--objective <id>', 'objective id (see objectiveRegistry)')
  .option('--dungeon <id>', 'dungeon id (default: Scrapyard)', 'Scrapyard')
  .option(
    '--algorithm <algo>',
    'algorithm: enumerate | greedy | beam (default: enumerate for farm, greedy for team)',
  )
  .option('--depth <n>', 'depth tier 1–4 (default: 1)', '1')
  .option('--difficulty <n>', 'difficulty 0–10 (default: 0)', '0')
  .option('--rooms <n>', 'number of rooms (default: 6)', '6')
  .option(
    '--teams <n>',
    'team slots for multiteam dimension (default: 6)',
    '6',
  )
  .option(
    '--dungeons <ids>',
    'multiteam: comma-separated dungeon ids teams may pick from (default: --dungeon)',
  )
  .option(
    '--max-unlocked-depth <n>',
    'multiteam: highest depth the account has unlocked, 1–4 (default: 3; 4 needs all NRDCs)',
  )
  .option('--seed <n>', 'RNG seed for greedy/beam restarts')
  .option('--max-iterations <n>', 'max optimizer iterations (default: 1000)', '1000')
  .action(
    (options: {
      roster: string;
      dimension: string;
      objective: string;
      dungeon: string;
      algorithm?: string;
      depth: string;
      difficulty: string;
      rooms: string;
      teams: string;
      dungeons?: string;
      maxUnlockedDepth?: string;
      seed?: string;
      maxIterations: string;
    }) => {
      // Gear dimension is not yet wired in.
      if (options.dimension === 'gear') {
        console.log(
          'Gear optimization is not yet wired in CLI. ' +
            'Use --dimension farm, team, or multiteam.',
        );
        process.exit(0);
      }

      if (
        options.dimension !== 'farm' &&
        options.dimension !== 'team' &&
        options.dimension !== 'multiteam'
      ) {
        console.error(
          `Error: --dimension must be "farm", "team", "multiteam", or "gear" (got "${options.dimension}")`,
        );
        process.exit(1);
      }

      // Validate objective.
      const objective = objectiveRegistry.get(options.objective);
      if (objective === undefined) {
        const available = [...objectiveRegistry.keys()].join(', ');
        console.error(
          `Error: unknown objective "${options.objective}".\nAvailable: ${available}`,
        );
        process.exit(1);
      }

      // Parse roster.
      const { roster, warnings: rosterWarnings } = readRosterFile(options.roster);
      if (rosterWarnings.length > 0) {
        for (const w of rosterWarnings) {
          console.warn(`Roster warning: ${w}`);
        }
      }

      // Parse dungeon.
      const dungeonId = parseDungeonId(options.dungeon);
      const dungeon = getDungeon(dungeonId);
      if (dungeon === undefined) {
        console.error(`Error: dungeon "${dungeonId}" not found.`);
        process.exit(1);
      }

      const depth = parseDepth(options.depth);
      const difficulty = parseDifficulty(options.difficulty);
      const rooms = parsePositiveInt(options.rooms, '--rooms');
      const maxIterations = parsePositiveInt(options.maxIterations, '--max-iterations');

      const seed =
        options.seed !== undefined ? parseNonNegInt(options.seed, '--seed') : 42;
      const rng = mulberry32(seed);

      const algoParsed =
        options.algorithm ??
        (options.dimension === 'farm' ? 'enumerate' : 'greedy');

      if (!['enumerate', 'greedy', 'beam'].includes(algoParsed)) {
        console.error(
          `Error: --algorithm must be enumerate, greedy, or beam (got "${algoParsed}")`,
        );
        process.exit(1);
      }

      // ── Farm dimension ────────────────────────────────────────────────────
      if (options.dimension === 'farm') {
        const team = buildDefaultTeam(roster);
        if (team.slots.length === 0) {
          console.error('Error: roster is empty — cannot build a team for farm optimization.');
          process.exit(1);
        }

        const problem = makeFarmTargetProblem({
          team,
          dungeon,
          roster,
          objective,
          constants: DEFAULT_CONSTANTS,
        });

        let best: FarmTargetCandidate;
        let score: number;
        let trace;

        if (algoParsed === 'enumerate') {
          const optimizer = new EnumerationOptimizer();
          const result = optimizer.run(problem, {
            maxIterations,
            traceVerbosity: 'final',
          });
          best = result.best as FarmTargetCandidate;
          score = result.score;
          trace = result.trace;
        } else if (algoParsed === 'greedy') {
          const optimizer = new GreedyOptimizer(rng);
          const result = optimizer.run(problem, {
            maxIterations,
            traceVerbosity: 'final',
          });
          best = result.best as FarmTargetCandidate;
          score = result.score;
          trace = result.trace;
        } else {
          // beam
          const optimizer = new BeamSearchOptimizer(rng);
          const result = optimizer.run(problem, {
            maxIterations,
            traceVerbosity: 'final',
          });
          best = result.best as FarmTargetCandidate;
          score = result.score;
          trace = result.trace;
        }

        console.log(formatFarmOptimizeResult(best, score, trace.length));
        if (trace.length > 0) {
          console.log(formatTrace(trace));
        }
        return;
      }

      // ── Multi-team dimension ──────────────────────────────────────────────
      if (options.dimension === 'multiteam') {
        const teamCount = parsePositiveInt(options.teams, '--teams');

        // Candidate dungeons: --dungeons list (each resolved) or the single --dungeon.
        let dungeons = [dungeon];
        if (options.dungeons !== undefined && options.dungeons.trim().length > 0) {
          dungeons = options.dungeons.split(',').map(s => {
            const id = parseDungeonId(s.trim());
            const d = getDungeon(id);
            if (d === undefined) {
              console.error(`Error: dungeon "${id}" not found (in --dungeons).`);
              process.exit(1);
            }
            return d;
          });
        }

        const maxUnlockedDepth =
          options.maxUnlockedDepth !== undefined
            ? parseDepth(options.maxUnlockedDepth)
            : undefined;
        const mtInputs = {
          roster,
          dungeons,
          objective,
          constants: DEFAULT_CONSTANTS,
          teamCount,
          ...(maxUnlockedDepth !== undefined ? { maxUnlockedDepth } : {}),
        };
        const mtProblem = makeMultiTeamProblem(mtInputs);
        const mtResult = new GreedyOptimizer(rng).run(mtProblem, {
          maxIterations,
          traceVerbosity: 'final',
        });
        const plan = mtResult.best as MultiTeamPlan;
        console.log(formatMultiTeamResult(plan, mtResult.score, mtInputs, roster));
        if (mtResult.trace.length > 0) {
          console.log(formatTrace(mtResult.trace));
        }
        return;
      }

      // ── Team dimension ────────────────────────────────────────────────────
      const problem = makeTeamCompositionProblem({
        roster,
        dungeon,
        depth,
        difficulty,
        rooms,
        objective,
        constants: DEFAULT_CONSTANTS,
      });

      const optimizerClass =
        algoParsed === 'enumerate'
          ? 'enumerate'
          : algoParsed === 'beam'
            ? 'beam'
            : 'greedy';

      let best: Team;
      let score: number;
      let trace;

      if (optimizerClass === 'enumerate') {
        // EnumerationOptimizer won't work for team (no allCandidates()); use greedy.
        console.warn(
          'Note: "enumerate" is not supported for team dimension (search space is unbounded). ' +
            'Falling back to greedy.',
        );
        const optimizer = new GreedyOptimizer(rng);
        const result = optimizer.run(problem, {
          maxIterations,
          traceVerbosity: 'final',
        });
        best = result.best as Team;
        score = result.score;
        trace = result.trace;
      } else if (optimizerClass === 'beam') {
        const optimizer = new BeamSearchOptimizer(rng);
        const result = optimizer.run(problem, {
          maxIterations,
          traceVerbosity: 'final',
        });
        best = result.best as Team;
        score = result.score;
        trace = result.trace;
      } else {
        const optimizer = new GreedyOptimizer(rng);
        const result = optimizer.run(problem, {
          maxIterations,
          traceVerbosity: 'final',
        });
        best = result.best as Team;
        score = result.score;
        trace = result.trace;
      }

      console.log(formatTeamOptimizeResult(best, score, roster));
      if (trace.length > 0) {
        console.log(formatTrace(trace));
      }
    },
  );

// ── active-teams ──────────────────────────────────────────────────────────────

program
  .command('active-teams')
  .description(
    'Simulate all active dungeon teams from the in-game export files.\n' +
    'Reads DungeonTeamsStart + pet export, auto-detects each team\'s dungeon\n' +
    'from the Action column, then sweeps depth/difficulty to show clear status.',
  )
  .requiredOption(
    '--pet-export <file>',
    'pet export text file (NameElementGrowthDungeon_LevelC.txt or similar)',
  )
  .requiredOption(
    '--dungeon-teams <file>',
    'dungeon teams export text file containing ---DungeonTeamsStart---',
  )
  .option(
    '--stats <file>',
    'statistics export text file (for NRDC completions; optional)',
  )
  .option('--depth <n>', 'depth tier to sweep 1–4 (default: 4)', '4')
  .option('--rooms <n>', 'rooms per run 1–60 (default: 60)', '60')
  .option(
    '--gear-override <file>',
    'JSON file specifying gear changes per pet (see docs). Use with --force-derive.',
  )
  .option(
    '--force-derive',
    'Re-derive pet stats from formula + equipment instead of using imported observed stats. ' +
    'Required when using --gear-override.',
  )
  .action(
    (options: {
      petExport: string;
      dungeonTeams: string;
      stats?: string;
      depth: string;
      rooms: string;
      gearOverride?: string;
      forceDerive?: boolean;
    }) => {
      // Read files
      const petExportPath = resolvePath(options.petExport);
      const dungeonTeamsPath = resolvePath(options.dungeonTeams);

      let petExportText: string;
      let dungeonTeamText: string;

      try {
        petExportText = readFileSync(petExportPath, 'utf-8');
      } catch (e) {
        console.error(`Error: cannot read pet export file "${options.petExport}": ${String(e)}`);
        process.exit(1);
      }

      try {
        dungeonTeamText = readFileSync(dungeonTeamsPath, 'utf-8');
      } catch (e) {
        console.error(
          `Error: cannot read dungeon teams file "${options.dungeonTeams}": ${String(e)}`,
        );
        process.exit(1);
      }

      // Parse optional stats for NRDC completions
      let nrdcCompletions = 0;
      if (options.stats !== undefined) {
        try {
          const statsText = readFileSync(resolvePath(options.stats), 'utf-8');
          nrdcCompletions = parseStatisticsExport(statsText).nrdcCompletions;
        } catch (e) {
          console.warn(`Warning: could not read stats file "${options.stats}": ${String(e)}`);
        }
      }

      // Import pets
      const { pets, roster: baseRoster, warnings: importWarnings } = importPetExport(petExportText);

      // Apply gear overrides if provided
      let roster = baseRoster;
      const forceDerive = options.forceDerive === true;
      if (options.gearOverride !== undefined) {
        let overrideSpec: GearOverrideSpec;
        try {
          overrideSpec = JSON.parse(readFileSync(resolvePath(options.gearOverride), 'utf-8')) as GearOverrideSpec;
        } catch (e) {
          console.error(`Error: cannot read/parse gear override file "${options.gearOverride}": ${String(e)}`);
          process.exit(1);
        }
        roster = applyGearOverrides(roster, overrideSpec);
        if (!forceDerive) {
          console.warn(
            'Warning: --gear-override was provided without --force-derive. ' +
            'Gear changes will have no effect on imported pets that have observed stats. ' +
            'Add --force-derive to re-derive stats from the formula.',
          );
        }
      }

      // Resolve teams + dungeons
      const { activeTeams, warnings: teamWarnings } = resolveActiveTeams(
        dungeonTeamText,
        petExportText,
        pets,
      );

      const depth = parseDepth(options.depth);
      const rooms = parsePositiveInt(options.rooms, '--rooms');

      if (depth === 4 && nrdcCompletions < 20) {
        console.warn(
          `Warning: D4 requires 20 NRDC completions but stats show ${nrdcCompletions}. ` +
            'Pass --stats to load your completions, or use --depth 3.',
        );
      }

      // Sweep each team
      const sweepsByTeam = new Map<number, ReturnType<typeof sweepDifficulties>>();
      for (const at of activeTeams) {
        sweepsByTeam.set(
          at.teamIndex,
          sweepDifficulties(at.team, at.dungeonId, depth, rooms, nrdcCompletions, roster, forceDerive),
        );
      }

      // Combine warnings (show import warnings only if there are non-routine ones)
      const routineImportWarnings = new Set([
        'Training stats',
        'growthRequiredForEvolution',
      ]);
      const filteredImportWarnings = importWarnings.filter(
        w => !routineImportWarnings.has(w.slice(0, 20)),
      );

      const allWarnings = [
        ...filteredImportWarnings,
        ...teamWarnings,
      ];

      console.log(
        formatActiveTeamsReport(activeTeams, sweepsByTeam, depth, nrdcCompletions, allWarnings),
      );

      console.log(`\n(Imported ${pets.length} pets; ${activeTeams.length} active teams simulated.)`);
    },
  );

// ── Parse ─────────────────────────────────────────────────────────────────────

// Expose STANDARD_DUNGEON_IDS to avoid lint warnings about unused variable.
void STANDARD_DUNGEON_IDS;

program.parse(process.argv);
