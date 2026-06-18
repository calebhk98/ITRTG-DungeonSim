/**
 * Branded primitive types. These are compile-time-only nominal wrappers around
 * `string` so an id can never be accidentally passed where a plain string (or a
 * different id type) is expected. At runtime they are plain strings.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Unique identifier for a single pet in the roster. There is exactly one of each
 * pet in ITRTG (one Mouse, one Dragon, etc.; Gray's two children count as two
 * distinct pets), so there is no separate "species" concept — element, abilities,
 * and evolution data all live directly on the `Pet`.
 */
export type PetId = Brand<string, 'PetId'>;

export const asPetId = (s: string): PetId => s as PetId;
