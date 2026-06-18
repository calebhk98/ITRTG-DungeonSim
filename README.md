# ITRTG-DungeonSim

A simulator **and** optimizer for **pet dungeons** in *Idling to Rule the Gods* (ITRTG).

Import your in-game pet export, simulate dungeon runs (deterministic or Monte-Carlo),
and have the optimizer search for the best **team composition**, **gear allocation**,
and **farm target** against a configurable objective (resource yield/hour, max clearable
depth, survival rate, …).

It's a TypeScript pnpm monorepo:

| Package | What it is |
|---|---|
| `@itrtg-sim/core` (`packages/core`) | The engine — pure, UI-agnostic: domain model, stat pipeline, combat resolver, enemy scaling, run executor, importers, objectives, optimizer. |
| `@itrtg-sim/cli` (`packages/cli`) | A terminal app: `import` / `simulate` / `optimize`. |
| `@itrtg-sim/web` (`packages/web`) | A React + Vite browser app: paste your export, simulate, optimize. |

---

## Prerequisites

- **Node.js ≥ 20**
- **pnpm 9** — if you don't have it: `npm install -g pnpm` (or `corepack enable`)

## Install (do this first!)

```bash
pnpm install
```

> If you see `sh: 1: vite: not found` or `node_modules missing`, you skipped this step.
> Run `pnpm install` from the **repo root** — it installs all three packages.

## Run the web app

```bash
pnpm --filter @itrtg-sim/web dev      # start the dev server (prints a localhost URL)
```

Then in the browser:
1. **Import** tab → click **Load Sample** (or paste your own pet export) → **Import**.
2. **Simulate** tab → pick a dungeon / depth / difficulty / rooms → **Run**.
3. **Optimize** tab → pick a dimension (farm / team / joint) + objective → **Run**.

Build a static bundle instead: `pnpm --filter @itrtg-sim/web build` (output in `packages/web/dist`).

## Run the CLI

The CLI compiles to `packages/cli/dist`. Build it once, then run with `node`:

```bash
pnpm --filter @itrtg-sim/cli build

# Import an export and print the roster (a real sample ships in the repo):
node packages/cli/dist/index.js import packages/core/src/importers/real/fixtures/petExport.txt --out roster.json

# Simulate a Scrapyard run with that roster:
node packages/cli/dist/index.js simulate --roster roster.json --dungeon Scrapyard --depth 1 --difficulty 0 --rooms 6

# Optimize the best farm target for the default team:
node packages/cli/dist/index.js optimize --roster roster.json --dimension farm --objective maxClearableDepth
```

Run `node packages/cli/dist/index.js --help` (or `<command> --help`) for all flags.

## Get your data out of the game

In ITRTG, export your pets (the pet/crafting menu has an **Export** option) and your
statistics. Two formats are supported and auto-detected:
- **Pet export** (semicolon-delimited) → your roster, including each pet's real
  computed HP/Attack/Defense/Speed (the simulator uses these directly).
- **Statistics export** → global state (Dojo, Strategy Room, NRDC count, challenge
  points), parsed into modifiers for "what-if" calculations.

Sample copies live at `packages/core/src/importers/real/fixtures/`.

---

## Develop

All commands run from the repo root:

```bash
pnpm test            # run the core + cli test suite (Vitest)
pnpm --filter @itrtg-sim/web test   # run the web tests (jsdom)
pnpm typecheck       # typecheck every package
pnpm lint            # eslint
pnpm build           # build every package
pnpm format          # prettier --write
```

### Editing game data

Enemy stats and dungeon rosters are **data-driven** and live in editable JSON:

- `packages/core/src/content/data/enemies.json` — per-enemy stats, element levels,
  scaling, xp, drops.
- `packages/core/src/content/data/dungeon-rosters.json` — which enemies appear in each
  dungeon + depth.

Edit those files to update the simulation — no code changes needed. See
`packages/core/src/content/data/README.md`.

### Project background

- `docs/itrtg-pet-dungeons-research.md` — the mechanics/formula reference the engine is built on.
- `CLAUDE.md` — architecture notes and conventions (also useful for AI assistants).

---

## Status & known limitations

- The engine, CLI, and web app are functional; the test suite is green.
- **Gear optimization is a no-op on an imported roster.** Imported pets carry the game's
  real computed stats, which the simulator uses directly (ignoring equipment), so swapping
  gear doesn't change the result for them. Gear optimization only affects synthetic/derived
  pets today. (Planned fix: a "what-if / re-derive" mode for the optimizer.)
- **Progression planning** (what to level/evolve/craft next) is not implemented yet — it
  needs real per-action cost data.
- Many formula constants are community-sourced and live in
  `packages/core/src/constants/gameConstants.ts`, tagged with provenance/confidence so they
  can be corrected as better data appears.
</content>
