/**
 * Branded primitive types. These are compile-time-only nominal wrappers around
 * `string` so a `PetId` can never be accidentally passed where a `SpeciesId` is
 * expected. At runtime they are plain strings.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type PetId = Brand<string, 'PetId'>;
export type SpeciesId = Brand<string, 'SpeciesId'>;

export const asPetId = (s: string): PetId => s as PetId;
export const asSpeciesId = (s: string): SpeciesId => s as SpeciesId;
