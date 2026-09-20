/**
 * Credential shapes.
 *
 * "Never commit secrets" is a rule this repository states in four places and
 * enforces nowhere. `.gitignore` covers `.env`, which stops the obvious case and
 * nothing else — B-06 exists because credentials reached a git history anyway,
 * and B-08 because a token sits in a live table in plaintext.
 *
 * Shape is all that is checkable without knowing every secret in advance, so
 * shape is what is checked. False positives are handled by an allowlist that
 * names the file and the reason, not by loosening a pattern.
 */

export interface SecretRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

export const RULES: readonly SecretRule[] = [
  {
    id: 'jwt',
    description: 'a JSON Web Token — Supabase anon and service_role keys are JWTs',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'supabase-access-token',
    description: 'a Supabase personal access token',
    pattern: /\bsbp_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'supabase-secret-key',
    description: 'a Supabase publishable or secret API key',
    pattern: /\bsb_(secret|publishable)_[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'postgres-url-with-password',
    description: 'a Postgres connection string carrying a password',
    pattern: /\bpostgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{3,}@/,
  },
  {
    id: 'private-key',
    description: 'a PEM private key block',
    pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key',
    description: 'an AWS access key id',
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'generic-assignment',
    description: 'a long literal assigned to something named like a secret',
    // Deliberately narrow: an assignment, a quoted value, and 20+ characters.
    // `token: "..."` in prose does not match; `access_token = "abc...50 chars"` does.
    pattern: /\b(secret|password|passwd|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"'\s]{20,}["']/i,
  },
];

/** Files whose content is documentation ABOUT secrets rather than a secret. */
export interface Allowance {
  readonly file: string;
  readonly ruleId: string;
  readonly reason: string;
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly ruleId: string;
  readonly description: string;
}

/**
 * Scans text. The matched value is NEVER returned — reporting a secret's value
 * into a build log is the failure this tool exists to prevent, and it would end
 * up in CI output and in this conversation.
 */
export function scan(
  file: string,
  content: string,
  allowances: readonly Allowance[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');
  for (const rule of RULES) {
    const allowed = allowances.some((a) => a.file === file && a.ruleId === rule.id);
    if (allowed) continue;
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i]!)) {
        findings.push({ file, line: i + 1, ruleId: rule.id, description: rule.description });
      }
    }
  }
  return findings;
}
