/**
 * WP-H: Run executor.
 *
 * `simulateRun` simulates one full dungeon run room-by-room and produces a
 * `RunResult`. For 'expected' mode it does a single deterministic pass; for
 * 'monteCarlo' it runs `config.monteCarloTrials` independent seeded trials and
 * returns the median-time trial with a `RunResultDistribution` attached.
 *
 * ## Modeling choices (documented here and in JSDoc below)
 *
 * **HP persistence:** Pet HP carries over across rooms within a run. A pet that
 * is killed stays dead for the remainder of the run (no revives). This matches
 * ITRTG's autonomous-expedition model where there is no mid-run healing mechanic
 * documented in the research doc. TODO: model Supporter-heal or Succubus
 * cross-room regen if/when documented.
 *
 * **XP distribution:** When an enemy is killed, every LIVING ally receives
 * `enemy.xpValue` XP (the value is "per pet" as implied by the XP-NOTE in
 * EnemyArchetype). This reflects the research §6.4 statement that xpValue is
 * "granted to each pet in the team when this enemy is killed". Dead pets do NOT
 * receive XP for kills that occur after their death.
 *
 * **petStatsReference for bossMult:** We use the mean (average) of all living
 * ally stats at the time the boss room is entered. This gives a reasonable
 * team-strength estimate for the boss multiplier formula. If all allies are dead
 * (shouldn't normally happen before room entry) we fall back to the first slot's
 * max stats.
 *
 * **Boss-room rule:** Boss rooms map to dungeon depths by research §3:
 *   depth 1 → room 6, depth 2 → room 16, depth 3 → room 30, depth 4 → room 60.
 * This mapping is implemented directly in the run executor and does not require
 * a field on the Dungeon domain object.
 *
 * **Room enemy rolling:** For each normal room we do `drawsPerRoom` weighted
 * draws from the RoomEnemyTable (with replacement). Each draw selects one
 * EnemyArchetype by weight, then rolls a count in [minCount, maxCount]. The
 * same archetype can appear multiple times across draws (enemies are independent).
 * XP-NOTE: because count is random, total room XP is stochastic in MC mode and
 * approximated via the midpoint of [min,max] in EV mode (ExpectedValueRng.int
 * returns midpoint).
 *
 * **Reward modelling (simplification):** We accrue a basic material reward
 * per regular-enemy kill: 1 unit of the dungeon's element at the tier matching
 * the dungeon depth. Boss kills grant 3 units at the same tier. Events, GP,
 * Lucky Draws, pet stones, and equipment drops are modelled as zero for now.
 * TODO: implement full event/drop reward modelling per research §8 once event
 * tables are available (requires ≥6-room runs, dungeon info-tab data).
 *
 * **Round safety cap:** Combat loops are capped at 1000 rounds per room to
 * guard against degenerate configurations where neither side can kill the other
 * (e.g. extremely high-defense enemies and low-attack pets).
 *
 * Research §3, §6.3a, §6.4, §7.1, §8.
 */

import type { GameConstants } from '../constants/types.js';
import { resolve } from '../constants/types.js';
import type { CombatContext, CombatStats } from '../domain/combat.js';
import type { Depth, Difficulty } from '../domain/dungeon.js';
import type { Dungeon } from '../domain/dungeon.js';
import type { EnemyArchetype } from '../domain/enemy.js';
import type { PetId } from '../domain/ids.js';
import type { Pet } from '../domain/pet.js';
import type {
  PerPetStats,
  RewardBundle,
  RunConfig,
  RunResult,
  RunResultDistribution,
} from '../domain/run.js';
import type { Element } from '../domain/element.js';
import { deriveCombatContext } from './stats.js';
import type { GlobalModifiers } from './stats.js';
import { resolveRound } from './combat.js';
import { DeterministicExpectedStrategy, MonteCarloStrategy } from './strategies.js';
import type { CombatStrategy } from './strategy.js';
import { mulberry32, ExpectedValueRng } from './rng.js';
import type { Rng } from './rng.js';
import { scaleEnemyToContext } from './scaling.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * All external dependencies needed by `simulateRun` beyond the `RunConfig`.
 * Separating deps from config keeps the optimizer's hot inner loop clean.
 */
