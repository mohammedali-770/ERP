# ADR-0025 — Sessions, and an edge layer in which a caller cannot name the actor

- **Status:** Proposed. The owner decided two of its numbers on 2026-10-03: a sign-in
  lasts at most twelve hours and ends after thirty minutes idle. The rest is this ADR's
  proposal
- **Date:** 2026-10-03
- **Open:** [Q-24](../program/open-questions.md), rate limiting and the log's retention,
  before the first deployment
- **Requirements:** IAM-001 · IAM-008 · IAM-009 · IAM-010 · SEC-003 · SEC-004 · SEC-008 ·
  IAM-P01 · IAM-P02 · IAM-P05 · IAM-P09 · IAM-P10
- **Related:** ADR-0022 · ADR-0023 (and its addendum) ·
  `supabase/migrations/20261003000100_sessions.sql` · `supabase/functions/` ·
  `supabase/tests/090_sessions_test.sql`

## Context

ADR-0022 built identity and left a gap it named: the database's write routes check that
the actor a caller *names* is permitted, and cannot check that the named actor is the
one calling. ADR-0023 decided that edge functions hold the database credential and that
"the edge layer is where the actor becomes real". This ADR is how.

## Decision

### 1. A session is a database row; its token exists only on the device.

`erp.sign_in(employee_number, pin)` calls `erp.verify_pin()` unchanged and, on `ok`,
creates an `erp.session` and returns a token: 32 random bytes as 64 hex characters,
shown once. The database keeps the token's SHA-256 and never the token (IAM-P10). A
plain hash is enough because the token is random: bcrypt exists to slow a guess at a
six-digit PIN, and 256 random bits cannot be guessed however fast the hash is.

The token is a bearer token sent in `Authorization`. It is not a Supabase Auth JWT and
is not a JWT at all: nothing in it can be read or forged offline, and ending a session
needs no blocklist, because every request asks the database.

### 2. Twelve hours at most, thirty minutes idle (IAM-P09).

The owner's numbers. They are named once, as `erp.session_max_age()` and
`erp.session_idle_limit()`, and both bind the database's own answer: a session past
either is refused and ended by `erp.resolve_session()` itself, so no edge function can
forget to check. The idle clock moves at most once a minute
(`erp.session_touch_interval()`), so an ordinary request is a read, not a write.

### 3. `erp.resolve_session()` is the only way the edge layer learns who is calling.

It answers `ok` with the `person_id`, or why the token names nobody: `invalid`,
`ended`, `expired`, `idle` or `disabled`. `disabled` is IAM-P05 applied at every
request.

A session also ends, answering `ended`, once the person's status or credential has been
decided since it was signed in. That means a status change in either direction, a PIN
set, or an unlock. An unlock follows a lockout, which means someone else was trying the
number. The first draft checked status only, so suspending a cashier whose till was
stolen merely paused the thief's session: reactivated within thirty minutes, even with a
new PIN, the stolen token worked again (found in review). So no identity route has to
remember to end sessions.

Each session records the decision behind the person's status and the one behind their
credential, read while `verify_pin()` still holds the credential row it checked. A later
decision about either replaces it, and the session is superseded. The second draft
compared times instead, and Codex found the race on PR #31: a PIN reset whose
transaction began first could commit a decision stamped *earlier* than a session made
with the old PIN, which then never ended. Identifiers cannot be ordered wrongly.

The row is not locked. Ending a session and moving its idle clock are each a
conditional UPDATE that applies only while the session is open, so a sign-out or
revocation that commits first turns either into `ended`. Nothing stops a request that
had already resolved `ok` a moment earlier from finishing.

In the edge layer, `withSession(handler)` reads the bearer token, calls
`resolve_session`, and hands the handler a frozen `{ personId, expiresAt }`. **Every
later function that records a decision wraps its handler in it and passes
`session.personId` as the actor.** No handler reads an actor from a request, so a
caller cannot name one. The Node suite holds this with a control: a request whose body
and headers name the administrator still acts as the person its token resolves to.

### 4. Every attempt is recorded, and the record holds no personal data (IAM-008).

