# ITRTG Pet Dungeons — Research Reference

Research compiled for the **ITRTG-DungeonSim** project. The goal of this document
is to capture how Pet Dungeons work in *Idling to Rule the Gods* (ITRTG) and the
math behind them, so we have a faithful basis for a simulator.

> **Sourcing note.** The primary source throughout is the official wiki, which
> migrated to **https://itrtg.wiki.gg/** (the older `itrtg.fandom.com` and
> `itrtg.miraheze.org` mirrors are stale/intermittently down). Formulas marked
> *community-documented* come from the wiki's mechanics pages, which are compiled
> from player testing rather than published dev source. Reddit (r/itrtg) could
> not be crawled directly; community nuance came from Steam discussions instead.
> Game version context: wiki pages current as of ~March–June 2026; latest patch
> seen was 4.61.x (June 2026).

---

## 1. What Pet Dungeons Are

Pet Dungeons are a mid-to-late-game system where teams of pets are sent on
**timed, autonomous expeditions** into instanced dungeons. You pick a team,
destination, depth/difficulty, and run length, then collect results when the
timer ends — there is no manual play during the run.

Purposes:

- **Gear & material farming** — pets gather elemental crafting materials (Tiers
  1–4) used to craft weapons/armor/accessories. Pet gear boosts **both** pet
  combat stats **and** the player God's stats (attack, HP, Mystic, build/creation
  speed).
- **Pet progression** — pets earn Dungeon Levels (DL) and, post-evolution, Class
  Levels (CL).
- **Currency & resources** — a primary source of God Power, Lucky Draws, pet
  stones, and pet growth via in-run "events".

Dungeon XP/levels are **permanent and do not reset on rebirth**; rebirth only
cancels an in-progress run.

---

## 2. Unlocking & Access

- **Unlock:** own **at least 6 pets** (early pets come from beating main-game
  gods — Mouse, Frog, Bee, Egg, Armadillo, Squirrel, etc.).
- **Starting dungeon:** the **Newbie Ground** (level pets to ~DL 10 here first).
- **Elemental dungeons:** Scrapyard (Neutral), Water Temple (Water), Volcano
  (Fire), Mountain (Wind), Forest (Earth).
- **Team slots:** start with **1**; up to **6 additional** slots purchasable with
  pet stones / infinity points / gems / challenge points (the 6th specifically
  via Infinity Points).
- **Infinity Tower (endgame):** unlocks when your **top 50 pets exceed 3,000
  total Dungeon Levels**.

---

## 3. Core Gameplay Loop

1. **Assemble a team** of up to 6 pets in **two rows of 3** (front/back).
2. **Pick dungeon + Depth (1–4) + Difficulty (0–10)** and run length.
3. **Set duration in rooms** — **15 minutes per room**, 1–48 rooms (up to
   12 hours). Completing all NRDCs extends this to **60 rooms**.
4. **Run is autonomous** — pets auto-fight each room.
5. **Collect** materials, XP, and event rewards on finish; repeat.

**Boss rooms:** Room 6 (Depth 1 boss), Room 16 (Depth 2), Room 30 (Depth 3),
Room 60 (Depth 4, requires all NRDCs).

**Events:** random beneficial encounters that can fire in any room. **Runs
shorter than 6 rooms get no events.** Depth-4 second-event rewards require all
6 team pets to match the dungeon element.

**Row rules:** front row is attacked more; back row deals reduced damage —
**except Mages and Snipers**, which are exempt from the back-row penalty.

---

## 4. Terminology

