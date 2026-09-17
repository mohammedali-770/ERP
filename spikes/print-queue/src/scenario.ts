/**
 * The R-01 scenario: concurrent multi-channel printing with fault injection.
 *
 * Gates (docs/lab/test-plan.md T-03, PRN-002/004/005, NFR-005):
 *   - zero lost kitchen slips
 *   - every duplicate identifiable by job id and attempt
 *   - no silent duplicate invoice
 *   - the queue survives restart
 */
import { PrintQueue, type DocumentType, type Printer } from './queue.ts';

export interface PrintScenarioConfig {
  readonly jobs: number;
  readonly channels: number;
  /** Probability the printer is offline when a job is attempted. */
  readonly printerOfflineRate: number;
  /** Probability the document printed but the response was lost. */
  readonly responseLostRate: number;
  /** Probability of an application or device restart between jobs. */
  readonly restartRate: number;
  readonly seed: number;
  /**
   * Control case: retries an unknown outcome blindly instead of querying the
   * printer first. Proves the harness detects duplicate invoices.
   */
  readonly sabotageBlindRetry?: boolean;
}

export interface PrintScenarioResult {
  readonly jobsEnqueued: number;
  readonly kotEnqueued: number;
  readonly kotPrinted: number;
  readonly kotLost: number;
  readonly invoicesEnqueued: number;
  readonly invoiceDocumentsEmitted: number;
  readonly silentDuplicateInvoices: number;
  readonly unidentifiableDuplicates: number;
  readonly survivedRestarts: number;
  readonly passed: boolean;
  readonly failures: string[];
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const DOC_MIX: readonly DocumentType[] = ['kot', 'receipt', 'kot', 'invoice'];

export function runPrintScenario(config: PrintScenarioConfig): PrintScenarioResult {
  const random = makeRandom(config.seed);
  const queue = new PrintQueue();
  const printer: Printer = { printerId: 'kitchen-1', online: true, output: [], silentlyPrinted: new Set() };

  let restarts = 0;
  const enqueuedByType = new Map<DocumentType, number>();

  for (let i = 0; i < config.jobs; i++) {
    const now = 1_700_000_000_000 + i * 1000;
    const docType = DOC_MIX[i % DOC_MIX.length]!;
    const channel = i % config.channels;
    enqueuedByType.set(docType, (enqueuedByType.get(docType) ?? 0) + 1);

    queue.enqueue(docType, `ord-${i}`, printer.printerId, `${docType}:order-${i}:channel-${channel}`, now);

    // Restart between jobs: only durable state survives.
    if (random() < config.restartRate) {
      queue.restart();
      restarts += 1;
    }

    // Drive the queue.
    printer.online = random() >= config.printerOfflineRate;
    let job = queue.acquire(`dev-${channel % 3}`, now);
    while (job) {
      const responseLost = printer.online && random() < config.responseLostRate;
      const state = queue.attempt(job, printer, responseLost);

      if (state === 'unknown') {
        if (config.sabotageBlindRetry) {
          // The failure this design prevents: retry without asking the printer.
          printer.online = true;
          queue.attempt(job, printer, false);
        } else {
          // Ask the printer what actually happened before doing anything.
          queue.resolveUnknown(job, {
            reachable: printer.online,
            lastJobPrinted: printer.silentlyPrinted.has(job.print_job_id),
          });
        }
      }
      printer.online = true; // recovery between attempts
      job = queue.acquire(`dev-${channel % 3}`, now + 1);
    }
  }

  // Drain anything left retrying.
  printer.online = true;
  for (let round = 0; round < 10; round++) {
    const job = queue.acquire('dev-0', 1_800_000_000_000 + round);
    if (!job) break;
    queue.attempt(job, printer, false);
  }

  const kotEnqueued = enqueuedByType.get('kot') ?? 0;
  const invoicesEnqueued = enqueuedByType.get('invoice') ?? 0;

  // Physical output analysis — what actually came out of the printer.
  const emittedByJob = new Map<string, number>();
  let invoiceDocs = 0;
  let unidentifiable = 0;
  for (const line of printer.output) {
    const jobMatch = /\|job=([^|]+)\|attempt=(\d+)$/.exec(line);
    if (!jobMatch) { unidentifiable += 1; continue; }
    const jobId = jobMatch[1]!;
    emittedByJob.set(jobId, (emittedByJob.get(jobId) ?? 0) + 1);
    if (line.startsWith('invoice:')) invoiceDocs += 1;
  }

  // A kitchen slip is "printed" if its job reached a printed state.
  const kotJobs = queue.all().filter((j) => j.document_type === 'kot');
  const kotPrinted = kotJobs.filter((j) => j.state === 'printed').length;
  const kotLost = kotJobs.filter((j) => j.state === 'failed_permanent' || j.state === 'failed').length;

  // A silent duplicate invoice: the same invoice job emitted more than once
  // without a human asking for a reprint.
  const invoiceJobIds = new Set(queue.all().filter((j) => j.document_type === 'invoice').map((j) => j.print_job_id));
  let silentDuplicateInvoices = 0;
  for (const [jobId, count] of emittedByJob) {
    if (invoiceJobIds.has(jobId) && count > 1) silentDuplicateInvoices += count - 1;
  }

  const failures: string[] = [];
  if (kotLost > 0) failures.push(`${kotLost} kitchen slip(s) permanently lost (PRN-002)`);
  if (silentDuplicateInvoices > 0) {
    failures.push(`${silentDuplicateInvoices} silent duplicate invoice(s) — a compliance problem (PRN-011)`);
  }
  if (unidentifiable > 0) {
    failures.push(`${unidentifiable} printed document(s) carry no job identifier (PRN-003)`);
  }

  return {
    jobsEnqueued: config.jobs,
    kotEnqueued, kotPrinted, kotLost,
    invoicesEnqueued, invoiceDocumentsEmitted: invoiceDocs,
    silentDuplicateInvoices, unidentifiableDuplicates: unidentifiable,
    survivedRestarts: restarts,
    passed: failures.length === 0,
    failures,
  };
}
