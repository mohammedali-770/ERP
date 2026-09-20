import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRisks } from '../src/risks.ts';
import type { DocxBlock } from '../src/docx.ts';

const table = (rows: string[][]): DocxBlock[] => [{ kind: 'table', text: '', rows, style: null }];

const EN = 'CriticalOffline synchronization creates duplicatesMitigation: Use immutable IDs and a durable outbox.';
const AR = 'حرجإنشاء المزامنة دون اتصال لسجلات مكررةالمعالجة: استخدام معرفات ثابتة وصندوق صادر دائم.';

test('a risk row splits into severity, title and mitigation', () => {
  // Severity, title and mitigation arrive concatenated because in the source they
  // are separate runs inside one paragraph.
  const [risk] = extractRisks(table([['R-02', EN, AR]]));
  assert.equal(risk!.id, 'R-02');
  assert.equal(risk!.severity, 'Critical');
  assert.equal(risk!.title_en, 'Offline synchronization creates duplicates');
  assert.equal(risk!.mitigation_en, 'Use immutable IDs and a durable outbox.');
  assert.equal(risk!.title_ar, 'إنشاء المزامنة دون اتصال لسجلات مكررة');
});

test('rows that are not risks are ignored', () => {
  // The requirement table is four cells wide and HR-001 must not look like R-001.
  const rows = [['HR-001', 'Some requirement.', 'F4', 'P0'], ['Severity', 'Risk', 'Mitigation']];
  assert.deepEqual(extractRisks(table(rows)), []);
});

test('a risk table that has changed shape fails loudly', () => {
  // Silently emitting an empty or half-parsed register would be worse: it would
  // be quoted.
  assert.throws(
    () => extractRisks(table([['R-02', 'Critical no mitigation label here', AR]])),
    /PRD risk table has changed/,
  );
});

test('severities disagreeing across the two languages is a fault in the source', () => {
  assert.throws(
    () => extractRisks(table([['R-02', EN, AR.replace('حرج', 'متوسط')]])),
    /Critical in English and Medium in Arabic/,
  );
});
