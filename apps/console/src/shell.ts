/**
 * Plain TypeScript on purpose, not .tsx.
 *
 * Node 22 cannot load a .tsx module at all — `node --experimental-strip-types`
 * and `--experimental-transform-types` both fail with `Unknown file extension
 * ".tsx"` (verified on v22.22.2). So `npm test`, which is `node --test`, can only
 * exercise plain-TypeScript modules. Logic that needs a test lives in a `.ts`
 * file and the `.tsx` files stay as thin as possible around it.
 */
export function shellTitle(app: string): string {
  return `First Taste ERP — ${app}`;
}
