/**
 * What a person reads when the edge says no: sign-in's answers, a refusal, an import's
 * problems. Plain TypeScript so test/messages.test.ts reads every branch.
 *
 * A refusal is shown in two parts: a sentence in the reader's language for its kind
 * (`refusal_conflict`…), and, under it, the database's own words when a route wrote them
 * (refusal.ts passes a RAISE's message through and withholds PostgreSQL's). Those words
 * are English and name the code or line at fault, which is what a person needs to fix
 * an import; translating each RAISE is for a later step, and is recorded in the UAT pack.
 *
 * Requirements: PRG-014 · IAM-P02
 */
import type { Failure, SignInResult } from './api.ts';
import type { ImportProblem } from './csv.ts';
import { t, type Key, type Lang } from './i18n.ts';

export interface Message {
  readonly text: string;
  /** The database's own words, when there are any worth showing. */
  readonly detail: string | null;
}

const REFUSAL_KEY: Readonly<Record<string, Key>> = {
  forbidden: 'refusal_forbidden',
  conflict: 'refusal_conflict',
  stale: 'refusal_stale',
  refused: 'refusal_refused',
  invalid: 'refusal_invalid',
  not_found: 'refusal_not_found',
  no_such_route: 'refusal_not_found',
  too_large: 'refusal_too_large',
  already_recorded: 'already_recorded',
  idle: 'session_idle',
  unauthenticated: 'session_ended',
  ended: 'session_ended',
  expired: 'session_ended',
  disabled: 'signin_account_disabled',
};

/**
 * The rules a person is likeliest to meet, by the constraint 0012 names for each. Some are
 * PostgreSQL's own checks, whose words the edge withholds (refusal.ts), so without this a
 * missing Arabic description read only "a value is not valid" (found running the screens).
 */
const RULE_KEY: Readonly<Record<string, Key>> = {
  item_code_key: 'rule_code_taken',
  item_code_is_canonical: 'rule_code_canonical',
  item_description_is_bilingual: 'rule_descriptions_paired',
  item_decision_reason_is_stated: 'rule_reason_required',
  item_unit_factor_required: 'rule_factor_required',
  item_unit_factor_inexact: 'rule_factor_inexact',
  item_unit_agrees_with_its_dimension: 'rule_unit_disagrees',
};

export function failureMessage(lang: Lang, f: Failure): Message {
  if (f.http === 0) return { text: t(lang, 'network_error'), detail: null };
  if (f.status === 'malformed') return { text: t(lang, 'refusal_malformed', { field: f.field ?? '?' }), detail: null };
  // A 401 'invalid' is a session the token no longer names, not a form value.
  const key = f.http === 401 && f.status === 'invalid' ? 'session_ended' : REFUSAL_KEY[f.status];
  if (key === undefined || f.http >= 500) return { text: t(lang, 'unexpected_error'), detail: null };
  const rule = f.constraint === null ? undefined : RULE_KEY[f.constraint];
  // The database's words, then the rule's name: what a person quotes when they ask for help.
  const words = [f.message, f.detail, f.constraint === null ? null : `[${f.constraint}]`]
    .filter((s): s is string => s !== null && s !== '').join('\n');
  return { text: t(lang, rule ?? key), detail: words === '' ? null : words };
}

/**
 * Sign-in's answer as a sentence. An unknown number and a wrong PIN read the same, as
 * the database answers them the same (IAM-P02).
 */
export function signInMessage(lang: Lang, r: SignInResult, formatTime: (iso: string) => string): string | null {
  switch (r.status) {
    case 'ok': return null;
    case 'wrong':
      return r.attempts_left === undefined
        ? t(lang, 'signin_wrong_pin')
        : `${t(lang, 'signin_wrong_pin')} ${t(lang, 'signin_attempts_left', { n: r.attempts_left })}`;
    case 'locked': return t(lang, 'signin_locked', { time: formatTime(r.locked_until) });
    case 'disabled': return t(lang, 'signin_account_disabled');
    case 'malformed': return t(lang, 'signin_malformed');
  }
}

export function importProblem(lang: Lang, p: ImportProblem): string {
  switch (p.kind) {
    case 'empty': return t(lang, 'import_empty');
    case 'too_many': return t(lang, 'import_too_many', { rows: p.rows });
    case 'missing_column': return t(lang, 'import_missing_column', { column: p.column });
    case 'unknown_column': return t(lang, 'import_unknown_column', { column: p.column });
    case 'duplicate_column': return t(lang, 'import_duplicate_column', { column: p.column });
    case 'width': return t(lang, 'import_width', { line: p.line, found: p.found, expected: p.expected });
    case 'unknown_brand': return t(lang, 'import_unknown_brand', { line: p.line, brand: p.brand });
  }
}
