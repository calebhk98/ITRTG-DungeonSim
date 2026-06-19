/**
 * Data-driven dungeon and archetype builder.
 *
 * Reads the two JSON source files in `./data/` and produces typed domain
 * objects (`EnemyArchetype`, `Dungeon`) from them.  No hard-coded stats.
 *
 * ## Scaling formula (deriveScalingSpec)
 *
 * The spreadsheet stores per-stat fractional rates:
 *   `scaling`       → rate for hp, def, spd
 *   `attackScaling` → rate for atk
 *
 * Assumption: `stat(difficulty) = base × (1 + rate × difficulty)`
 * so the additive delta per +1 difficulty is `base × rate`.
 * We round to the nearest integer and store it as `perDiff`.
 *
 * Example — AngelSlimy (hp=120, atk=15, def=8, spd=14, scaling=0.4, attackScaling=0.5):
 *   perDiff.hp  = round(120 × 0.4) = 48
 *   perDiff.def = round(  8 × 0.4) =  3
 *   perDiff.spd = round( 14 × 0.4) =  6
 *   perDiff.atk = round( 15 × 0.5) =  8
 *
 * Example — ScrapWorm (hp=650, atk=88, def=70, spd=65, scaling=0.3, attackScaling=0.4):
 *   perDiff.hp  = round(650 × 0.3) = 195
 *   perDiff.def = round( 70 × 0.3) =  21
 *   perDiff.spd = round( 65 × 0.3) =  20
 *   perDiff.atk = round( 88 × 0.4) =  35
 *
 * If both rates are 0, no perDiff is set at all (all stats stay at base regardless
 * of difficulty).
 *
 * ## Boss detection
 *
 * An archetype is marked `isBoss` if either:
 *   - its name contains the literal string `(Boss)`, or
 *   - the `boss` field in the JSON is `true`.
 *
 * In the roster, the first entry for a depth whose resolved archetype `isBoss`
 * becomes the `bossArchetypeId` for that depth.  All remaining boss-flagged
 * entries still go into `archetypes` (for lookup) but do NOT appear in the
 * normal `enemyTable` (they are filtered out).
 *
 * ## Enemy table
 *
 * Non-boss enemies in a depth's roster each get an equal weight of 1, and
 * spawn 1–2 per room (minCount=1, maxCount=2). This reflects that the game
 * spawns a variable number of enemies per room; 1–2 is a conservative estimate
 * that is trivially adjustable when real spawn-count data is available.
 * drawsPerRoom is 1 (one enemy type is drawn per room).
 */

import type { Dungeon, DungeonId, Depth, RoomEnemyTable } from '../domain/dungeon.js';
import type { EnemyArchetype, ScalingSpec } from '../domain/enemy.js';
import type { Element } from '../domain/element.js';
import type { ElementLevels } from '../domain/gear.js';

// ── JSON imports ─────────────────────────────────────────────────────────────

import enemiesData from './data/enemies.json' with { type: 'json' };
import rostersData from './data/dungeon-rosters.json' with { type: 'json' };

// ── Types for the raw JSON shapes ────────────────────────────────────────────

interface RawEnemy {
  readonly name: string;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly elements: { readonly Fire: number; readonly Water: number; readonly Wind: number; readonly Earth: number };
  readonly attackElement: string;
  readonly experience: number | null;
  readonly scaling: number;
  readonly attackScaling: number;
  readonly boss: boolean;
  /** Optional override: 'expDiff' or 'expSqrtDiff' takes precedence over linear derivation. */
  readonly scalingKind?: 'expDiff' | 'expSqrtDiff';
  /** Required when scalingKind is 'expDiff'. Default 1.4 (Ancient Mimic, research §7.2). */
  readonly scalingFactor?: number;
}

// ── Element validation ────────────────────────────────────────────────────────

const VALID_ELEMENTS: ReadonlySet<string> = new Set<Element>([
  'Fire', 'Water', 'Wind', 'Earth', 'Neutral',
]);

function toElement(raw: string): Element {
  if (VALID_ELEMENTS.has(raw)) return raw as Element;
  // Fallback: unknown element becomes Neutral with a note for later.
  // In practice the data is clean, so this path should not be hit.
  return 'Neutral';
}

