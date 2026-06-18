import type { Pet } from '../domain/pet.js';

/**
 * The result of a successful import operation.
 * Even on success there may be non-fatal `warnings` (e.g. unknown ability flags
 * that were preserved as raw strings, or fields that couldn't be fully resolved).
 */
export interface ImportResult {
  /** The imported pets in stable internal `Pet` format. */
  readonly pets: ReadonlyArray<Pet>;
  /**
   * Non-fatal diagnostic messages. An empty array means the import was clean.
   * Callers should surface these to the user but need not treat them as errors.
   */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * A versioned adapter that can parse one specific in-game export format.
 *
 * Registration contract (see importers/index.ts):
 *   - Each new format is implemented in its own `importers/vN/` directory.
 *   - The `id` must be globally unique across all registered importers.
 *   - `version` monotonically increases within the same `id` family; the registry
 *     picks the highest-confidence importer and breaks ties by highest `version`.
 *   - Importers MUST NOT share mutable state.
 *
 * See `ImporterRegistry` in registry.ts for how importers are selected.
 */
export interface PetImporter {
  /**
   * Stable string identifier for this importer family (e.g. 'csv-v1', 'json-export').
   * Used in `Pet.source.importerId` so records can be traced back to their origin.
   */
  readonly id: string;
  /**
   * Monotonically increasing version number. When the in-game export format changes
   * in a backward-incompatible way, create a new `vN/` directory with a higher version.
   */
  readonly version: number;
  /**
   * Examine `raw` input (unknown shape) and return a confidence score in [0, 1].
   *   - 1.0 = definitely my format.
   *   - 0.0 = definitely not my format.
   *   - 0 < x < 1 = partial match (e.g. looks like the right structure but missing fields).
   *
   * The registry picks the importer with the highest score; ties go to highest version.
   * Must be a PURE function — no side effects.
   */
  detect(raw: unknown): number;
  /**
   * Parse `raw` into `Pet[]`. Throws `ImporterError` on unrecoverable parse failure.
   * Non-fatal issues (unknown fields, missing optionals) go into `ImportResult.warnings`.
   *
   * Implementors: record `id` and `version` on each `Pet.source`.
   */
  import(raw: unknown): ImportResult;
}

/**
 * Thrown by `PetImporter.import()` when the input is structurally invalid and
 * cannot produce any `Pet` records. Callers should catch this separately from
 * other `Error`s to distinguish parse failures from programming bugs.
 */
export class ImporterError extends Error {
  /** The importer that threw this error. */
  readonly importerId: string;
  /** The importer version that threw this error. */
  readonly importerVersion: number;

  constructor(
    message: string,
    importerId: string,
    importerVersion: number,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ImporterError';
    this.importerId = importerId;
    this.importerVersion = importerVersion;
  }
}
