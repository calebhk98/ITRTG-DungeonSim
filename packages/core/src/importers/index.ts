/**
 * Importer barrel — APPEND-ONLY.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  HOW TO ADD A NEW IMPORTER                                             │
 * │                                                                         │
 * │  1. Create a new directory: packages/core/src/importers/vN/            │
 * │  2. Implement `PetImporter` in importers/vN/vNImporter.ts.             │
 * │     • Set `id` (stable family name) and `version` (N).                 │
 * │     • Call `defaultRegistry.register(yourImporter)` at module load.    │
 * │  3. Add ONE line here (the import side-effect):                         │
 * │       import './vN/vNImporter.js';                                      │
 * │                                                                         │
 * │  NEVER:                                                                 │
 * │    • Edit existing vN/ directories.                                     │
 * │    • Modify registry.ts or PetImporter.ts.                             │
 * │    • Remove or reorder any line in this file.                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The registry picks the highest-confidence importer automatically; adding a new
 * version does not affect existing importers for callers who never encounter the
 * new format.
 */

export { defaultRegistry } from './registry.js';
export type { ImportResult, PetImporter } from './PetImporter.js';
export { ImporterError } from './PetImporter.js';
export { ImporterRegistry } from './registry.js';

// ── Importer registrations (append only below this line) ──────────────────────
// import './v1/v1Importer.js';
// import './v2/v2Importer.js';
import './v1/v1Importer.js';
import './v2/v2Importer.js';