| Term | Meaning |
|---|---|
| **Room** | One 15-min segment of a standard dungeon run (basic unit). |
| **Depth** | Difficulty tier of a dungeon, 1–4. |
| **Difficulty** | 0–10 setting within a depth, scaling enemy stats & rewards. Written e.g. "D2-7". |
| **Dungeon Level (DL)** | Primary pet progression stat from dungeon combat. |
| **Class Level (CL)** | Post-evolution level (1–100); many abilities scale with it. |
| **Team / Party** | Up to 6 pets assigned together (front/back rows). |
| **Events** | In-run encounters granting bonus rewards (need ≥6-room runs). |
| **NRDC** | No Rebirth Dungeon Challenge; clearing all extends runs 48→60 rooms. |
| **Infinity Tower** | Endgame floor-climbing dungeon variant (1 hr/floor). |
| **Floor** | Unit of Infinity Tower progression (distinct from "room"). |
| **Mimics / Ancient Mimics** | Elite optional encounters (D3 XP / D4 burst). |
| **Free Exp Pool** | Shared XP (~1/60 of a run's total) distributable to any pet afterward. |

> Wiki uses **"rooms"** for standard dungeons and **"floors"** only for Infinity
> Towers. Some third-party guides conflate them — keep them distinct.

---

## 5. Pet Stats

### 5.1 Training stats (mirror the God's stats)

| Stat | Pet effect | God effect (per 100 pts) |
|---|---|---|
| **Physical** | +10 HP/pt (no attack) | +1% God Physical |
| **Mystic** | +0.5 Defense/pt, +0.05 HP regen/s | +1% God Mystic |
| **Battle** | +1.0 Attack/pt | +1% God Battle |

### 5.2 Dungeon combat stats (4 core)

HP, Attack, Defense, Speed — derived from the formulas in §6.

### 5.3 Elemental levels

Four elements (Fire/Water/Wind/Earth) used in elemental damage:

- **Neutral pets:** each element = `0.75 × DL`
- **Non-neutral pets:** primary = `50 + 3 × DL`; weakness element = `-50`; others = `0`
- Weakness cycle: **Water > Fire > Wind > Earth > Water**
- Equipment enchantments **add** to element levels (then Dojo/Strategy multipliers apply).

### 5.4 Growth — the master stat

Permanent (survives rebirth), scales all dungeon stats (`Growth/200,000` factor)
and training gains. **Every +2,000 growth ≈ +1% to all dungeon stats.**

Acquired via: feeding (food restores 12.5% fullness + permanent base growth),
**Growth Campaigns**, the Growing Love Pendant, the PGC multiplier (Base→Total
growth), and temporary Magic Egg boosts for hitting evolution thresholds.

Growth Campaign gain (lowest-growth pet in group receives it):
```
growth = hours × (log15(total_growth) − 1.75) × pet_ability_multi × UPC_multi
```

### 5.5 Pet classes (post-evolution stat modifiers)

| Class | HP | Atk | Def | Spd | Role |
|---|---|---|---|---|---|
| Adventurer | 100% | 100% | 100% | 100% | Balanced |
| Mage | 40% | 150% | 40% | 120% | Glass-cannon DPS |
| Assassin | 70% | 130% | 70% | 140% | High-DPS striker |
| Rogue | 80% | 120% | 60% | 160% | Fastest; item drops |
| Defender | 120% | 40% | 120% | 40% | Tank (extra HP scaling > CL 25) |
| Supporter | 80% | 70% | 100% | 130% | Healer / team dmg-reduction |
| Blacksmith | 120% | 110% | 120% | 40% | Crafter (gear) |
| Alchemist | 80% | 100% | 80% | 110% | Crafting / utility |

Class bonus magnitude: `((growth_required_for_evolution / 50,000) + 1) × 0.5`.

"Specialist" pets (e.g., Dragon→Mage, Witch→Mage) have innate bonuses in their
recommended class and outperform wildcards there.

### 5.6 Notable abilities

- **Supporter (CL 50): ~50% team-wide damage reduction** — the single most
  impactful high-end dungeon ability.
- **Succubus:** self-heals up to 1/3 max HP per single-target attack (CL 100).
- **Lucky Coin:** each attack deals 7 / 77 / 777 / 7777 random damage.
- **Clam:** doubles GP from any dungeon event it survives.
- **Chameleon:** freely change element (matches dungeon requirements).
- **Vesuvius:** generates extra dungeon growth = 50%→200% (CL 75) of growth gained.

---

## 6. Combat Math

### 6.1 Pet stat formulas (community-documented)

```
Health   = ((10 + 24 * DL) * (1 + TotalGrowth/200000) * EquipMod * DojoMod + StratRoomMod) * ClassMod
Atk/Def/Spd = ((1 + 2.4 * DL) * (1 + TotalGrowth/200000) * EquipMod * DojoMod + StratRoomMod) * ClassMod
```

- `DL` = Dungeon Level
- `TotalGrowth` = pet's total growth
- `EquipMod` = gear multiplier (gear pieces stack **additively**, then multiply base)
- `DojoMod` = multiplicative Dojo bonus
- `StratRoomMod` = **additive** Strategy Room bonus (only for pets on the active team)
- `ClassMod` = class modifier (see §5.5)

### 6.2 Damage pipeline (full, sequential)

```
Step 1  BaseDmg         = AttackerAttack − (DefenderDefense / 2)
Step 2  ElementalFactor = (1 + A/100) / (1 + D_elem/100)
Step 3  DefenseFactor   = 1 − (D_def / (D_def + 200))
Step 4  SpeedDamage     = (AttackerSpeed − DefenderSpeed) / 2   [only if attacker faster; bypasses Defense]
Step 5  PositionMod     = 0.80 if back-row non-Mage/Sniper, else 1.0

Damage = (BaseDmg × ElementalFactor × DefenseFactor × ClassFactors + SpeedDamage) × PositionMod
```

- `A` / `D_elem` = attacker/defender **element level** in the element used. If
  `D_elem < 0`, add `|D_elem|` to `A` and set `D_elem = 0`. Neutral attackers pick
  the element with the largest `(A − D_elem)` gap.
- `D_def` = defender **Defense stat**. Soft cap: 200 Def = 50% mitigation,
  800 Def = 80% — never reaches 100%.
- Front-row pets get **+20% Speed** (feeds SpeedDamage).
- **No traditional crit system.** The multi-action speed mechanic (§6.3) is the
  burst mechanism; some classes/pets add pseudo-crits (e.g., Wind: `CL%` chance
  for `CL%` bonus damage; Lucky Coin random 7/77/777/7777).
- **Hit chance:** `(AttackerHitStat / (DefenderSpeed × 1.2)) × 100%`, floored at 5%.

Worked example: to deal **more than 1 damage** to the **Cosmic Gnome**
(99,999 Defense), pet Attack must exceed `99,999 / 2 ≈ 50,000`.

### 6.2a Strategy Room modifier

```
SRMod = (0.1 + Growth_4th / 5000) × (1 + Books / 0.4800)
```
where `Growth_4th` = 4th-lowest total pet growth among your pets, `Books` =
Strategy Books in inventory. Added inside the stat formula (after the
multiplicative chain, before ClassMod); only applies to pets on an active team.
For element levels it acts multiplicatively: `1 + (ElementLevel/30) × SRMod`.

### 6.2b Defender HP scaling

Defender HP ClassMod grows past CL 25: `ClassMod_HP = 1.20 + max(0, (CL−25)/100)`
(e.g., CL 55 → 1.50).

### 6.3 Speed → actions per round (key non-linear mechanic)

| Speed | Effect |
|---|---|
| 0 | 1 action/round |
| 1–500 | `(speed/5)%` chance of a 2nd action (100% at 500) |
| 501–1500 | `((speed−500)/10)%` chance of a 3rd action (100% at 1500) |
| 1500+ | Hard cap at 3 actions/round |

### 6.3a Run timing

```
Time per room = 15 × (1 − 0.01 × NRDC_completions) minutes
```
With all 20 NRDCs: 12 min/room. Boss rooms 6/16/30/60 → ~1.5/4/7.5/12 h at max NRDC.

### 6.4 Experience curves

```
Dungeon Level n:   n < 10 → 10 × (n−1)^2 ;   n ≥ 10 → 10 × (n−1)^2.25
Class Level n:     CL1→2 = 3,000 ;   else 1000 + 2000 × (n−1)^2
Free Exp Pool:     ≈ (1/60) × total run XP  (more with Patreon)
Crafting/camp XP:  250 × (1 + growth/20000) × hours × (1 + CrafterSpeed/100)
```

### 6.5 Training-fight math (outside dungeons)

```
EXP  = (cloneMystic * cloneBattle * clonePhysical^2.3)^(1/2.6)
dmg  = petBattle − cloneMystic/2     (delivered across 33 ticks)
```
Level-up grants `TotalGrowth / 3` stats × a 0.1→1.0 scaling factor that maxes
around level ~900+.

---

## 7. Enemy / Difficulty / Floor Scaling

There is **no single universal enemy formula** for standard dungeons — different
enemies scale differently.

### 7.1 Boss multipliers (× pet stats, at Difficulty 0)

| Boss | Multiplier |
|---|---|
| Depth 1 | ~2× |
| Depth 2 | ~12× |
| Depth 3 | ~70× |

Each difficulty level adds **+10% additive** to the multiplier (e.g., D1 Diff 5 = `2 × 1.5 = 3×`).

### 7.2 Per-enemy difficulty scaling examples (Depth 4)

- **Ancient Mimic** — base (Diff 0): 25,000,000 HP, 150,000 Atk; Frozen Aura =
  20% of Atk. **Exponential:** `Stat(d) = base × 1.4^d` (Diff 10 ≈ 28.9× base).
- **Cosmic Gnome** (Forest) — **linear/additive:**
  `Defense(d) = 99,999 + 10,000·d`, `HP(d) = 200 + 20·d`.
  Damage taken ≈ `(Atk − Def/2) / 501` before elemental/class mults.
- **Scrapyard Railgun trap** (unblockable) — **exponential:**
  `dmg(d) ≈ 20,000 × (√2)^d = 20,000 × 2^(d/2)` (Diff 0 = 20k → Diff 10 = 640k).

### 7.3 In-run event spikes (Depth 4)

- Passing **Event 1**: all monster Atk & HP **×1.5**.
- Passing **Event 2**: another **×1.5** (cumulative **×2.25**); also grants pets
  `(15 + 1.5 × difficulty)` growth each.

### 7.4 Infinity Tower scaling (floor-based — best documented)

```
HP(f)      = BaseHP    * (1 + 0.40 * f)
Defense(f) = BaseDef   * (1 + 0.40 * f)
Speed(f)   = BaseSpeed * (1 + 0.40 * f)
Attack(f)  = BaseAtk   * (1 + 0.50 * f)
```

**Doubling breakpoints:** the per-floor increment itself **doubles every 50
floors** (floors 0–49: +40%/+50%; 50–99: +80%/+100%; 100–149: +160%/+200%; …).
**XP capped at floor 200; enemy stats uncapped.**

Tower base stats (floor 0):

| Tower | Enemy | HP | Atk | Def | Spd |
|---|---|---|---|---|---|
| Neutral | Mirror of Ruin | 3333 | 150 | 0 | 100 |
| Water | Ice Queen | 1600 | 100 | 100 | 100 |
| Fire | Flare Lord | 666 | 200 | 50 | 150 |
| Wind | Sky King | 1800 | 80 | 80 | 500 |
| Earth | Unbreakable Armor | 1300 | 80 | 5000 | 20 |

### 7.5 Scaling-type summary

| Location | Per-step behavior |
|---|---|
| Infinity Tower | Additive/floor, increment doubles every 50 floors |
| Ancient Mimic | ×1.4 compounding per difficulty |
| Scrapyard Railgun | ×√2 compounding per difficulty |
| Cosmic Gnome | +10% of base per difficulty (linear) |
| D4 events | ×1.5 multiplicative spikes mid-run |

---

## 8. Rewards

### 8.1 Reward types

God Power (GP), Lucky Draws, Pet Stones, pet growth increases, crafting
materials (T1–T4, element-specific), pet equipment, XP, runes, and keys.

### 8.2 Known reward values

- **Pet food growth:** Puny 6, Strong 9, Mighty 12, Chocolate 30.
- **Lucky Draw materials:** ~T1 20 / T2 5 / T3 2 per draw.
- **Lucky Draw scaling (patch 4.26):** material multiplier `1 + (top-50 total DL / 1000)`.
- **Infinity Tower drops:** T3 = `(floor#)%` per enemy; T4 = `(floor#/20)%`;
  D4 key materials = `(floor#/4)%`. **Rogue/drop-increase effects do NOT affect
  these drop rates.**
- **Free Exp pool:** ~1/60 of a run's total XP (more with Patreon bonuses).
- **Overtime bonus (patch 4.26):** finishing past base time grants up to +85%
  (185% total) at 2× completion time.

### 8.3 Example events (illustrative — exact tables are in-game)

- D2 events: ~200–500 pet stones + 5–10 GP at ~10% spawn.
- D1 Mountain "Floating Shrine": 10%/room, +12 growth/pet with 2 Wind Elementals.
- D3 Mountain "Portal from Beyond": 17%/room, +15 growth/pet + 2–25 GP with
  1 Mage + 2 Neutral pets.

> The dungeon **info tab** shows each event's spawn % and reward on mouse-over —
> the authoritative per-dungeon source.

### 8.4 Material tiers (element-specific)

- **T1** (from D1 dungeons): Herb/Special Wood (Earth), Ice Block/Nevermelting Ice
  (Water), Feather/Bound Feather (Wind), Hot Stone/Fire Stone (Fire),
  Iron Ore/Iron Bar (Neutral).
- **T2**: crafted from 8× T1 (Alchemist, ~1 h); also from D1 bosses.
- **T3**: from D2–D3 and Infinity Tower (magic variants, sacred stones).
- **T4**: from D4 and Tower (elemental Bars/Stones, e.g., Inferno/Sun Stone,
  Mythril; plus D4 Keys).

### 8.5 Drop-bonus stacking

Drop multipliers combine **multiplicatively** across sources:
`Rogue% × Talisman% × MaterialFactory% × ChallengePoints% × PetStone% × …`

- **Rogue:** +3% per CL, multiple Rogues stack **additively** with each other.
- **Material Factory:** +2%/level (max +20% at L10); L9–10 can craft Super Lucky
  Talismans.
- **Lucky/Super Lucky Talisman:** +50% / +100%, but **one talisman covers one
  room** (a 48-room run needs 48 talismans for full coverage).
- **Lucky Draw scaling:** `1 + (top-50 total DL / 1000)`.
- Note: Rogue/drop-increase effects do **not** apply to Infinity Tower drop rates.

---

## 9. Progression Path (community consensus)

1. **Newbie Ground** → level pets to ~DL 10.
2. **D1** → push to Diff 7–8.
3. **D2** → push to Diff 8.
4. **D3** → Diff 5–6, then transition to **Mimics** for massive XP.
5. **Infinity Tower** (top-50 DL > 3,000) → T3/T4 materials + Infinity Points.

Stat priority for high content: **Growth → Class/CL (Supporter to CL 50 for
~50% team dmg reduction; Mages to CL ~20 first) → Equipment (T3 SSS+20, Mages/
Assassins first) → Speed thresholds → HP floors → elemental matching**.

Sample HP floors (Diff 0): Scrapyard ~30,000 HP (Railgun); Mountain ~15,000 HP
for mages/rogues.

---

## 6.6 Fight resolution: turns, action order, and the 50-turn cap

### 6.6.1 Turn/round structure and action counts

A single **room encounter** proceeds in discrete **turns** (also called **rounds** in
the codebase). Within each turn, every living creature (pet or enemy) performs actions
equal to its speed, subject to the actions-per-round table (research §6.3):

- **Speed 0:** 1 action/turn
- **Speed 1–500:** base 1 action + `(speed/5)%` chance of a 2nd action
- **Speed 501–1500:** base 1 action + `((speed−500)/10)%` chance of a 3rd action
- **Speed 1500+:** hard cap at 3 actions/turn

**Action order within a turn** is **randomized per turn**. Although faster creatures
are probabilistically more likely to act first (via the higher chance of multiple
actions), the exact order of all actions in a given turn is rolled each turn — there
is no fixed turn-order initiative list. This creates a stochastic element even in
expected-value simulations.

**Wiki-confirmed** (Dungeons page): "Combat consists of one or more rounds (also called
turns), in which your pets and the enemies attack each other… Speed also determines
the order of everyone's actions, with faster pets/enemies being more likely to act
first."