export interface SimulateRunDeps {
  /** The dungeon definition including enemy table and boss archetypes. */
  dungeon: Dungeon;
  /**
   * Full pet roster. Keys are PetId; values are Pet objects.
   * Every petId referenced by `config.team.slots` must have an entry here.
   */
  roster: ReadonlyMap<PetId, Pet>;
  /** Authoritative game constants — pass DEFAULT_CONSTANTS in production. */
  constants: GameConstants;
  /**
   * Optional roster-level modifiers (Dojo, Strategy Room, PGC growth, etc.).
   * Applied identically to every pet's stat derivation.
   * Omit (or pass {}) for baseline "no modifiers" simulation.
   */
  globals?: GlobalModifiers;
}

/**
 * Simulate one full dungeon run, room-by-room, and return a `RunResult`.
 *
 * For `evaluationMode === 'expected'`: single deterministic pass using
 * `DeterministicExpectedStrategy` + `ExpectedValueRng`. No `distribution`.
 *
 * For `evaluationMode === 'monteCarlo'`: runs `config.monteCarloTrials ?? 100`
 * independent trials. Each trial uses `mulberry32(seed + trialIndex)` so the
 * same seed always produces the same set of trials. Returns the trial closest
 * to the median elapsed time with `distribution` attached.
 *
 * @param config - Run configuration (team, dungeon, depth, difficulty, etc.).
 * @param deps   - External dependencies (dungeon def, roster, constants, globals).
 * @returns A fully-populated `RunResult`.
 */
export function simulateRun(config: RunConfig, deps: SimulateRunDeps): RunResult {
  if (config.evaluationMode === 'expected') {
    return runSingleTrial(config, deps, new DeterministicExpectedStrategy(), ExpectedValueRng);
  }

  // Monte Carlo: run multiple seeded trials, aggregate into distribution.
  const trials = config.monteCarloTrials ?? 100;
  const baseSeed = config.rngSeed ?? 0xdeadbeef;

  const results: RunResult[] = [];
  for (let i = 0; i < trials; i++) {
    const seed = (baseSeed + i) >>> 0;
    const rng = mulberry32(seed);
    const strategy = new MonteCarloStrategy(rng);
    results.push(runSingleTrial(config, deps, strategy, rng));
  }

  // Build distribution statistics.
  const distribution = buildDistribution(results);

  // Return the trial closest to the median elapsed time as the representative result.
  const medianTime = distribution.timeP50;
  let best = results[0]!;
  let bestDelta = Math.abs(best.elapsedMinutes - medianTime);
  for (let i = 1; i < results.length; i++) {
    const r = results[i]!;
    const delta = Math.abs(r.elapsedMinutes - medianTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = r;
    }
  }

  return {
    cleared: best.cleared,
    roomsCleared: best.roomsCleared,
    petDeaths: best.petDeaths,
    elapsedMinutes: best.elapsedMinutes,
    rewards: best.rewards,
    perPet: best.perPet,
    distribution,
  };
}

// ── Single-trial simulation ───────────────────────────────────────────────────

/**
 * Run one complete trial (all rooms) and return a `RunResult` (no distribution).
 *
 * Accepts either a strategy+rng pair (for MC) or the deterministic strategy
 * singleton + EV rng (for expected mode). The same function handles both paths
 * to avoid code duplication.
 */
