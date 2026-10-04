/**
 * A module's routes that a test must never reach: each throws, naming itself.
 *
 * Every method is listed, and the list is checked against the interface: a Proxy over
 * `{}` looked equivalent, but spreading it copies nothing, so a stray call failed as
 * "is not a function" rather than saying which route a test reached (found in review).
 */
export function notUsed<T>(module: string, names: Record<keyof T, true>): T {
  return Object.fromEntries(Object.keys(names).map((name) => [name, () => {
    throw new Error(`${module} route ${name} called from a test that must not reach it`);
  }])) as T;
}
