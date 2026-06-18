#!/usr/bin/env node
/**
 * @itrtg-sim/cli — entry point.
 * Thin commander wrapper around @itrtg-sim/core.
 * Placeholder commands print "not implemented" until WP-K wires them up.
 */
import { Command } from 'commander';

const program = new Command();

program
  .name('itrtg-sim')
  .description('ITRTG Pet Dungeon Simulator + Optimizer')
  .version('0.0.0');

/**
 * `import` — parse an in-game pet export file and validate it.
 * Full implementation: WP-K (Phase 5).
 */
program
  .command('import <file>')
  .description('Import pets from an in-game export file')
  .action(() => {
    console.log('not implemented');
  });

/**
 * `simulate` — run the dungeon simulator against an imported roster.
 * Full implementation: WP-K (Phase 5), depends on WP-H run executor.
 */
program
  .command('simulate')
  .description('Simulate a dungeon run for a given team and configuration')
  .option('--mode <mode>', 'evaluation mode: expected | monteCarlo', 'expected')
  .option('--seed <seed>', 'RNG seed for deterministic Monte Carlo runs')
  .action(() => {
    console.log('not implemented');
  });

/**
 * `optimize` — find the optimal team/gear/farm-target against a chosen objective.
 * Full implementation: WP-K (Phase 5), depends on WP-I optimizer + WP-E objectives.
 */
program
  .command('optimize')
  .description('Optimize team composition, gear, or farm target against an objective')
  .option('--objective <id>', 'objective function id (e.g. resourceYieldPerHour)')
  .option('--mode <mode>', 'evaluation mode: expected | monteCarlo', 'expected')
  .action(() => {
    console.log('not implemented');
  });

program.parse(process.argv);
