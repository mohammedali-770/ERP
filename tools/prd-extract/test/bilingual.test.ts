import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBilingual, hasArabic } from '../src/bilingual.ts';

test('splits a plain English/Arabic requirement', () => {
  const { en, ar } = splitBilingual('The POS shall support walk-in orders. يجب أن يدعم النظام الطلبات.');
  assert.equal(en, 'The POS shall support walk-in orders.');
  assert.equal(ar, 'يجب أن يدعم النظام الطلبات.');
});

test('keeps Latin tokens embedded in the Arabic half', () => {
  // Splitting from the right would cut "Lazywait" out of the Arabic sentence.
  const { en, ar } = splitBilingual('Lazywait shall be fully replaced. يجب استبدال Lazywait بالكامل.');
  assert.equal(en, 'Lazywait shall be fully replaced.');
  assert.equal(ar, 'يجب استبدال Lazywait بالكامل.');
});

test('handles multiple embedded Latin tokens', () => {
  const { en, ar } = splitBilingual('Support Apple Pay and mada. دعم Apple Pay ومدى عبر ZATCA.');
  assert.equal(en, 'Support Apple Pay and mada.');
  assert.equal(ar, 'دعم Apple Pay ومدى عبر ZATCA.');
});

test('English-only text yields an empty Arabic half', () => {
  const { en, ar } = splitBilingual('English only.');
  assert.equal(en, 'English only.');
  assert.equal(ar, '');
});

test('Arabic-only text yields an empty English half', () => {
  const { en, ar } = splitBilingual('نص عربي فقط.');
  assert.equal(en, '');
  assert.equal(ar, 'نص عربي فقط.');
});

test('collapses the whitespace Word leaves between runs', () => {
  const { en } = splitBilingual('  The   POS  shall   work.  يجب.');
  assert.equal(en, 'The POS shall work.');
});

test('hasArabic distinguishes the scripts', () => {
  assert.equal(hasArabic('ZATCA'), false);
  assert.equal(hasArabic('زاتكا'), true);
});