// ── Scaling derivation ────────────────────────────────────────────────────────

/**
 * Derive a `ScalingSpec` from the raw per-stat rates in the enemy data.
 *
 * If `scalingKind` is set in the raw data, it takes precedence:
 *   - 'expDiff':     `stat(d) = base × scalingFactor^d`  (e.g. Ancient Mimic: ×1.4^d)
 *   - 'expSqrtDiff': `stat(d) = base × (√2)^d`          (e.g. Scrapyard Railgun)
 *
 * Otherwise, linear derivation from the scaling/attackScaling rates:
 *   `perDiff[stat] = round(base × rate)`
 *   so `stat(d) = base + perDiff × d`
 *
 * When both rates are 0 (and no scalingKind), the enemy does not scale.
 */
function deriveScalingSpec(enemy: RawEnemy): ScalingSpec {
  if (enemy.scalingKind === 'expDiff') {
    return { kind: 'expDiff', factor: enemy.scalingFactor ?? 1.4 };
  }
  if (enemy.scalingKind === 'expSqrtDiff') {
    return { kind: 'expSqrtDiff' };
  }
  if (enemy.scaling === 0 && enemy.attackScaling === 0) {
    return { kind: 'linear', perDiff: {} };
  }
  return {
    kind: 'linear',
    perDiff: {
      hp:  Math.round(enemy.hp       * enemy.scaling),
      def: Math.round(enemy.defense  * enemy.scaling),
      spd: Math.round(enemy.speed    * enemy.scaling),
      atk: Math.round(enemy.attack   * enemy.attackScaling),
    },
  };
}

// ── Archetype builder ─────────────────────────────────────────────────────────

/**
 * Build a single `EnemyArchetype` from one raw enemy record.
 *
 * The `id` is the enemy name verbatim (matches roster names exactly).
 * Element levels come from `enemy.elements` directly.
 *
 * TODO: specials (Railgun, Nanobot self-replication, heal, etc.) are not yet
 * populated — leave a TODO for future expansion once special mechanics are
 * modelled in combat.
 */
function buildArchetype(enemy: RawEnemy): EnemyArchetype {
  const elementLevels: ElementLevels = {
    Fire:  enemy.elements.Fire,
    Water: enemy.elements.Water,
    Wind:  enemy.elements.Wind,
    Earth: enemy.elements.Earth,
  };

  return {
    id:           enemy.name,
    baseStats: {
      hp:  enemy.hp,
      atk: enemy.attack,
      def: enemy.defense,
      spd: enemy.speed,
    },
    element:       toElement(enemy.attackElement),
    elementLevels,
    scaling:       deriveScalingSpec(enemy),
    isBoss:        enemy.boss === true || enemy.name.includes('(Boss)'),
    xpValue:       enemy.experience ?? 0,
    // TODO: populate specials array for enemies with documented mechanics:
    //   - Railgun (Scrapyard D4 trap): expSqrtDiff damage hazard
    //   - Nanobots: self-replication unless Nanotraps equipped
    //   - GhostSlimy: Scare attackType
    //   - UnstableSlimy: Explode attackType
    //   - RestorationBot, Microbots, AngelSlimy: Heal attackType
    //   See domain/enemy.ts EnemySpecial union for available kinds.
  };
}

// ── Archetype registry (all 215 enemies) ────────────────────────────────────

type EnemyDataType = typeof enemiesData;

const rawEnemies = (enemiesData as EnemyDataType).enemies as readonly RawEnemy[];

/**
 * All archetypes keyed by name (= enemy id).  Built once at module-load time.
 */
export const ALL_ARCHETYPES: Readonly<Record<string, EnemyArchetype>> =
  Object.fromEntries(rawEnemies.map(e => [e.name, buildArchetype(e)]));

/**
 * Flat array of all 215 archetypes, for validation / iteration.
 */
export const ALL_ARCHETYPES_LIST: ReadonlyArray<EnemyArchetype> =
  rawEnemies.map(e => buildArchetype(e));

// ── Dungeon builder ───────────────────────────────────────────────────────────

