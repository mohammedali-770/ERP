import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, checkEdge, extractImports, resolveWorkspace } from '../src/rules.ts';

const WORKSPACES = ['packages/contracts', 'services/orders', 'services/payments', 'apps/pos', 'tools/req-lint'];

test('classifies workspaces by their root directory', () => {
  assert.equal(classify('services/orders').layer, 'service');
  assert.equal(classify('apps/pos').layer, 'app');
  assert.equal(classify('packages/contracts').layer, 'package');
});

test('a service may import contracts', () => {
  assert.equal(checkEdge(classify('services/orders'), classify('packages/contracts'), 'f.ts'), null);
});

test('a service may NOT import another service', () => {
  const v = checkEdge(classify('services/orders'), classify('services/payments'), 'f.ts');
  assert.ok(v);
  assert.match(v.reason, /published events/);
});

test('a service may NOT import an app', () => {
  const v = checkEdge(classify('services/orders'), classify('apps/pos'), 'f.ts');
  assert.ok(v);
  assert.match(v.reason, /may not import/);
});

test('contracts may not import a service', () => {
  const v = checkEdge(classify('packages/contracts'), classify('services/orders'), 'f.ts');
  assert.ok(v, 'contracts must depend on nothing above it');
});

test('an app may import a service and contracts', () => {
  assert.equal(checkEdge(classify('apps/pos'), classify('services/orders'), 'f.ts'), null);
  assert.equal(checkEdge(classify('apps/pos'), classify('packages/contracts'), 'f.ts'), null);
});

test('a spike may import contracts but not a service', () => {
  assert.equal(checkEdge(classify('spikes/offline-sync'), classify('packages/contracts'), 'f.ts'), null);
  assert.ok(checkEdge(classify('spikes/offline-sync'), classify('services/orders'), 'f.ts'));
});

test('imports within one workspace are always fine', () => {
  assert.equal(checkEdge(classify('services/orders'), classify('services/orders'), 'f.ts'), null);
});

test('extracts import and re-export specifiers', () => {
  const src = `
import { a } from './a.ts';
import type { B } from '../b/c.ts';
export * from './d.ts';
import 'node:crypto';
`;
  const found = extractImports(src);
  assert.deepEqual(found.sort(), ['../b/c.ts', './a.ts', './d.ts', 'node:crypto'].sort());
});

test('resolves relative imports against the importing file directory', () => {
  const file = 'services/orders/src/handler.ts';
  assert.equal(resolveWorkspace(file, './local.ts', WORKSPACES), 'services/orders');
  assert.equal(resolveWorkspace(file, './sub/deep.ts', WORKSPACES), 'services/orders');
  // Three levels up from services/orders/src/ reaches the repository root.
  assert.equal(
    resolveWorkspace(file, '../../../packages/contracts/src/index.ts', WORKSPACES),
    'packages/contracts',
  );
});

test('catches a cross-service relative import', () => {
  assert.equal(
    resolveWorkspace('services/orders/src/handler.ts', '../../payments/src/charge.ts', WORKSPACES),
    'services/payments',
  );
});

test('resolves a workspace package referenced by name', () => {
  assert.equal(
    resolveWorkspace('services/orders/src/handler.ts', '@firsttaste/contracts', WORKSPACES),
    'packages/contracts',
  );
});

test('ignores builtins and third-party packages', () => {
  assert.equal(resolveWorkspace('services/orders/src/handler.ts', 'node:fs', WORKSPACES), null);
  assert.equal(resolveWorkspace('services/orders/src/handler.ts', 'zod', WORKSPACES), null);
});