function runSingleTrial(
  config: RunConfig,
  deps: SimulateRunDeps,
  strategy: CombatStrategy,
  rng: Rng,
): RunResult {
  const { dungeon, roster, constants, globals } = deps;

  // ── Step 1: Derive ally CombatContexts ────────────────────────────────────
  // Build once — we carry `currentHp` forward across rooms (HP persistence).
  const allies: CombatContext[] = [];
  for (const slot of config.team.slots) {
    const pet = roster.get(slot.petId);
    if (pet === undefined) {
      throw new Error(`Pet ${slot.petId} not found in roster`);
    }
    // Pre-evolution pets (no assignedClass) fight as Adventurer for stat derivation.
    // assignedClass must be non-null for deriveCombatContext; use 'Adventurer' as default.
    const assignedClass = slot.assignedClass ?? 'Adventurer';
    const ctx = deriveCombatContext({
      pet,
      assignedClass,
      row: slot.row,
      constants,
      ...(globals !== undefined ? { globals } : {}),
    });
    allies.push(ctx);
  }

  // ── Step 2: Per-pet accumulators ──────────────────────────────────────────
  const perPetMap = new Map<PetId, { dealt: number; taken: number; xpGained: number }>();
  for (const slot of config.team.slots) {
    perPetMap.set(slot.petId, { dealt: 0, taken: 0, xpGained: 0 });
  }

  // Track dead pets (by petId string key).
  const deadPetIds = new Set<PetId>();

  // ── Reward accumulators ────────────────────────────────────────────────────
  let totalXp = 0;
  // Material tier for regular enemies = depth; bosses also use depth tier.
  const materialTier = config.depth as 1 | 2 | 3 | 4;
  const dungeonElement: Element = dungeon.element;
  let materialCount = 0;

  // ── Step 3: Room loop ──────────────────────────────────────────────────────
  const bossRoom = BOSS_ROOM_FOR_DEPTH[config.depth];
  let roomsCleared = 0;

  for (let room = 1; room <= config.rooms; room++) {
    // Check if all allies are dead before entering the room.
    const livingAllies = allies.filter(a => a.currentHp > 0);
    if (livingAllies.length === 0) break;

    const isBossRoom = room === bossRoom;

    // Build the enemy list for this room.
    const enemies: CombatContext[] = buildRoomEnemies(
      room,
      isBossRoom,
      config.depth,
      config.difficulty,
      dungeon,
      allies,
      constants,
      rng,
    );

    if (enemies.length === 0) {
      // No enemies in this room (shouldn't happen with valid dungeon data, but guard).
      roomsCleared++;
      continue;
    }

    // ── Combat resolution loop ─────────────────────────────────────────────
    const ROUND_CAP = 1000;
    for (let round = 0; round < ROUND_CAP; round++) {
      const livingEnemies = enemies.filter(e => e.currentHp > 0);
      if (livingEnemies.length === 0) break; // All enemies defeated.

      const livingAlliesNow = allies.filter(a => a.currentHp > 0);
      if (livingAlliesNow.length === 0) break; // All allies dead.

      // Snapshot HP before the round so we can compute damage taken afterwards.
      // resolveRound mutates currentHp in-place, so we must capture this now.
      const hpBefore = new Map<string, number>();
      for (const ally of allies) {
        if (ally.petId !== undefined) {
          hpBefore.set(ally.petId, ally.currentHp);
        }
      }

      const outcome = resolveRound(allies, enemies, constants, strategy, rng);

      // Accumulate damage dealt by each pet.
      for (const slot of config.team.slots) {
        const accum = perPetMap.get(slot.petId);
        if (accum === undefined) continue;
        const dealt = outcome.damageByAttacker.get(slot.petId) ?? 0;
        accum.dealt += dealt;
      }

      // Accumulate damage taken by each pet from enemy attackers.
      // Computed as the HP drop between pre-round snapshot and post-round outcome.
      // resolveRound mutates currentHp, so we use the pre-round snapshot captured above
      // and the allyHpAfter map from the outcome (which equals currentHp after mutation).
      for (const slot of config.team.slots) {
        const accum = perPetMap.get(slot.petId);
        if (accum === undefined) continue;
        const before = hpBefore.get(slot.petId) ?? 0;
        const after = outcome.allyHpAfter.get(slot.petId) ?? before;
        const damageTaken = Math.max(0, before - after);
        accum.taken += damageTaken;
      }

      // Process deaths: record ally deaths and XP from enemy deaths.
      for (const deadKey of outcome.deaths) {
        // Is it an ally death?
        const deadAlly = allies.find(a => a.petId === deadKey);
        if (deadAlly !== undefined && deadAlly.petId !== undefined) {
          deadPetIds.add(deadAlly.petId);
        }

        // Is it an enemy death? → Award XP and materials.
        const deadEnemy = enemies.find(e => e.enemyId === deadKey);
        if (deadEnemy !== undefined) {
          // Find the archetype for this enemy to get its xpValue.
          const archetype = findArchetypeByContextId(deadKey, dungeon);
          if (archetype !== undefined) {
            const xpValue = archetype.xpValue;
            // Award XP to every currently-living ally.
            for (const slot of config.team.slots) {
              if (!deadPetIds.has(slot.petId)) {
                const accum = perPetMap.get(slot.petId);
                if (accum !== undefined) {
                  accum.xpGained += xpValue;
                  totalXp += xpValue;
                }
              }
            }
            // Accrue materials: 1 per regular enemy, 3 per boss.
            materialCount += isBossRoom ? 3 : 1;
          }
        }
      }
    }

    // After room combat: check if any allies died and mark them.
    for (const a of allies) {
      if (a.currentHp <= 0 && a.petId !== undefined) {
        deadPetIds.add(a.petId);
      }
    }

    // Count room as cleared only if at least one ally survived the room.
    const survivorsAfter = allies.filter(a => a.currentHp > 0);
    if (survivorsAfter.length === 0) {
      // Full wipe — run ends here (don't count this room as cleared).
      break;
    }
    roomsCleared++;
  }

  // ── Step 4: Build timing result ───────────────────────────────────────────
  const minutesPerRoom = resolve(constants.timing.minutesPerRoom);
  const nrdcReduction = resolve(constants.timing.nrdcReductionPerCompletion);
  const timePerRoom = minutesPerRoom * (1 - nrdcReduction * config.nrdcCompletions);
  const elapsedMinutes = roomsCleared * timePerRoom;

  // ── Step 5: Assemble rewards ──────────────────────────────────────────────
  // Accrued materials: sparse record for the dungeon element at the depth tier.
  // TODO: full reward modelling per research §8 — events (≥6-room), GP, Lucky Draws,
  // pet stones, equipment drops, key materials, runes. These are zero for now.
  const materialRecord: Partial<Record<1 | 2 | 3 | 4, number>> = {};
  if (materialCount > 0) {
    materialRecord[materialTier] = materialCount;
  }
  const materials: Partial<Record<Element, Partial<Record<1 | 2 | 3 | 4, number>>>> =
    materialCount > 0
      ? { [dungeonElement]: materialRecord }
      : {};

  const rewards: RewardBundle = {
    godPower: 0,       // TODO: model GP rewards from events/rooms (research §8.1)
    luckyDraws: 0,     // TODO: model Lucky Draw tickets (research §8.2, §8.5)
    petStones: 0,      // TODO: model pet stone rewards from events (research §8.1, §8.3)
    growthAwarded: 0,  // TODO: model growth awards from D4 events (research §7.3)
    xpTotal: totalXp,
    materials,
    equipmentDrops: 0, // TODO: model equipment drops (Rogue bonus, talisman, research §8.5)
    keyMaterials: 0,   // TODO: model D4 key materials (research §8.2, depth 4 only)
    runes: 0,          // TODO: model rune rewards (research §8.1 — exact mechanic undocumented)
  };

  // ── Step 6: Build perPet output map ──────────────────────────────────────
  const perPet = new Map<PetId, PerPetStats>();
  for (const [petId, accum] of perPetMap) {
    perPet.set(petId, {
      dealt: accum.dealt,
      taken: accum.taken,
      xpGained: accum.xpGained,
    });
  }

  const cleared = roomsCleared === config.rooms;

  return {
    cleared,
    roomsCleared,
    petDeaths: Array.from(deadPetIds),
    elapsedMinutes,
    rewards,
    perPet,
  };
}