### 6.6.2 50-turn auto-loss limit

Fights have a **hard limit of 50 turns**. If a fight does not end (one side or the
other dead) within 50 turns, the team **loses automatically**. This is the primary
game-balance mechanism preventing degenerate stalemates (e.g., extreme defense vs.
low attack).

**Wiki-confirmed** (search results for dungeon mechanics): "In ITRTG dungeons, you
simply need to survive the incoming damage, and deal enough damage of your own to win
within the 50 turn limit."

### 6.6.3 Room structure: single room = one encounter

A **room** is the basic unit (15 minutes play-time). Each room contains **one encounter
with a variable number of enemies**. There are no sequential waves within a room — all
enemies are present simultaneously and fight as one group.

Enemies are rolled from the dungeon's `RoomEnemyTable` (a weighted pool) for each room.
The number of enemies per room is determined by:
- **Draws per room:** typically 1 draw from the table
- **Count per enemy:** each rolled enemy archetype has a min/max spawn count

Example: a room might roll "1 Ancient Mimic" or "3 Fire Slimes + 2 Fire Mages",
depending on the table and RNG.

**Boss rooms** (rooms 6, 16, 30, 60 per depth) contain the appropriate boss archetype
scaled by the `bossMult` formula (research §7.1).

### 6.6.4 Phoenix Feather and revival consumables