`erp.sign_in_log` is append-only, protected as every other log is: no write privilege
for the runtime, and a trigger that refuses UPDATE, DELETE and TRUNCATE for every
writer, the owner included. A row holds the outcome, the person when the number names
one, and the session on success. **It holds no employee number**: an attempt against a
number that names nobody records no person, so the log needs no erasure route
(SEC-008, ADR-0022 §2) and is not a list of numbers tried. The caller's answer is
`verify_pin()`'s, unchanged, so an unknown number and a wrong PIN still cannot be told
apart (IAM-P02); only the log knows which person a wrong PIN was tried against.

The edge checks only that the body is two short strings. Their format is checked by the
database, which records what it is shown, so a malformed attempt is recorded too.

### 5. Revocation is an administrator's decision (IAM-010).

`erp.revoke_sessions()` is gated by `platform.identity_admin` write, like every other
identity route. It ends every open session of a person and records a
`sessions_revoked` identity decision; each session it ended names that decision. A
session is ended and never deleted, and an ended session never changes again, so it
cannot be reopened. Triggers hold both, the owner included.

### 6. The runtime reaches sessions only through the four routes.

`erp_app` holds EXECUTE on `sign_in`, `resolve_session`, `sign_out` and
`revoke_sessions`, and no privilege on `erp.session` or `erp.sign_in_log`. **It no
longer holds EXECUTE on `erp.verify_pin()`**: called directly, that checks a PIN and
records nothing, which would be a way round IAM-008. `db:check`'s
`every-runtime-definer-route-is-gated` now names `sign_in`, `resolve_session` and
`sign_out` as its exceptions, since they are how a person comes to be named at all, and
would report `verify_pin` if it were granted back.

## Consequences

- ADR-0022's "Sessions and tokens" gap is closed for every function that wraps its
  handler in `withSession`. A function that does not is a review finding: it can only
  name an actor by reading one from the request.
- A stolen token works until it expires, idles out, is signed out or is revoked. It is
  not bound to a device yet; `erp.device` and IAM-010's trusted devices wait on device
  enrolment.
- Sign-in is not rate-limited beyond `verify_pin()`'s five-miss lockout per number, and
  the log cannot be pruned. A caller trying many numbers is neither slowed nor
  identifiable: the log holds no source or device. A script can grow the log without
  limit. Both need an answer before the first deployment:
  [Q-24](../program/open-questions.md).
- `erp.session` grows by one row per sign-in and nothing prunes it, because a session
  the log names cannot be deleted. Retention is a decision for when the volume is
  known.
- Administrators still have no credential of their own (IAM-002); they sign in with a
  PIN like everyone else until that is decided.
- Database enforcement of a read-only preview (CAP-P11) can now be built on a session
  that knows it is a preview. It is not built here.

## Addendum — 2026-10-04: the session names what the console shows

`GET /session` now also returns `viewer`: `erp.viewer()` (migration 0015) for the
session's person at the facility named by `?facility_id=`, or organisation-wide when there
is none. The console builds its menu and buttons from it (ADR-0024's step 3 addendum).

- **Always the session's person.** The handler passes `session.personId`, never a person
  named by the request; a Node control sends another person's id in the query and a
  header and checks that the viewer asked for is still the caller's.
- **Security invoker, so no new definer route.** `erp.viewer()` reads only what `erp_app`
  already reads, by grant and policy: people, roles and permissions, capabilities, the
  organisation and the unit register. It runs with the caller's privileges, so
  `every-runtime-definer-route-is-gated` has nothing to account for. `erp_app` alone may
  execute it. A facility id that is not a UUID is refused before the database is asked.
- **Naming a facility grants nothing.** Permissions are those of roles held
  organisation-wide or at that facility, exactly as `erp.permission_granted()` decides.
  A facility where the person holds no role adds none. The capability states and the
  reference data it returns are not personal, and every person with a session may read
  them.
- **Not a control.** The answer decides what a menu shows. Every route still asks
  `erp.assert_permitted()` (CAP-P04).

Proved by `supabase/tests/100_viewer_test.sql` (19 cases), the session handler's Node
tests, and the Deno session test, which reads a cashier's viewer as `erp_edge`.

## Alternatives considered

**Supabase Auth sessions.** Rejected by ADR-0022 §1: identity is `erp`-native, and
`authenticated` reaches nothing in `erp`.

**A signed JWT the edge verifies without the database.** Saves a query per request, but
revocation then needs a blocklist that every function consults, and an idle limit
needs a write anyway. One indexed lookup by hash is cheaper than either.

**A session column on `erp.person`.** One session per person would sign a cashier out
of one till when they sign in at another.
