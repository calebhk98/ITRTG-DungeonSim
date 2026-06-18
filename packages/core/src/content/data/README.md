# Content Data

These JSON files are the **user-editable source of truth** for enemy stats and dungeon rosters.
Editing them updates the sim without any code changes.

## enemies.json

Master enemy table. Each entry has:

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique enemy name (must match roster names exactly) |
| `description` | string | Flavour text |
| `hp` | number | Base HP at difficulty 0 |
| `attack` | number | Base ATK at difficulty 0 |
| `defense` | number | Base DEF at difficulty 0 |
| `speed` | number | Base SPD at difficulty 0 |
| `elements` | object | Elemental levels `{Fire,Water,Wind,Earth}` — positive = strength, negative = weakness |
| `attackElement` | string | Element of attack: `Fire`, `Water`, `Wind`, `Earth`, or `Neutral` |
| `attackType` | string | Attack behaviour (OneTarget, TwoTargets, MultiTargetMagic, Heal, Defend, Summon, etc.) |
| `attack2` / `attack3` | string\|null | Secondary/tertiary attack types |
| `statusAttack` | string\|null | Status effect the enemy may inflict |
| `experience` | number\|null | XP granted per kill |
| `drops` | array | Item drop table: `[{item, chance}]` where `chance` is percentage |
| `scaling` | number | Per-difficulty HP/DEF/SPD rate: `stat(d) = base × (1 + rate × d)` |
| `attackScaling` | number | Per-difficulty ATK rate: `atk(d) = base × (1 + rate × d)` |
| `boss` | boolean | Whether the enemy is classified as a boss |
| `row` | number | Source row from original spreadsheet (informational) |

### Scaling formula

`perDiff = round(base × rate)` — that is, the additive delta added per +1 difficulty.
So `stat(difficulty) = base + perDiff × difficulty`.
If both `scaling` and `attackScaling` are 0, the enemy does not scale with difficulty.

## dungeon-rosters.json

Maps a dungeon+depth label to an ordered list of enemy names.

Key format: `"<DungeonName><Depth>"` (e.g. `"Scrapyard1"`, `"Water Temple2"`).

Enemy names containing `(Boss)` are treated as boss enemies and go into
`bossArchetypeId` rather than the normal `enemyTable`.

The first `(Boss)` enemy in a depth's roster becomes the `bossArchetypeId` for that depth.
