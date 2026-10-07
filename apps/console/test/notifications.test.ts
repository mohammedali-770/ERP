import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, type Fetch, type Notification, type ViewerFacility } from '../src/api.ts';
import { asKey } from '../src/i18n.ts';
import { itemIsVisible } from '../src/navigation.ts';
import { badge, BELL, bellVisible, kindKey, MAX_MARK, markOf, NOTIFICATION_KINDS, openTarget, unreadIds } from '../src/notifications.ts';
import { formatRoute, navIdOf, parseRoute } from '../src/route.ts';
import { toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const MIGRATION = read('supabase/migrations/20261006000200_notifications.sql');
// 0022 widens 0021's kinds (module 7): the latest check is the authority.
const MINIMUMS = read('supabase/migrations/20261007000200_stock_minimums.sql');
const EDGE = read('supabase/functions/_shared/notifications.ts');
const APP = read('apps/console/src/App.tsx');
const SCREEN = read('apps/console/src/screens/Notifications.tsx');
const LOGIC = read('apps/console/src/notifications.ts');

const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const ELSEWHERE = '01936f00-0000-7000-8000-000000000409';
const DECISION = '01936f00-0000-7000-8000-000000005708';
const N1 = '01936f00-0000-7000-8000-0000000c0001';
const N2 = '01936f00-0000-7000-8000-0000000c0002';

const facility = (id: string, code: string, type = 'warehouse'): ViewerFacility =>
  ({ facility_id: id, code, facility_type: type, name_en: code, name_ar: code, brand_id: 'b' });
const FACILITIES = [facility(WAREHOUSE, 'WH-1'), facility(FACTORY, 'FA-1', 'factory')];

const note = (over: Partial<Notification> = {}): Notification => ({
  notification_id: N1, seq: '9007199254740993', kind: 'stock_below_zero', facility_id: FACTORY, facility_code: 'FA-1',
  stock_decision_id: DECISION, created_at: '2026-10-06T08:00:00.123Z', read_at: null, items: [], ...over,
});

function fake(answer: Record<string, unknown> = { status: 'ok', notifications: [], next_before: null, unread: 4, marked: 2 }) {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { sent, fetch, api: createApi({ base: 'https://edge.test/functions/v1', fetch, token: () => 'ab'.repeat(32) }) };
}
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

// --- the client ----------------------------------------------------------------

test('CONTROL: no bell call names an actor; the cursor travels as the text it came as; marking all is said', async () => {
  const f = fake();
  await f.api.listNotifications(WAREHOUSE);
  await f.api.listNotifications(WAREHOUSE, '9223372036854775807');
  await f.api.listNotifications(null);
  await f.api.unreadNotifications(FACTORY);
  await f.api.markNotificationsRead(WAREHOUSE, { notificationIds: [N1, N2] });
  await f.api.markNotificationsRead(null, { all: true });
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    `GET /notifications?facility_id=${WAREHOUSE}`,
    `GET /notifications?facility_id=${WAREHOUSE}&before=9223372036854775807`,
    'GET /notifications',
    `GET /notifications/unread?facility_id=${FACTORY}`,
    'POST /notifications/read',
    'POST /notifications/read',
  ]);
  assert.deepEqual(f.sent[4]!.body, { facility_id: WAREHOUSE, notification_ids: [N1, N2] });
  assert.deepEqual(f.sent[5]!.body, { facility_id: null, all: true }, 'all, said, with no list beside it');
  for (const s of f.sent) {
    assert.ok(!keys(s.body).some((k) => /actor|person|recipient/.test(k)), `${s.url} names nobody`);
    assert.doesNotMatch(s.url, /actor|person|recipient|token/, `${s.url} names nobody`);
  }
});

test('the answers come back as the edge sent them: a page with its cursor as text, a count and a mark as numbers', async () => {
  const page = await fake({ status: 'ok', notifications: [note()], next_before: '9007199254740993' }).api.listNotifications(null);
  assert.ok(page.ok);
  assert.equal(page.value.next_before, '9007199254740993', 'past 2^53, unrounded');
  assert.equal(page.value.notifications[0]!.seq, '9007199254740993');
  const count = await fake().api.unreadNotifications(null);
  assert.deepEqual(count, { ok: true, value: 4 });
  const marked = await fake().api.markNotificationsRead(null, { all: true });
  assert.deepEqual(marked, { ok: true, value: 2 });
});

// --- marking ---------------------------------------------------------------------

