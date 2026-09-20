/**
 * npm run secret:scan
 *
 * Scans every tracked file for credential shapes. Runs over `git ls-files`
 * rather than the working tree, because the rule is about what is COMMITTED —
 * an ignored .env is exactly the case that is already handled.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { scan, RULES, type Allowance, type Finding } from './rules.ts';

/**
 * Files that discuss credential formats rather than carrying one. Each names the
 * rule it is exempt from, so an exemption cannot quietly widen.
 */
const ALLOWANCES: readonly Allowance[] = [
  // Empty, and worth keeping that way.
  //
  // The test fixtures assemble their samples at runtime precisely so no
  // exemption is needed: an allowlist entry added for a placeholder is an
  // allowlist entry still there when the value is real. If a finding here is
  // genuinely a false positive, prefer changing the file so the shape does not
  // exist over adding a row below.
];

/** Binary and vendored files: the PRD is a .docx and would match by accident. */
const SKIP = /\.(docx|png|jpg|jpeg|gif|pdf|zip|ico|woff2?)$/i;
const MAX_BYTES = 2_000_000;

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !SKIP.test(f));

const findings: Finding[] = [];
let scanned = 0;

for (const file of tracked) {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted but still indexed
  }
  if (size > MAX_BYTES) continue;
  scanned++;
  findings.push(...scan(file, readFileSync(file, 'utf8'), ALLOWANCES));
}

console.log(`secret-scan: ${scanned} tracked files, ${RULES.length} rules, ${ALLOWANCES.length} allowances`);

if (findings.length === 0) {
  console.log('secret-scan: nothing that looks like a credential');
  process.exit(0);
}

// The matched text is never printed. A build log is a place secrets escape to.
for (const f of findings) {
  console.error(`\n  ${f.file}:${f.line}`);
  console.error(`      looks like ${f.description} [${f.ruleId}]`);
}
console.error(
  `\nsecret-scan: ${findings.length} finding(s). The matched values are deliberately not printed.\n` +
  'If one is a false positive, add an allowance in tools/secret-scan/src/cli.ts naming the file and the rule.',
);
process.exit(1);