type RostersType = typeof rostersData;
const rawRosters = (rostersData as RostersType).rosters as Readonly<Record<string, readonly string[]>>;

/**
 * Resolve a dungeon from the roster data.
 *
 * @param id       - The `DungeonId` to assign.
 * @param element  - Primary element of the dungeon.
 * @param depthKeys - Mapping of depth number → roster key in dungeon-rosters.json.
 *                    E.g. `{ 1: 'Scrapyard1', 2: 'Scrapyard2', ... }`.
 *
 * For each depth:
 *   - Boss: the first roster member whose archetype has `isBoss = true`.
 *     Stored in `bossArchetypeId[depth]`.
 *   - Non-bosses: every other member goes into `enemyTable[depth].entries`
 *     with equal weight 1, minCount 1, maxCount 2, drawsPerRoom 1.
 *   - ALL archetypes (boss and non-boss) are added to `dungeon.archetypes`
 *     so every id resolves.
 *
 * Depths with no entries in the roster simply have no `enemyTable` or
 * `bossArchetypeId` entries for that depth.
 */
function buildDungeon(
  id: DungeonId,
  element: Element,
  depthKeys: Partial<Record<Depth, string>>,
): Dungeon {
  const archetypeAccum: Record<string, EnemyArchetype> = {};
  const enemyTable: Partial<Record<Depth, RoomEnemyTable>> = {};
  const bossArchetypeId: Partial<Record<Depth, string>> = {};

  for (const depthStr of Object.keys(depthKeys)) {
    const depth = Number(depthStr) as Depth;
    const rosterKey = depthKeys[depth];
    if (rosterKey === undefined) continue;

    const rosterNames = rawRosters[rosterKey];
    if (rosterNames === undefined || rosterNames.length === 0) continue;

    let firstBossId: string | undefined;
    const regularIds: string[] = [];

    for (const name of rosterNames) {
      const archetype = ALL_ARCHETYPES[name];
      if (archetype === undefined) {
        // Safety: skip names not in the enemy table (should never happen if data is consistent).
        continue;
      }
      archetypeAccum[name] = archetype;

      if (archetype.isBoss) {
        // First boss in the roster becomes the primary boss for this depth.
        if (firstBossId === undefined) {
          firstBossId = name;
        }
        // Additional bosses (e.g. MetalMind, Behemoth) go into archetypes but
        // not into the regular table — they are secondary bosses / alt encounters.
      } else {
        regularIds.push(name);
      }
    }

    if (firstBossId !== undefined) {
      bossArchetypeId[depth] = firstBossId;
    }

    if (regularIds.length > 0) {
      enemyTable[depth] = {
        // drawsPerRoom = 1: one enemy type is selected per room, then count is rolled.
        drawsPerRoom: 1,
        // Equal weight for all regular enemies; 1–2 per room is a conservative estimate
        // matching typical ITRTG room spawn counts. Adjust when real data is available.
        entries: regularIds.map(enemyId => ({
          enemyId,
          weight:   1,
          minCount: 1,
          maxCount: 2,
        })),
      };
    }
  }

  return {
    id,
    element,
    enemyTable,
    bossArchetypeId,
    archetypes: archetypeAccum,
  };
}

// ── Standard dungeon definitions ─────────────────────────────────────────────

/**
 * Newbie Ground (Neutral, single depth "Newbie Grounds1").
 *
 * Only depth 1 exists.  Contains a mix of beginner enemies plus several
 * event/seasonal bosses (RogueShadowClone, SuperRogueShadowClone, LoofSlirpa, etc.)
 * that appear via special conditions.  All are included in `archetypes`.
 */
export const newbieGroundDungeon: Dungeon = buildDungeon(
  'NewbieGround',
  'Neutral',
  { 1: 'Newbie Grounds1' },
);

