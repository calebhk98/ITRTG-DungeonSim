# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo. See `README.md` for
how to install/run, and `docs/itrtg-pet-dungeons-research.md` for game mechanics.

## What this is
A TypeScript pnpm monorepo: a **simulator + optimizer** for ITRTG pet dungeons.
- `packages/core` — `@itrtg-sim/core`, the pure engine (no DOM, no Node I/O).
- `packages/cli` — `@itrtg-sim/cli`, terminal app (I/O at this edge only).
- `packages/web` — `@itrtg-sim/web`, React + Vite UI (thin consumer of core).

## Commands (from repo root)
- `pnpm install` first. Then: `pnpm test` (core+cli), `pnpm typecheck`, `pnpm lint`,
  `pnpm build`. Web: `pnpm --filter @itrtg-sim/web {dev,build,test,typecheck}`.
- Tooling: TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, ESM, `moduleResolution: Bundler`), Vitest, tsup (core build),
  ESLint flat config + Prettier. Node ≥ 20, pnpm 9.

## Hard rules
- **Core stays pure.** No `node:*` / `fs` / `path` / DOM imports in `packages/core/src/**`
  (enforced by ESLint `no-restricted-imports`; test files are exempted). Do file/IO at the
  CLI or web edge.
- **Use `import type`** for type-only imports (verbatimModuleSyntax).
- **Barrels are append-only.** `packages/core/src/index.ts` and
  `packages/core/src/importers/index.ts` — add exports, don't reorder/remove. Everything
  public must be exported from the core barrel (the CLI/web import only `@itrtg-sim/core`).
- **Game constants are injected, never ambient.** All formula numbers live in
  `packages/core/src/constants/gameConstants.ts` as `Const<T>` with `source` + `confidence`.
  Pass `DEFAULT_CONSTANTS` in; don't hardcode magic numbers in formulas.

## Architecture / data flow
```
Pet (roster)  --deriveCombatContext-->  CombatContext  --resolveRound-->  RoundOutcome
   ^ importers                ^ stats.ts            ^ combat.ts + strategies.ts
EnemyArchetype --scaleEnemyToContext--> CombatContext (enemy)   ^ scaling.ts
simulateRun(run.ts) drives rooms: spawn (content) -> scale -> resolve -> rewards/xp -> RunResult
Objective(score) <- RunResult ;  SearchProblem.evaluate = simulateRun -> Objective ; Optimizer maximizes
```
Key directories under `packages/core/src/`:
- `domain/` — stable types (Pet, Team, Gear, Dungeon, EnemyArchetype + `ScalingSpec` union,
  RunConfig, RunResult, CombatContext). The contract everything else depends on.
- `constants/` — `GameConstants` + `DEFAULT_CONSTANTS` (provenance-tagged).
- `sim/` — `rng.ts` (seedable `mulberry32`, `ExpectedValueRng`), `stats.ts`
  (`deriveCombatContext`), `strategy.ts` + `strategies.ts` (EV vs Monte-Carlo),
  `combat.ts` (`resolveRound`), `scaling.ts` (enemy scaling), `run.ts` (`simulateRun`).
- `content/` — data-driven dungeons (`getDungeon`, `DUNGEON_REGISTRY`) built from
  `content/data/*.json` by `buildFromData.ts`.
- `importers/` — versioned `PetImporter` registry; `real/` holds the real-format parsers.
- `objectives/` — `Objective` interface + `builtins.ts` (registered in `objectiveRegistry`).
- `optimizer/` — `SearchProblem`/`Optimizer` interfaces, `algorithms/`
  (enumeration/greedy/beam), `problems/` (farm-target, team, gear adapters), `joint.ts`
  (coordinate descent).

## Simulation model notes
- **EV vs Monte-Carlo** is a strategy choice (`CombatStrategy` + `Rng`), sharing one combat
  resolver. EV = fast/deterministic (optimizer inner loop); MC = sampled (final re-rank).
- **Observed-stats fast path:** pets imported from the real export carry `Pet.observed`
  (the game's already-computed stats). `deriveCombatContext` uses those directly unless
  `forceDerive: true`. Consequence: **equipment/gear changes don't affect observed pets**,
  so gear optimization is a no-op on imported rosters (documented limitation).
- Enemy scaling is **not** uniform — `ScalingSpec` is a discriminated union
  (`linear | expDiff | expSqrtDiff | towerFloor | bossMult`). Don't assume one curve.

## How to extend (common tasks)
- **Add a new importer (new export format):** create `importers/vN/` (or `importers/real/`)
  with an importer that `defaultRegistry.register(...)`s itself + a fixture + a round-trip
  test, then append ONE line to `importers/index.ts`. Never edit existing versions or
  `registry.ts`/`PetImporter.ts`. `detect()` returns a confidence 0–1; the registry picks
  the highest (ties → highest version).
- **Add/update a dungeon or enemy:** edit `content/data/enemies.json` /
  `dungeon-rosters.json` (no code change), or extend `buildFromData.ts`.
- **Add an objective:** implement `Objective` in `objectives/builtins.ts` and register it in
  `objectiveRegistry`.
- **Add an optimizer dimension:** add `optimizer/problems/<dim>.ts` mirroring
  `farmTarget.ts`/`teamComposition.ts` (a `make*Problem` returning a `SearchProblem`; use
  `-Infinity`/large-negative rejection for invalid/infeasible candidates), export from the
  barrel, and add tests. Wire it into `joint.ts` if it should participate in the joint search.
- **Correct a formula constant:** edit `gameConstants.ts` (update `value` + `confidence` +
  `note`); add/adjust a golden test.

## Testing conventions
- Vitest. Co-locate `*.test.ts` next to source. Encode hand-computed golden values for
  formulas (see `sim/stats.test.ts`, `sim/scaling.test.ts`). Seed RNG for determinism tests.
  `*.e2e.test.ts` exercise the assembled stack on real content.
- Keep `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` green before committing.

## Deferred / open
- **Progression planning** optimizer dimension — needs real per-action cost data.
- **Gear what-if** — thread `forceDerive` through the optimizer adapters so gear
  optimization works on observed-stat (imported) rosters.
- Several constants are community/estimated; calibrate against real exports over time.
</content>