test('CONTROL: nothing to mark sends nothing, never an empty list that could be read as all', () => {
  assert.equal(markOf([]), null);
  assert.deepEqual(markOf('all'), { all: true });
  assert.deepEqual(markOf([N1, N1, N2]), { notificationIds: [N1, N2] }, 'each once');
  const many = Array.from({ length: 150 }, (_, i) => `01936f00-0000-7000-8000-${String(i).padStart(12, '0')}`);
  const cut = markOf(many);
  assert.ok(cut !== null && 'notificationIds' in cut);
  assert.equal(cut.notificationIds.length, MAX_MARK);
  assert.deepEqual(cut.notificationIds, many.slice(0, 100), 'the first hundred: the newest, as shown');
  assert.match(EDGE, /ids\.length > 100/, 'the edge\'s own limit');
  assert.match(MIGRATION, /cardinality\(p_notification_ids\) not between 1 and 100/, '0021\'s own limit');
  assert.deepEqual(unreadIds([note(), note({ notification_id: N2, read_at: '2026-10-06T09:00:00Z' })]), [N1]);
});

test('the badge: nothing at none, the count up to 99, then 99+', () => {
  assert.equal(badge(0), '');
  assert.equal(badge(-1), '');
  assert.equal(badge(Number.NaN), '');
  assert.equal(badge(1), '1');
  assert.equal(badge(99), '99');
  assert.equal(badge(100), '99+');
});

// --- opening --------------------------------------------------------------------

test('CONTROL: a notification opens at its own facility: here, after switching to it, or not at all', () => {
  assert.deepEqual(openTarget(note(), FACTORY, FACILITIES),
    { kind: 'here', route: { screen: 'stock_decision', decisionId: DECISION } }, 'worked at already');
  const away = openTarget(note(), WAREHOUSE, FACILITIES);
  assert.equal(away.kind, 'switch', 'from the warehouse, the factory\'s is opened by working there first');
  assert.ok(away.kind === 'switch' && away.facility.facility_id === FACTORY);
  assert.equal(openTarget(note(), null, FACILITIES).kind, 'switch', 'organisation-wide too: a stock screen reads one facility');
  assert.deepEqual(openTarget(note({ facility_id: ELSEWHERE, facility_code: 'WH-9' }), WAREHOUSE, FACILITIES),
    { kind: 'none', reason: 'elsewhere' }, 'a facility the person may not work at is not opened, and says so');
  assert.deepEqual(openTarget(note({ kind: 'po_pending' }), FACTORY, FACILITIES), { kind: 'none', reason: 'unsupported' },
    'a kind not built yet offers nothing');
  assert.deepEqual(openTarget(note({ stock_decision_id: null }), FACTORY, FACILITIES), { kind: 'none', reason: 'unsupported' });
  assert.match(SCREEN, /target\.reason === 'elsewhere' \?/, '"you do not work at" only when that is why');
  // The screen goes only where openTarget says, by navigate or workAt: it builds no stock route itself.
  assert.match(SCREEN, /openTarget\(n, facilityId, data\.facilities\)/);
  assert.match(SCREEN, /ctx\.workAt\(target\.facility\.facility_id, target\.route\)/);
  assert.doesNotMatch(SCREEN, /current_stock/);
});

test('switching to open asks first while a form holds lines, as the picker does, and marks read only once it has gone', () => {
  const workAt = APP.slice(APP.indexOf('workAt: (id, r) =>'), APP.indexOf('setLeaveGuard: guard.set'));
  assert.match(workAt, /if \(!guard\.allows\(\)\) return false;/);
  assert.ok(workAt.indexOf('guard.allows()') < workAt.indexOf('setFacilityId(id)'), 'asked before anything changes');
  const open = SCREEN.slice(SCREEN.indexOf('function open('), SCREEN.indexOf('const unread ='));
  assert.ok(open.indexOf('went = ctx.workAt(') < open.indexOf('void mark('), 'a refused switch leaves it unread (found in review)');
  assert.match(open, /if \(went && n\.read_at === null\) void mark/);
});

test('CONTROL: "Mark all read" marks the ones listed, by id, never one that arrived after the page was loaded', () => {
  assert.match(SCREEN, /onClick=\{\(\) => void mark\(unread\)\}>\{t\(lang, 'mark_all_read'\)\}/);
  assert.doesNotMatch(SCREEN, /mark\('all'\)|all: true/, 'the page never sends all (found in review)');
  const mark = SCREEN.slice(SCREEN.indexOf('async function mark('), SCREEN.indexOf('function open('));
  assert.match(mark, /ctx\.refreshBell\(\);/, 'and the bell is asked again after a mark');
  assert.ok(mark.indexOf('if (!answer.ok)') < mark.indexOf('ctx.refreshBell()'), 'after the mark is saved');
});

