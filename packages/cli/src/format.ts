/**
 * Pure formatting helpers for CLI output.
 *
 * All functions return strings (no console.log calls) so they are
 * unit-testable without spawning a subprocess.
 */

import type { Pet } from '@itrtg-sim/core';
import type { RunResult } from '@itrtg-sim/core';
import type { PetId } from '@itrtg-sim/core';
import type { FarmTargetCandidate } from '@itrtg-sim/core';
import type { Team } from '@itrtg-sim/core';
import type { MultiTeamInputs, MultiTeamPlan } from '@itrtg-sim/core';
import { summarizeMultiTeamPlan } from '@itrtg-sim/core';

// ── Column-table helper ───────────────────────────────────────────────────────

/**
 * Render a simple fixed-width column table.
 *
 * @param headers - Column header strings.
 * @param rows    - Data rows (same length as headers per row).
 * @returns Multi-line string with a header, separator, and data rows.
 */
function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > max) max = cell.length;
    }
    return max;
  });

  const pad = (s: string, w: number): string => s.padEnd(w);

  const header = headers.map((h, i) => pad(h, widths[i] ?? h.length)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const dataRows = rows.map((row) =>
    row.map((cell, i) => pad(cell, widths[i] ?? cell.length)).join('  '),
  );

  return [header, sep, ...dataRows].join('\n');
}

// ── Import summary ────────────────────────────────────────────────────────────

/**
 * Format a roster import summary as a human-readable table.
 *
 * Columns: id | displayName | element | DL | CL | growth
 */
export function formatImportSummary(pets: ReadonlyArray<Pet>): string {
  if (pets.length === 0) {
    return '(no pets imported)';
  }

  const headers = ['id', 'displayName', 'element', 'DL', 'CL', 'growth'];
  const rows: string[][] = pets.map((p) => [
    p.id,
    p.displayName,
    p.primaryElement,
    String(p.dungeonLevel),
    String(p.classLevel),
    String(p.totalGrowth),
  ]);

  return renderTable(headers, rows);
}

// ── RunResult formatting ──────────────────────────────────────────────────────

/**
 * Format a `RewardBundle` materials map into a compact string.
 */