/**
 * Scrapyard (Neutral, depths 1–4).
 *
 * The first dungeon after the Newbie Ground.  Enemies are mechanical/scrap-based.
 * Depth 1 bosses: OozingInventor (Boss).
 * Depth 2 bosses: MURDER (Boss).
 * Depth 3 bosses: AlienWreckage (Boss), MetalMind (Boss).
 * Depth 4 bosses: none with "(Boss)" suffix — YogSothoth and RoboOverlord are
 *   flagged via the `boss` field and become bossArchetypeId[4] (first one = YogSothoth).
 *
 * Note: Chameleon-SY appears in Scrapyard2 roster; it is flagged `boss=true`
 *   but does not use "(Boss)" in the name — still detected as a boss via the field.
 */
export const scrapyardDungeon: Dungeon = buildDungeon(
  'Scrapyard',
  'Neutral',
  {
    1: 'Scrapyard1',
    2: 'Scrapyard2',
    3: 'Scrapyard3',
    4: 'Scrapyard4',
  },
);

/**
 * Water Temple (Water, depths 1–4).
 *
 * Aquatic dungeon.
 * Depth 1 bosses: Godzilly (Boss).
 * Depth 2 bosses: Kraken (Boss).
 * Depth 3 bosses: Leviathan (Boss), Behemoth (Boss).
 * Depth 4 bosses: Cthulu, CursedPirateKing (both `boss=true` via field).
 */
export const waterTempleDungeon: Dungeon = buildDungeon(
  'WaterTemple',
  'Water',
  {
    1: 'Water Temple1',
    2: 'Water Temple2',
    3: 'Water Temple3',
    4: 'Water Temple4',
  },
);

/**
 * Volcano (Fire, depths 1–4).
 *
 * Fire-element dungeon.
 * Depth 1 bosses: FireLord (Boss).
 * Depth 2 bosses: Seraphim (Boss).
 * Depth 3 bosses: SunSpirit (Boss), Balrog (Boss).
 *   Note: Volcano3 also includes EvolvedBalrog variants — these are flagged `boss=true`
 *   and go into `archetypes` but are secondary encounters.
 * Depth 4 bosses: Cthugha, HellKing (both `boss=true` via field).
 */
export const volcanoDungeon: Dungeon = buildDungeon(
  'Volcano',
  'Fire',
  {
    1: 'Volcano1',
    2: 'Volcano2',
    3: 'Volcano3',
    4: 'Volcano4',
  },
);

/**
 * Mountain (Wind, depths 1–4).
 *
 * Wind-element dungeon.
 * Depth 1 bosses: ScreechingGralk (Boss).
 * Depth 2 bosses: SoaringPrelate (Boss).
 * Depth 3 bosses: LightningRevenant (Boss), UnboundHurricane (Boss).
 * Depth 4 bosses: Nyarlathotep, MountainKing (both `boss=true` via field).
 */
export const mountainDungeon: Dungeon = buildDungeon(
  'Mountain',
  'Wind',
  {
    1: 'Mountain1',
    2: 'Mountain2',
    3: 'Mountain3',
    4: 'Mountain4',
  },
);

/**
 * Forest (Earth, depths 1–4).
 *
 * Earth-element dungeon.
 * Depth 1 bosses: GroveWarden (Boss).
 * Depth 2 bosses: MossyShambler (Boss).
 * Depth 3 bosses: AgonizedForestSoul (Boss), RottingWorldTree (Boss).
 * Depth 4 bosses: ShubNiggurath, CorruptFairyQueen (both `boss=true` via field).
 */
export const forestDungeon: Dungeon = buildDungeon(
  'Forest',
  'Earth',
  {
    1: 'Forest1',
    2: 'Forest2',
    3: 'Forest3',
    4: 'Forest4',
  },
);

// TODO: Infinity Tower dungeons (InfinityTower:Neutral, InfinityTower:Fire, etc.)
// use tower-floor scaling (kind: 'towerFloor') from the tower roster columns in
// dungeon-rosters.json ('NeutralTower', 'WaterTower', 'FireTower', 'WindTower',
// 'EarthTower').  These map to DungeonId `InfinityTower:${Element}`.

/**
 * All six standard dungeons as a flat array, for iteration / validation.
 */
export const ALL_DUNGEONS: ReadonlyArray<Dungeon> = [
  newbieGroundDungeon,
  scrapyardDungeon,
  waterTempleDungeon,
  volcanoDungeon,
  mountainDungeon,
  forestDungeon,
];