**Phoenix Feathers** are consumable items used during dungeon runs that revive fallen
pets.

Mechanic:
- **Trigger:** when a pet's HP drops to ≤ 0 during a turn, the game checks for an
  available Phoenix Feather in the inventory.
- **Effect:** if available, the feather is consumed at the **start of the next turn**,
  and the dead pet **auto-revives with 20% max HP restored**.
- **Availability:** players carry a limited number of feathers into a run (no in-run
  crafting). Multiple feathers can be used across a single run, reviving different pets
  as needed.
- **Crafting cost:** "6 Herbs, 1 Feather, 1 Hot Stone, 3 Antidote, 1 Magic Herb / 12 hr"
  (expensive, making them a strategic resource).

**Wiki-confirmed** (Items/Materials page): "Revives one party member and heals 20% HP.
Is used at the beginning of a turn after a party member died."

**Related consumables** (from Depth 4 guide):
- **Healing Potions:** restore HP during a run. Exact values not documented on fetched
  pages.
- **Freezing Bombs:** reduce enemy speed by 50% (once per enemy/turn unclear).
- **Nanotraps:** special mechanic for Scrapyard Nanobots (damage interaction not
  specified).

The current ITRTG-DungeonSim implementation models pets as permanently dead once killed
in a room (no revive mechanic implemented). A TODO notes this as a limitation for
future work.

