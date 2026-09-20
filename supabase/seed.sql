-- Development seed — loaded automatically by `supabase db reset`.
--
-- SYNTHETIC ONLY. No real employee, payroll, customer or financial data appears
-- here or anywhere else in this repository. SEC-012 forbids production data in
-- development or testing without approved masking; this seed does not mask
-- anything, because there is nothing real to mask.
--
-- Deterministic by construction: every identifier and timestamp is a fixed
-- constant, so `db reset` twice produces the same database and a test can assert
-- a named row. LAB-005 requires exactly this — "regenerable from seed so a
-- regression run starts from an identical state".
--
-- Order matters: the organisation must exist before anything references it.

\ir seeds/0010_organisation.sql
\ir seeds/0020_awkward_cases.sql
\ir seeds/0090_freeze_timestamps.sql