test('a kind is worded only if it is one the console knows: no kind borrows another string', () => {
  assert.equal(kindKey('stock_below_zero'), 'notif_stock_below_zero');
  for (const k of ['unread', 'open', 'open_at', 'cannot_open', 'po_pending']) assert.equal(kindKey(k), null, k);
  assert.match(SCREEN, /const kind = kindKey\(n\.kind\);/);
});

// --- the bell -------------------------------------------------------------------

test('CONTROL: the bell is asked on the person\'s doing, never on a timer that would hold the session open', () => {
  for (const [name, source] of [['App.tsx', APP], ['Notifications.tsx', SCREEN], ['notifications.ts', LOGIC]] as const) {
    assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame/, `${name}: every request moves the session's idle clock (0014)`);
  }
  const effect = APP.slice(APP.indexOf('api.unreadNotifications'), APP.indexOf('const toggleLang'));
  assert.match(effect, /\[api, seesBell, facilityId, route, bellAsk, onFailure\]/,
    'read again on another facility, another screen, and a mark');
  assert.match(APP, /visibilitychange/, 'and on coming back to the tab');
  const bell = APP.slice(APP.indexOf('className="bell"'), APP.indexOf('<span className="person">'));
  assert.match(bell, /if \(current !== 'notifications'\) return;\s+setBellAsk\(\(n\) => n \+ 1\);\s+setBellPage\(\(n\) => n \+ 1\);/,
    'a click on the bell from its own page asks afresh, as the hash does not change');
  assert.match(SCREEN, /\[api, facilityId, ctx\.bellPage\]/, 'and the list is read again with it');
});

test('the bell\'s door is 0021\'s capability, asked as its routes ask it: hidden, it is not shown', () => {
  assert.match(MIGRATION, /\('platform\.notifications', 'Notifications', 'الإشعارات'/);
  assert.equal(BELL.capability, 'platform.notifications');
  assert.equal(BELL.action, 'read');
  const gates = [...MIGRATION.matchAll(/erp\.assert_permitted\(p_actor_id, '([a-z_.]+)', '([a-z]+)', p_facility_id\)/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(gates, Array(3).fill(`${BELL.capability}:${BELL.action}`), 'each of 0021\'s three routes asks what the bell shows on');
  const viewer = (state: string, perms: string[]) => toViewer({
    person: { person_id: 'p', employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
    facility_id: null, org_wide: true, facilities: [], permissions: perms,
    states: { 'platform.notifications': state }, brands: [], units: [],
  });
  assert.equal(bellVisible(viewer('pilot', ['platform.notifications:read'])), true);
  assert.equal(bellVisible(viewer('hidden', ['platform.notifications:read'])), false, 'hidden, as 0021 ships it');
  assert.equal(bellVisible(viewer('pilot', [])), false, 'no grant, no bell');
  assert.equal(bellVisible(viewer('pilot', ['platform.notifications:read'])), itemIsVisible(BELL, viewer('pilot', ['platform.notifications:read'])));
  assert.match(APP, /route\.screen === 'notifications'\) \{\n\s+return ctx\.seesBell \?/, 'a typed URL meets the same answer');
});

test('every kind the database knows has words, and the bell\'s route parses and formats both ways', () => {
  const checks = [...`${MIGRATION}\n${MINIMUMS}`.matchAll(/constraint notification_kind_is_known\s+check \(kind in \(([^)]*)\)\)/g)];
  assert.equal(checks.length, 2, '0021 declares it, 0022 widens it');
  const known = checks[checks.length - 1]!;
  const kinds = [...known[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(kinds, [...NOTIFICATION_KINDS]);
  for (const k of kinds) assert.notEqual(asKey(`notif_${k}`), null, k);
  assert.deepEqual(parseRoute('#notifications'), { screen: 'notifications' });
  assert.equal(formatRoute({ screen: 'notifications' }), '#notifications');
  assert.equal(navIdOf({ screen: 'notifications' }), 'notifications', 'no menu entry is marked current');
  assert.equal(parseRoute(`#notifications/${N1}`).screen, 'unknown', 'a notification has no page of its own');
});