---

## 10. Simulator Implications (for ITRTG-DungeonSim)

Things a faithful sim needs to model:

- **Per-pet stat derivation** from DL, Growth, Equip, Dojo, Strategy Room, Class
  (§6.1).
- **Turn resolution** with the Speed→actions table (§6.3), randomized action order
  per turn, and the 50-turn auto-loss limit (§6.6.1–6.6.2).
- **Damage formula** with Defense diminishing returns (§6.2).
- **Elemental level system** and weakness cycle (§5.3).
- **Front/back row** targeting rules + Mage/Sniper exemption (§3).
- **Per-enemy scaling** (mixed linear/exponential — don't assume one curve) and
  **D4 mid-run event spikes** (§7).
- **Infinity Tower** additive-with-50-floor-doubling scaling (§7.4).
- **Reward/event rolls** per room (≥6-room runs), drop-rate formulas (§8).
- **Class abilities** as combat modifiers (Supporter dmg reduction, heals,
  Lucky Coin burst, etc.) (§5.6).
- **Consumable mechanics** — Phoenix Feather revival, healing potions, speed debuffs,
  etc. (§6.6.4) — **currently unimplemented in the simulator**.

---

## 11. Depth unlocks, wipe penalty, and run consumables

### 11.1 Depth unlocks — room thresholds

**How depths become available:** Rather than an explicit unlock event, players access
higher depths by **reaching specific room milestones** in their runs. Depth gates are
soft — a player can always attempt a run at any depth (the game doesn't lock D2/D3/D4),
but narrative progression and tutorial guidance suggest depths in order.

**Room thresholds per depth:**

| Depth | Boss room | Time (no NRDC) | Time (20 NRDCs) | Requirement to unlock next |
|---|---|---|---|---|
| **D1** | Room 6 (90 min) | 90 min | ~72 min | None; available from start |
| **D2** | Room 16 (4 h) | 240 min | ~192 min | Informally "~15 rooms" to D2; access via running 6+ rooms at D1 |
| **D3** | Room 30 (7.5 h) | 450 min | ~360 min | Informally "~30 rooms" to D3; access via running 16+ rooms at D2 |
| **D4** | Room 60 (12 h) | 900 min | ~720 min | **All 20 NRDCs completed** (research §2, §3) |

**Interpretation (community-reported):** The player's report of "15 rooms to D2, 30 rooms
to D3" appears to describe *recommended progression* (rough totals) rather than a hard
gate. In practice, depths 1–3 are **accessible immediately** once a player owns 6 pets
(research §2). **Depth 4 is strictly locked until all 20 NRDCs are cleared** — the only
hard constraint documented.

**Wiki-confirmed** (Dungeons, Introduction to Dungeons): "Depth 4 requires clearing all
No Rebirth Dungeon Challenges." Depths 1–3 have no explicit unlock gate beyond the
initial 6-pet requirement.

**Confidence:** high for D4 gate (all NRDCs required); medium for D1–D3 (no hard gate
found, only recommendation).

### 11.2 Team-wipe rest penalty

**Full-team defeat mechanic:** When all 6 pets in a dungeon team are defeated during
a run (team wipe / total party kill), the run ends and the team becomes unavailable
for a period.

**Reported cooldown:** Player-reported as "about an hour rest, then you restart" (i.e.,
the team cannot be sent on a new run for ~60 minutes following a wipe).

**Restart behavior:** Once the cooldown expires, the next run **restarts from room 1**
(no mid-run resume or checkpointing).

**Status:** This mechanic is **player-reported but not wiki-confirmed** on accessible
pages. No exact duration found in documentation. The in-game info tab (research §8.3)
may display the exact cooldown on a defeated team.

**Confidence:** low. The rule seems plausible (time penalties for failure are common in
idle games) but the exact duration (60 minutes vs. other values) is unverified.

**Simulator implications:** Wipe penalties do not affect combat resolution or per-room
mechanics, so they are out of scope for the current simulator (which models single runs).
A scheduler/planning tool might incorporate this as a team-availability constraint.

### 11.3 Consumables — potions, bombs, traps, and events

Consumable items are single-use or limited-use resources carried into a dungeon run.
The following are confirmed or partially documented:

#### Phoenix Feathers (fully researched in §6.6.4)

Already covered: **Revive mechanic**, **20% HP restore**, **12 hr crafting cost**.

#### Healing Potions

**Confirmed to exist** but **exact mechanic not fully documented.**

- **Effect (inferred):** likely restore a fixed or percentage-based amount of HP to one
  pet or the whole team.
- **Usage (unclear):** auto-triggered when HP drops below a threshold, or manually
  activated by the player (ITRTG is fully autonomous, so likely automatic).
- **Inventory limit:** unknown whether capped or stackable.
- **Source:** crafted or earned as run rewards.

**Confidence:** low. Neither the amount restored nor the usage rule is confirmed on
fetched wiki pages.

#### Freezing Bombs

**Confirmed name and general effect**, but **exact mechanics unresolved.**

- **Effect (inferred):** reduce enemy Speed by 50% for some duration.
- **Scope (unclear):** single enemy vs. all enemies in the room.
- **Duration (unclear):** one turn, entire room, or permanent.
- **Per-use limit:** "once per enemy/turn" is unclear — does each bomb affect one enemy,
  or multiple?
- **Source:** likely crafted or looted.

**Wiki reference:** mentioned in Depth 4 guide as a trap-mitigation tool.

**Confidence:** low. The precise scope and duration are not documented.

#### Nanotraps (for Scrapyard Nanobots)

**Special mechanics for Scrapyard Depth 4 Nanobot enemies** (which have a replication
hazard — uncontrolled spawning if not handled).

- **Effect:** prevent or disable Nanobot replication.
- **Interaction (unspecified):** exact interaction with Nanobot damage or spawning
  rules unknown.
- **Usage:** likely one-time use per room or per Nanobot encounter.

**Source:** crafted or looted; required for high-difficulty Scrapyard D4 runs with
Nanobots.

**Confidence:** very low. Nanobot mechanics themselves are only partially documented
(replication hazard noted; formula not found).

#### Event-triggered consumables

Some dungeon events require specific items to *unlock a bonus outcome*:

- **Nothing (Other)** + **Hot Stone** at Scrapyard D2 (room 16 area) enables a
  special event reward. See research §8.3 (event examples); consult in-game event
  info tab for exact item requirements per dungeon/event.

**Confidence:** medium. The Nothing + Hot Stone combo is documented in community guides
and the data file; other event prerequisites may exist.

#### Summary table

| Item | Confirms usage | Effect | Duration | Per-room? | Source |
|---|---|---|---|---|---|
| **Phoenix Feather** | Yes | Revive + 20% HP | 1 pet, 1 use | Consumed per use | Crafted (12 h) |
| **Healing Potion** | Partial | Restore HP (amt unknown) | Unknown | Unclear | Crafted / Looted |
| **Freezing Bomb** | Partial | -50% enemy Speed | Unknown | Likely 1 per room | Crafted / Looted |
| **Nanotraps** | Partial | Disable Nanobot replication | Unknown | Likely per room | Crafted / Looted |
| **Nothing + Hot Stone** | Yes (event) | Unlock event bonus | Encounter | Event-specific | Looted / Crafted |

**Simulator implications:** Phoenix Feathers are partially modeled (field in `RunConfig`,
though revival logic is not yet implemented per §6.6.4, §10). Healing potions, freezing
bombs, and Nanotraps are **not currently modeled** — they would require:
1. Inventory/capacity tracking (items carried per run).
2. Auto-trigger logic (when/how items are used during combat).
3. Stat/damage adjustments mid-run (Speed debuffs, healing actions, etc.).

---

## Open Questions / Uncertainty

- Exact **DL XP-per-room** formula not located (referenced but not published on
  fetched pages).
- **Free Exp Pool** distribution UI/rules only partially confirmed.
- No explicit **rarity tiers**; "Evolution Difficulty 1–8" is the closest analog.
- HP floors (30k/15k) are from the D4 guide and may drift with patches.
- Reddit r/itrtg not directly accessible — verify community claims against the
  in-game info tab where possible.

---

## Sources

- Dungeons — https://itrtg.wiki.gg/wiki/Dungeons
- Introduction to Dungeons — https://itrtg.wiki.gg/wiki/Introduction_to_Dungeons
- Depth 4 Dungeons Guide — https://itrtg.wiki.gg/wiki/Depth_4_Dungeons_Guide
- Pets — https://itrtg.wiki.gg/wiki/Pets
- Pet Training — https://itrtg.wiki.gg/wiki/Pet_Training
- Pet Campaigns — https://itrtg.wiki.gg/wiki/Pet_Campaigns
- Token Pet Guide — https://itrtg.wiki.gg/wiki/Token_Pet_Guide
- Infinity Tower — https://itrtg.wiki.gg/wiki/Infinity_Tower
- No Rebirth Dungeon Challenge — https://itrtg.wiki.gg/wiki/No_Rebirth_Dungeon_Challenge
- Material Factory — https://itrtg.wiki.gg/wiki/Material_Factory
- Milestones — https://itrtg.wiki.gg/wiki/Milestones
- Challenges — https://itrtg.wiki.gg/wiki/Challenges
- Equip — https://itrtg.wiki.gg/wiki/Equip
- Strategy Room — https://itrtg.wiki.gg/wiki/Strategy_Room
- Treasure/Mimic — https://itrtg.wiki.gg/wiki/Treasure/Mimic
- Ancient Mimic — https://itrtg.wiki.gg/wiki/Ancient_Mimic
- Challenge Dungeons — https://itrtg.wiki.gg/wiki/Challenge_Dungeons
- Official changelog (Shugasu) — https://shugasu.com/games/itrtg/changelog.html
- Steam Community discussions — https://steamcommunity.com/app/466170/discussions/

### Community data resources (for cross-checking / importing real numbers)

- ITRTG Discord (see `#sheets-calculations`) — https://discord.com/invite/r2u6VNU
- Compiled master spreadsheet — https://docs.google.com/spreadsheets/d/1nVzUV0KHgukuujgMwDYIMOHtiL2B8bWG-Bmgk_P4mSc/edit
- Ryu's Pet Information Sheet — https://docs.google.com/spreadsheets/d/11TN7ZOCkKl6-rhhLPYubTvukwTQRCXfdSwCMnbDaRUg/edit
- Dungeon XP Calculator — https://docs.google.com/spreadsheets/d/1Zgzs2rZ7NTvjRhHJ10-g0oPPuWfkXDZT8qHrXZMTuAA/edit

> Pets can be exported in-game (Pet Crafting Menu → Export) and imported into
> these sheets — useful if we want real stat data to validate the simulator.
