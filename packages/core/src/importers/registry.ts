import type { PetImporter, ImportResult } from './PetImporter.js';
import { ImporterError } from './PetImporter.js';

/**
 * A registry of versioned `PetImporter` adapters.
 *
 * Resolution algorithm (mirrors the plan §"Key design contracts"):
 *   1. Call `detect(raw)` on every registered importer.
 *   2. Pick the one with the highest confidence score.
 *   3. On a tie, prefer the higher `version`.
 *   4. If no importer returns confidence > 0, throw an `ImporterError`.
 */
export class ImporterRegistry {
  readonly #importers: PetImporter[] = [];

  /**
   * Register a new `PetImporter`. Duplicate `(id, version)` pairs replace the
   * previous entry (useful in test environments; in production all entries should
   * be unique).
   */
  register(importer: PetImporter): void {
    const existingIdx = this.#importers.findIndex(
      (i) => i.id === importer.id && i.version === importer.version,
    );
    if (existingIdx !== -1) {
      this.#importers.splice(existingIdx, 1, importer);
    } else {
      this.#importers.push(importer);
    }
  }

  /**
   * Find the best importer for `raw` by calling `detect()` on all registered
   * importers and returning the one with the highest confidence.
   * Ties are broken by highest `version`. Returns `null` if no importer matches.
   */
  resolve(raw: unknown): PetImporter | null {
    let best: PetImporter | null = null;
    let bestScore = 0;

    for (const importer of this.#importers) {
      const score = importer.detect(raw);
      if (
        score > bestScore ||
        (score === bestScore && best !== null && importer.version > best.version)
      ) {
        best = importer;
        bestScore = score;
      }
    }

    return bestScore > 0 ? best : null;
  }

  /**
   * Detect the best importer for `raw` and run its `import()` method.
   * Throws `ImporterError` if no importer claims the input (confidence === 0).
   */
  importAuto(raw: unknown): ImportResult {
    const importer = this.resolve(raw);
    if (importer === null) {
      throw new ImporterError(
        'No registered importer recognized the input. ' +
          'Ensure the raw export is a supported format and the correct importer is registered.',
        'registry',
        0,
      );
    }
    return importer.import(raw);
  }

  /** Returns a snapshot of all registered importers (for inspection / testing). */
  list(): ReadonlyArray<PetImporter> {
    return [...this.#importers];
  }
}

/**
 * The default shared registry. Importers auto-register by side-effecting into this
 * singleton — see importers/index.ts for the append-only registration pattern.
 */
export const defaultRegistry = new ImporterRegistry();
