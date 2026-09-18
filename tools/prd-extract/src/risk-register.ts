/**
 * Renders the risk register as markdown, because it is read by people rather
 * than by tooling — unlike the requirement catalogue, whose consumers are both.
 */
import type { Risk } from './risks.ts';

const SEVERITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function renderRiskRegister(risks: readonly Risk[], docxPath: string, sha: string): string {
  const bySeverity = new Map<string, number>();
  for (const r of risks) bySeverity.set(r.severity, (bySeverity.get(r.severity) ?? 0) + 1);
  const counts = [...bySeverity.entries()]
    .sort((a, b) => (SEVERITY_ORDER[a[0]] ?? 9) - (SEVERITY_ORDER[b[0]] ?? 9))
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(' · ');

  const head = [
    '# Risk register',
    '',
    '<!--',
    'GENERATED FILE — do not edit by hand.',
    'Regenerate with: npm run prd:extract',
    `source: ${docxPath}`,
    `source_sha256: ${sha}`,
    '-->',
    '',
    `The ${risks.length} key risks the PRD records in section 10.1 — ${counts}.`,
    '',
    'These identifiers are cited as authority across the architecture, the spikes',
    'and the programme documents, so they are extracted from the source rather than',
    'transcribed. `req-lint` checks that every `R-NN` cited anywhere resolves to a',
    'row below.',
    '',
    '---',
    '',
    '| | Severity | Risk | Mitigation |',
    '|---|---|---|---|',
  ].join('\n');

  const rows = risks
    .map((r) => {
      const sev = r.severity === 'Critical' || r.severity === 'High' ? `**${r.severity}**` : r.severity;
      return `| \`${r.id}\` | ${sev} | ${r.title_en} | ${r.mitigation_en} |`;
    })
    .join('\n');

  const arabic = [
    '',
    '## العربية',
    '',
    '| | الخطورة | الخطر | المعالجة |',
    '|---|---|---|---|',
    ...risks.map((r) => `| \`${r.id}\` | ${severityAr(r.severity)} | ${r.title_ar} | ${r.mitigation_ar} |`),
    '',
  ].join('\n');

  return `${head}\n${rows}\n${arabic}`;
}

function severityAr(severity: string): string {
  switch (severity) {
    case 'Critical': return 'حرج';
    case 'High': return 'مرتفع';
    case 'Medium': return 'متوسط';
    default: return 'منخفض';
  }
}