// ── Boss-room mapping ─────────────────────────────────────────────────────────

/**
 * Maps dungeon depth to the room number where the boss appears.
 *
 * Research §3: "Boss rooms: Room 6 (Depth 1 boss), Room 16 (Depth 2),
 * Room 30 (Depth 3), Room 60 (Depth 4, requires all NRDCs)."
 */
const BOSS_ROOM_FOR_DEPTH: Readonly<Record<Depth, number>> = {
  1: 6,
  2: 16,
  3: 30,
  4: 60,
} as const;

// ── Room enemy construction ───────────────────────────────────────────────────

/**
 * Build the list of enemy CombatContexts for one room.
 *
 * For boss rooms: spawns the dungeon's boss archetype(s) at the given depth.
 * For normal rooms: draws `drawsPerRoom` enemy archetypes from the weighted
 * RoomEnemyTable, rolls a count per draw, and scales each enemy to context.
 *
 * petStatsReference (for bossMult scaling) is the mean of living ally stats.
 * This gives a fair representation of the team's current strength.
 * If no living allies exist (edge case), falls back to first-slot max stats.
 */
function buildRoomEnemies(
  _room: number,
  isBossRoom: boolean,
  depth: Depth,
  difficulty: Difficulty,
  dungeon: Dungeon,
  allies: ReadonlyArray<CombatContext>,
  constants: GameConstants,
  rng: Rng,
): CombatContext[] {
  const enemies: CombatContext[] = [];

  // Compute petStatsReference = mean of living ally stats (for bossMult).
  const petStatsRef = computeMeanAllyStats(allies);

  if (isBossRoom) {
    const bossId = dungeon.bossArchetypeId[depth];
    if (bossId === undefined) {
      // Dungeon doesn't define a boss for this depth — treat as empty boss room.
      return enemies;
    }
    // Look up the boss archetype from the dungeon's enemy table entries.
    // Boss archetypes are identified by matching id against the RoomEnemyTable
    // entries and also checking all known archetype IDs. Since the dungeon only
    // stores `bossArchetypeId` (a string id reference), the actual EnemyArchetype
    // must be provided as part of the dungeon's enemy table entries for the boss
    // to be discoverable. We search all table entries across all depths.
    const bossArchetype = findArchetypeInDungeon(bossId, dungeon);
    if (bossArchetype === undefined) {
      // Boss archetype not found in dungeon's enemy table — skip.
      return enemies;
    }
    const ctx = scaleEnemyToContext(
      bossArchetype,
      {
        difficulty,
        depth,
        ...(petStatsRef !== undefined ? { petStatsReference: petStatsRef } : {}),
      },
      constants,
    );
    enemies.push(ctx);
    return enemies;
  }

  // Normal room: draw from enemy table.
  const table = dungeon.enemyTable[depth];
  if (table === undefined || table.entries.length === 0) {
    return enemies;
  }

  const draws = table.drawsPerRoom;
  for (let d = 0; d < draws; d++) {
    const entry = weightedDraw(table.entries, rng);
    if (entry === undefined) continue;

    // Roll count in [minCount, maxCount].
    const countRange = entry.maxCount - entry.minCount;
    const count = entry.minCount + (countRange > 0 ? rng.int(countRange + 1) : 0);

    // Find the archetype for this entry.
    const archetype = findArchetypeInDungeon(entry.enemyId, dungeon);
    if (archetype === undefined) continue;

    for (let i = 0; i < count; i++) {
      const ctx = scaleEnemyToContext(
        archetype,
        { difficulty, depth },
        constants,
      );
      // Give each instance a unique enemyId so deaths can be attributed per-instance.
      const instanceCtx: CombatContext = {
        ...ctx,
        enemyId: `${archetype.id}#${d}-${i}`,
      };
      enemies.push(instanceCtx);
    }
  }

  return enemies;
}

