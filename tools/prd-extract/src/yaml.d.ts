/**
 * A deliberately tiny YAML emitter and parser for the restricted shape this
 * repository uses for requirement data. It is not a general YAML implementation
 * and must not be used as one.
 *
 * Emitting uses double-quoted scalars throughout: YAML 1.2 double-quoted scalars
 * accept JSON string escapes, so `JSON.stringify` produces valid YAML and handles
 * the colons, quotes and bidirectional Arabic text in requirement bodies without
 * a quoting heuristic that could silently corrupt a requirement.
 */
export type Scalar = string | number | boolean | null;
export type Node = Scalar | Scalar[];
export declare function emitScalar(v: Scalar): string;
export declare function emitList(items: Scalar[], indent: string): string;
/**
 * Parses a map of `key:` blocks whose values are maps of scalars and string lists.
 * Supports `#` comments on their own line, `key: value`, and `key:` followed by
 * `  - item` lines. Anything else raises, so a malformed annotations file fails
 * loudly rather than dropping a requirement's ownership silently.
 */
export declare function parseAnnotations(src: string): Record<string, Record<string, Node>>;
//# sourceMappingURL=yaml.d.ts.map