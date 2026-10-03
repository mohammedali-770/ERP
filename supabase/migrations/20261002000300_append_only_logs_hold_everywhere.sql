-- 0013 · The append-only logs hold everywhere: through a partition, and against TRUNCATE
--
-- Requirements: OFF-009 · FIN-007 · POS-028 · SEC-006 · CAP-P03 · IAM-008
-- ADR-0003 · invariants I-7, I-8
--
-- ADR-0003 asks for two protections on the event log. The runtime holds no write grant,
-- and a trigger raises for every writer, the owner included. 0004 attached that trigger
-- to erp.event_log as a STATEMENT trigger. erp.event_log is partitioned, and PostgreSQL
-- fires a partitioned table's statement triggers only for statements that name the
-- parent. So a statement naming a partition fired nothing:
--
--     delete from erp.event_log_default where true;   -- deleted every seeded event
--
-- The owner could rewrite or delete the system of record. The runtime could not, since it
-- holds no privilege on the partition, so protection one held and protection two did not.
-- Found on 2026-10-02 by trying it: every check until then named the parent.
--
-- And no log but erp.item_decision (0012) refused TRUNCATE, which no UPDATE or DELETE
-- trigger sees.
--
-- So, additively, leaving every existing trigger as it is:
--   * a ROW trigger on erp.event_log. PostgreSQL clones a partitioned table's row
--     triggers onto every partition, the default one and any added later, so UPDATE and
--     DELETE are refused whichever table a statement names. The statement trigger stays:
--     it also refuses a statement that matches no row.
--   * a TRUNCATE trigger on erp.event_log and on its default partition. Statement
--     triggers are NOT cloned, so a partition added later needs its own. db-check's
--     every-decision-log-is-append-only finds any partition without one, and whatever
--     maintenance later creates dated partitions must add it.
--   * a TRUNCATE trigger on erp.capability_decision and erp.identity_decision.
--
-- Each fires its log's existing function, which names the operation and the table it
-- was refused on, so no function is added and nothing new needs revoking from PUBLIC.

-- The event log, row by row, through any partition.
create trigger event_log_rows_append_only
  before update or delete on erp.event_log
  for each row
  execute function erp.event_log_is_append_only();

-- TRUNCATE: on the parent, and on the one partition that exists.
create trigger event_log_never_truncated
  before truncate on erp.event_log
  for each statement
  execute function erp.event_log_is_append_only();

create trigger event_log_default_never_truncated
  before truncate on erp.event_log_default
  for each statement
  execute function erp.event_log_is_append_only();

-- The central decision logs.
create trigger capability_decision_never_truncated
  before truncate on erp.capability_decision
  for each statement
  execute function erp.capability_decision_is_append_only();

create trigger identity_decision_never_truncated
  before truncate on erp.identity_decision
  for each statement
  execute function erp.identity_decision_is_append_only();
