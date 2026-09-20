/**
 * Durable print queue model.
 *
 * SPIKE CODE — exists to retire risk R-01 (printing reliability under
 * simultaneous multi-channel load), not to be extended into the product.
 *
 * Implements the rules in docs/architecture/core-transaction-design.md §6:
 *   - the job is persisted in the same transaction as the causing business event
 *   - content is rendered at ENQUEUE, so a later menu edit cannot change what the
 *     kitchen already committed to producing
 *   - reprints are new jobs linked to the original; originals are never mutated
 *   - retry bias differs by document type: duplicate a kitchen slip rather than
 *     lose it, never silently reprint an invoice
 *   - after a send timeout, QUERY printer status before retrying
 */
import { uuidv7 } from '@firsttaste/contracts';

export type DocumentType = 'kot' | 'receipt' | 'invoice' | 'label' | 'shift_report';
export type JobState =
  | 'queued' | 'leased' | 'printing' | 'printed' | 'failed'
  | 'retrying' | 'unknown' | 'failed_permanent';

export interface PrintJob {
  readonly print_job_id: string;
  readonly document_type: DocumentType;
  readonly source_aggregate_id: string;
  readonly target_printer_id: string;
  /** Rendered at enqueue. Immutable thereafter. */
  readonly rendered_payload: string;
  state: JobState;
  attempt_count: number;
  /** Set only on a reprint; points at the original job. */
  readonly reprint_of: string | null;
  reprint_seq: number;
  lease_owner_device: string | null;
  lease_expires_at: number | null;
}

/**
 * Retry bias per document type.
 *
 * A duplicate kitchen slip costs seconds of confusion; a missing one costs an
 * order. Two identical invoices are a compliance problem. This asymmetry is
 * configuration, not hardcoded logic.
 */
export const AUTO_RETRY_ON_UNKNOWN: Readonly<Record<DocumentType, boolean>> = {
  kot: true,
  label: true,
  shift_report: true,
  receipt: false,
  invoice: false,
};

export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 15_000;

export interface PrinterQueryResult {
  readonly reachable: boolean;
  /** Whether the printer reports it completed the last job. */
  readonly lastJobPrinted: boolean;
}

export interface Printer {
  readonly printerId: string;
  online: boolean;
  /** Physical output. One entry per document that actually emerged. */
  readonly output: string[];
  /** Jobs the printer received but whose response was lost. */
  readonly silentlyPrinted: Set<string>;
}

export class PrintQueue {
  private readonly jobs = new Map<string, PrintJob>();
  /** Survives a simulated restart; anything not here is lost, as in reality. */
  private readonly durable = new Map<string, PrintJob>();

  enqueue(
    documentType: DocumentType,
    sourceAggregateId: string,
    targetPrinterId: string,
    renderedPayload: string,
    now: number,
  ): PrintJob {
    const job: PrintJob = {
      print_job_id: uuidv7(now),
      document_type: documentType,
      source_aggregate_id: sourceAggregateId,
      target_printer_id: targetPrinterId,
      rendered_payload: renderedPayload,
      state: 'queued',
      attempt_count: 0,
      reprint_of: null,
      reprint_seq: 0,
      lease_owner_device: null,
      lease_expires_at: null,
    };
    this.jobs.set(job.print_job_id, job);
    // Same transaction as the business write: the job is durable before the
    // caller is told anything (I-2).
    this.durable.set(job.print_job_id, { ...job });
    return job;
  }

  /** A reprint is a NEW job linked to the original. The original is never mutated. */
  reprint(originalId: string, now: number): PrintJob {
    const original = this.jobs.get(originalId);
    if (!original) throw new Error(`No such print job: ${originalId}`);
    const priorReprints = [...this.jobs.values()].filter((j) => j.reprint_of === originalId).length;
    const job: PrintJob = {
      ...original,
      print_job_id: uuidv7(now),
      state: 'queued',
      attempt_count: 0,
      reprint_of: originalId,
      reprint_seq: priorReprints + 1,
      lease_owner_device: null,
      lease_expires_at: null,
    };
    this.jobs.set(job.print_job_id, job);
    this.durable.set(job.print_job_id, { ...job });
    return job;
  }

  /** Simulates application or device restart: only durable state survives. */
  restart(): void {
    this.jobs.clear();
    for (const [id, job] of this.durable) {
      // An in-flight job returns as queued; its outcome is unknown until queried.
      this.jobs.set(id, { ...job, state: job.state === 'printed' ? 'printed' : 'queued', lease_owner_device: null, lease_expires_at: null });
    }
  }

  private persist(job: PrintJob): void {
    this.durable.set(job.print_job_id, { ...job });
  }

  /**
   * Acquires a lease so only one device drives a job at a time.
   *
   * A job whose lease has EXPIRED is acquirable again even though it is still
   * marked leased — its holder slept, died or lost the network. This failover is
   * what lets a print job complete under iPad-only when its homed device is
   * unavailable, and it is the reason the lease is short and renewable rather
   * than held for the life of the job.
   */
  acquire(deviceId: string, now: number): PrintJob | null {
    for (const job of this.jobs.values()) {
      const acquirable =
        job.state === 'queued' || job.state === 'retrying' || job.state === 'leased';
      if (!acquirable) continue;
      if (job.lease_expires_at !== null && job.lease_expires_at > now) continue;
      job.state = 'leased';
      job.lease_owner_device = deviceId;
      job.lease_expires_at = now + LEASE_MS;
      this.persist(job);
      return job;
    }
    return null;
  }

  /**
   * Attempts one print. Returns the resulting state.
   *
   * The unknown case is the interesting one: the printer received and printed
   * the document but the response was lost. Retrying blindly duplicates it.
   */
  attempt(job: PrintJob, printer: Printer, responseLost: boolean): JobState {
    job.attempt_count += 1;
    job.state = 'printing';

    if (!printer.online) {
      job.state = job.attempt_count >= MAX_ATTEMPTS ? 'failed_permanent' : 'retrying';
      this.persist(job);
      return job.state;
    }

    // The document physically emerges, carrying its job id and attempt number so
    // any duplicate is identifiable even though it cannot always be prevented.
    printer.output.push(`${job.rendered_payload}|job=${job.print_job_id}|attempt=${job.attempt_count}`);

    if (responseLost) {
      printer.silentlyPrinted.add(job.print_job_id);
      job.state = 'unknown';
      this.persist(job);
      return job.state;
    }
    job.state = 'printed';
    this.persist(job);
    return job.state;
  }

  /**
   * Resolves an unknown outcome by QUERYING the printer, not by retrying.
   * Mirrors the payment reconciliation discipline (PRN-011).
   */
  resolveUnknown(job: PrintJob, query: PrinterQueryResult): JobState {
    if (!query.reachable) {
      job.state = 'unknown';
      this.persist(job);
      return job.state;
    }
    if (query.lastJobPrinted) {
      job.state = 'printed';
    } else if (AUTO_RETRY_ON_UNKNOWN[job.document_type]) {
      job.state = job.attempt_count >= MAX_ATTEMPTS ? 'failed_permanent' : 'retrying';
    } else {
      // Receipts and invoices never silently reprint; a human decides.
      job.state = 'failed';
    }
    this.persist(job);
    return job.state;
  }

  get(id: string): PrintJob | undefined {
    return this.jobs.get(id);
  }

  all(): PrintJob[] {
    return [...this.jobs.values()];
  }

  byState(state: JobState): PrintJob[] {
    return this.all().filter((j) => j.state === state);
  }
}