function formatMaterials(
  materials: RunResult['rewards']['materials'],
): string {
  const parts: string[] = [];
  for (const [el, tiers] of Object.entries(materials)) {
    if (tiers == null) continue;
    for (const [tier, amt] of Object.entries(tiers)) {
      if (typeof amt === 'number' && amt > 0) {
        parts.push(`${el} T${tier}: ${amt.toFixed(1)}`);
      }
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'none';
}

/**
 * Format a full `RunResult` into a human-readable multi-line string.
 *
 * Includes: header, timing, rewards summary, per-pet table.
 * If `distribution` is present (MC mode), also prints clearRate + p50/p95.
 */
export function formatRunResult(
  result: RunResult,
  roster: ReadonlyMap<PetId, { displayName: string }>,
): string {
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  const status = result.cleared ? 'CLEARED' : 'PARTIAL';
  lines.push(`Run Result: ${status}`);
  lines.push(
    `  Rooms cleared:   ${result.roomsCleared}`,
  );
  lines.push(
    `  Elapsed:         ${result.elapsedMinutes.toFixed(1)} min`,
  );

  // ── Deaths ─────────────────────────────────────────────────────────────────
  if (result.petDeaths.length > 0) {
    const names = result.petDeaths
      .map((id) => roster.get(id)?.displayName ?? id)
      .join(', ');
    lines.push(`  Pet deaths:      ${names}`);
  } else {
    lines.push(`  Pet deaths:      none`);
  }

  // ── Rewards ────────────────────────────────────────────────────────────────
  const r = result.rewards;
  lines.push('');
  lines.push('Rewards:');
  lines.push(`  XP total:        ${r.xpTotal.toFixed(0)}`);
  lines.push(`  God Power:       ${r.godPower.toFixed(2)}`);
  lines.push(`  Lucky Draws:     ${r.luckyDraws.toFixed(2)}`);
  lines.push(`  Pet Stones:      ${r.petStones.toFixed(2)}`);
  lines.push(`  Growth awarded:  ${r.growthAwarded.toFixed(0)}`);
  lines.push(`  Materials:       ${formatMaterials(r.materials)}`);
  lines.push(`  Equipment drops: ${r.equipmentDrops}`);
  lines.push(`  Key materials:   ${r.keyMaterials}`);
  lines.push(`  Runes:           ${r.runes}`);

  // ── Per-pet table ──────────────────────────────────────────────────────────
  lines.push('');
  lines.push('Per-pet stats:');
  const headers = ['pet', 'dealt', 'taken', 'xp'];
  const rows: string[][] = [];
  for (const [petId, stats] of result.perPet) {
    const name = roster.get(petId)?.displayName ?? petId;
    rows.push([
      name,
      stats.dealt.toFixed(0),
      stats.taken.toFixed(0),
      stats.xpGained.toFixed(0),
    ]);
  }
  if (rows.length > 0) {
    lines.push(renderTable(headers, rows));
  }

  // ── Monte Carlo distribution ───────────────────────────────────────────────
  if (result.distribution !== undefined) {
    const d = result.distribution;
    lines.push('');
    lines.push('Monte Carlo distribution:');
    lines.push(`  Clear rate:  ${(d.clearRate * 100).toFixed(1)}%`);
    lines.push(`  Time p50:    ${d.timeP50.toFixed(1)} min`);
    lines.push(`  Time p95:    ${d.timeP95.toFixed(1)} min`);
  }

  return lines.join('\n');
}

// ── Optimize result ───────────────────────────────────────────────────────────

/**
 * Format the best FarmTargetCandidate found by the optimizer.
 */
export function formatFarmOptimizeResult(
  best: FarmTargetCandidate,
  score: number,
  traceLength: number,
): string {
  const lines: string[] = [
    'Optimize Result (farm):',
    `  Best depth:       ${best.depth}`,
    `  Best difficulty:  ${best.difficulty}`,
    `  Best rooms:       ${best.rooms}`,
    `  Score:            ${score.toFixed(4)}`,
    `  Candidates evaluated: ${traceLength > 0 ? 'see trace' : '(no trace)'}`,
  ];
  return lines.join('\n');
}

/**
 * Format the best Team found by the optimizer.
 */
export function formatTeamOptimizeResult(
  best: Team,
  score: number,
  roster: ReadonlyMap<PetId, { displayName: string }>,
): string {
  const lines: string[] = [
    'Optimize Result (team):',
    `  Score: ${score.toFixed(4)}`,
    '  Team:',
  ];

  for (const slot of best.slots) {
    const name = roster.get(slot.petId)?.displayName ?? slot.petId;
    lines.push(
      `    [${slot.row.padEnd(5)}] ${name} (${slot.assignedClass ?? 'no class'})`,
    );
  }

  return lines.join('\n');
}

/**
 * Format a multi-team roster partition: aggregate score plus a per-team
 * breakdown (target, clear status, and roster) so the player can see how the
 * roster was split across teams.
 */
export function formatMultiTeamResult(
  plan: MultiTeamPlan,
  score: number,
  inputs: MultiTeamInputs,
  roster: ReadonlyMap<PetId, { displayName: string }>,
): string {
  const summaries = summarizeMultiTeamPlan(plan, inputs);
  const lines: string[] = [
    'Optimize Result (multiteam):',
    `  Aggregate score: ${score.toFixed(4)}`,
    `  Teams used:      ${summaries.length}`,
    '',
  ];

  if (summaries.length === 0) {
    lines.push('  (no pets assigned to any team)');
    return lines.join('\n');
  }

  summaries.forEach((s, i) => {
    const tp = s.plan;
    const status = s.result.cleared ? 'CLEARED' : `partial (${s.result.roomsCleared} rooms)`;
    lines.push(
      `  Team ${i + 1}: D${tp.depth}-${tp.difficulty}, ${tp.rooms} rooms — ${status}` +
        (s.feasible ? '' : ' [infeasible for objective]'),
    );
    for (const slot of tp.team.slots) {
      const name = roster.get(slot.petId)?.displayName ?? slot.petId;
      lines.push(`    [${slot.row.padEnd(5)}] ${name} (${slot.assignedClass ?? 'no class'})`);
    }
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}

/**
 * Format a score trace into a compact summary string (first/last/best).
 */
export function formatTrace(
  trace: ReadonlyArray<{ iteration: number; bestScore: number }>,
): string {
  if (trace.length === 0) return '  (no trace)';

  const lines: string[] = ['  Score trace:'];
  for (const entry of trace) {
    lines.push(`    iter ${entry.iteration}: ${entry.bestScore.toFixed(4)}`);
  }
  return lines.join('\n');
}