/**
 * Weighted random draw from a RoomEnemyEntry array using cumulative weight.
 * Returns undefined if entries is empty or all weights are zero.
 */
function weightedDraw(
  entries: ReadonlyArray<{ readonly enemyId: string; readonly weight: number; readonly minCount: number; readonly maxCount: number }>,
  rng: Rng,
): { readonly enemyId: string; readonly weight: number; readonly minCount: number; readonly maxCount: number } | undefined {
  if (entries.length === 0) return undefined;

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) return undefined;

  const roll = rng.next() * totalWeight;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry;
  }
  // Fallback: return last entry (handles floating-point edge cases).
  return entries[entries.length - 1];
}

/**
 * Look up an EnemyArchetype by id from the dungeon's self-contained archetype map.
 *
 * Every `enemyId` referenced in the enemy tables and every `bossArchetypeId` value
 * must be a key in `dungeon.archetypes` (enforced by the content layer, WP-G).
 * Returns `undefined` only if the dungeon content is malformed.
 */
function findArchetypeInDungeon(id: string, dungeon: Dungeon): EnemyArchetype | undefined {
  return dungeon.archetypes[id];
}

/**
 * Look up an archetype by its base id from a CombatContext enemyId (which may
 * carry an instance suffix such as "goblin#0-1"). Strips the suffix before lookup.
 */
