import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromDocx } from '../src/extract.ts';

const DOCX = 'docs/source/First_Taste_ERP_PRD_v0.9.docx';

test('extracts the full baseline from the vendored PRD', () => {
  const { requirements } = extractFromDocx(DOCX);

  // The approved F0 baseline. A change here means the PRD changed, which must be
  // a deliberate, versioned revision rather than a silent drift.
  assert.equal(requirements.length, 387);

  const byPhase: Record<string, number> = {};
  for (const r of requirements) byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
  assert.deepEqual(byPhase, { F0: 33, F1: 164, F2: 19, F3: 37, F4: 81, F5: 49, F6: 2, Future: 2 });
});

test('every requirement carries both languages and a section', () => {
  const { requirements } = extractFromDocx(DOCX);
  for (const r of requirements) {
    assert.ok(r.text_en.length > 0, `${r.id} has no English text`);
    assert.ok(r.text_ar.length > 0, `${r.id} has no Arabic text`);
    assert.ok(r.prd_section !== '(front matter)', `${r.id} was not attributed to a section`);
  }
});

test('requirement ids are unique', () => {
  const { requirements } = extractFromDocx(DOCX);
  const seen = new Set<string>();
  for (const r of requirements) {
    assert.ok(!seen.has(r.id), `duplicate requirement id ${r.id}`);
    seen.add(r.id);
  }
});

test('does not mistake risks, open decisions or glossary rows for requirements', () => {
  const { requirements } = extractFromDocx(DOCX);
  const ids = new Set(requirements.map((r) => r.id));
  // R-* are risks, OPN-* are open decisions, T-* are test scenarios. All live in
  // 3-column tables and must not enter the requirement baseline.
  for (const notARequirement of ['R-01', 'OPN-001', 'T-01']) {
    assert.ok(!ids.has(notARequirement), `${notARequirement} leaked into the catalogue`);
  }
});

test('extraction is deterministic', () => {
  const a = extractFromDocx(DOCX);
  const b = extractFromDocx(DOCX);
  assert.deepEqual(a.requirements, b.requirements);
  assert.equal(a.sourceSha256, b.sourceSha256);
});