function findArchetypeByContextId(
  contextEnemyId: string,
  dungeon: Dungeon,
): EnemyArchetype | undefined {
  // Strip instance suffix (e.g. "goblin#0-1" → "goblin").
  const baseId = contextEnemyId.split('#')[0] ?? contextEnemyId;
  return dungeon.archetypes[baseId];
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

/**
 * Compute the arithmetic mean of stats across all living allies.
 *
 * Used as `petStatsReference` for bossMult enemy scaling (research §7.1):
 * the boss scales relative to the team's overall strength.
 * Choice: mean (average) gives a balanced representation that doesn't over-
 * weight outlier pets (a very strong Mage shouldn't make the boss impossible
 * for the tank, and a dead Defender shouldn't deflate the reference).
 *
 * Dead allies (currentHp ≤ 0) are excluded because their loss IS the penalty.
 */
function computeMeanAllyStats(allies: ReadonlyArray<CombatContext>): CombatStats | undefined {
  const living = allies.filter(a => a.currentHp > 0);
  if (living.length === 0) return undefined;

  let hp = 0, atk = 0, def = 0, spd = 0;
  for (const a of living) {
    hp  += a.stats.hp;
    atk += a.stats.atk;
    def += a.stats.def;
    spd += a.stats.spd;
  }
  const n = living.length;
  return { hp: hp / n, atk: atk / n, def: def / n, spd: spd / n };
}

// ── Monte Carlo distribution ──────────────────────────────────────────────────

/**
 * Aggregate an array of trial RunResults into a RunResultDistribution.
 *
 * - clearRate: fraction of trials where cleared === true.
 * - timeP50: median elapsedMinutes across trials.
 * - timeP95: 95th-percentile elapsedMinutes (worst-tail runs).
 * - meanRewards: element-wise average of RewardBundles across all trials.
 */
function buildDistribution(results: RunResult[]): RunResultDistribution {
  if (results.length === 0) {
    return {
      clearRate: 0,
      timeP50: 0,
      timeP95: 0,
      meanRewards: emptyRewardBundle(),
    };
  }

  const n = results.length;
  const clearCount = results.filter(r => r.cleared).length;
  const clearRate = clearCount / n;

  // Sort by elapsed time for percentile computation.
  const times = results.map(r => r.elapsedMinutes).sort((a, b) => a - b);
  const p50 = percentile(times, 0.50);
  const p95 = percentile(times, 0.95);

  // Mean rewards: sum then divide.
  const mean = meanRewardBundle(results.map(r => r.rewards), n);

  return {
    clearRate,
    timeP50: p50,
    timeP95: p95,
    meanRewards: mean,
  };
}

/**
 * Compute the p-th percentile of a sorted numeric array (linear interpolation).
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (idx - lo);
}

/** Build a zero-filled RewardBundle. */
function emptyRewardBundle(): RewardBundle {
  return {
    godPower: 0,
    luckyDraws: 0,
    petStones: 0,
    growthAwarded: 0,
    xpTotal: 0,
    materials: {},
    equipmentDrops: 0,
    keyMaterials: 0,
    runes: 0,
  };
}

/**
 * Compute the mean RewardBundle across an array of bundles.
 * Materials are averaged per-element per-tier.
 */
function meanRewardBundle(bundles: RewardBundle[], n: number): RewardBundle {
  if (bundles.length === 0 || n === 0) return emptyRewardBundle();

  let godPower = 0, luckyDraws = 0, petStones = 0, growthAwarded = 0,
      xpTotal = 0, equipmentDrops = 0, keyMaterials = 0, runes = 0;

  // Accumulate materials: element → tier → total.
  const materialAccum = new Map<string, Map<number, number>>();

  for (const b of bundles) {
    godPower       += b.godPower;
    luckyDraws     += b.luckyDraws;
    petStones      += b.petStones;
    growthAwarded  += b.growthAwarded;
    xpTotal        += b.xpTotal;
    equipmentDrops += b.equipmentDrops;
    keyMaterials   += b.keyMaterials;
    runes          += b.runes;

    for (const [el, tiers] of Object.entries(b.materials)) {
      if (tiers === undefined) continue;
      let elMap = materialAccum.get(el);
      if (elMap === undefined) {
        elMap = new Map();
        materialAccum.set(el, elMap);
      }
      for (const [tierStr, amt] of Object.entries(tiers)) {
        if (amt === undefined) continue;
        const tier = Number(tierStr);
        elMap.set(tier, (elMap.get(tier) ?? 0) + amt);
      }
    }
  }

  // Divide all accumulators by n.
  const materials: Partial<Record<Element, Partial<Record<1 | 2 | 3 | 4, number>>>> = {};
  for (const [el, tiers] of materialAccum) {
    const tierRecord: Partial<Record<1 | 2 | 3 | 4, number>> = {};
    for (const [tier, total] of tiers) {
      const t = tier as 1 | 2 | 3 | 4;
      tierRecord[t] = total / n;
    }
    (materials as Record<string, typeof tierRecord>)[el] = tierRecord;
  }

  return {
    godPower:       godPower       / n,
    luckyDraws:     luckyDraws     / n,
    petStones:      petStones      / n,
    growthAwarded:  growthAwarded  / n,
    xpTotal:        xpTotal        / n,
    materials,
    equipmentDrops: equipmentDrops / n,
    keyMaterials:   keyMaterials   / n,
    runes:          runes          / n,
  };
}
